"""
KAIROS — Motor de decisión (replay)
===================================

Este módulo NO clasifica: ejecuta la lógica del producto. Recibe una ventana de
características fisiológicas cada `step_sec` segundos, como si llegaran en vivo desde
la muñeca, y decide qué hace el sistema:

    IDLE       reposo; la línea base personal se sigue actualizando
    GATED      el IMU detecta actividad física -> la fisiología no se interpreta
    WATCH      activación por encima del umbral, aún sin persistencia suficiente
    INTERVENE  activación sostenida -> respiración guiada de 90 s
    RECOVERY   terminó la intervención; se mide si la activación cede
    ESCALATE   no cedió dentro de la ventana de gracia -> contacto de confianza

Tres decisiones de la arquitectura de Kairos viven aquí, no en un clasificador:

1. Gating por movimiento. Si el movimiento se dispara respecto al propio reposo del
   usuario, la ventana no se interpreta y tampoco contamina la línea base.
2. Línea base personal en línea. Cada feature se normaliza contra la media y la
   dispersión del PROPIO usuario, estimadas solo con su pasado en reposo. La línea base
   se congela durante la activación para que un episodio largo no se vuelva "lo normal".
3. Persistencia e histéresis. Entrar cuesta más que quedarse, y salir exige que el score
   baje de un umbral menor durante varias ventanas. Sin esto, el sistema parpadea.

ADVERTENCIA DE ALCANCE: los pesos y umbrales de abajo son VALORES DE DISEÑO, derivados
de la dirección conocida de cada señal bajo activación simpática, no calibrados contra
datos. El motor no está entrenado. Lo que el replay demuestra es el COMPORTAMIENTO del
sistema, no su desempeño.
"""

from __future__ import annotations

from dataclasses import dataclass, field, asdict
from collections import deque
import math

# --------------------------------------------------------------------------- #
# Dirección y peso de cada feature bajo activación simpática.
# Signo +: sube con la activación.  Signo -: baja con la activación.
# --------------------------------------------------------------------------- #
FEATURE_WEIGHTS = {
    "hr_mean":       +0.9,   # taquicardia
    "rmssd":         -1.0,   # retirada vagal (el indicador más limpio)
    "sdnn":          -0.5,
    "pnn50":         -0.4,
    "eda_scl_mean":  +1.0,   # nivel tónico de conductancia
    "eda_scl_slope": +0.4,
    "eda_scr_count": +0.7,   # respuestas fásicas
    "temp_mean":     -0.5,   # vasoconstricción periférica
    "temp_slope":    -0.3,
}

# Feature de movimiento usada para el gating (no entra en el score)
GATE_FEATURE = "acc_move_std"

# Features que la línea base necesita seguir
TRACKED = list(FEATURE_WEIGHTS.keys()) + [GATE_FEATURE]


@dataclass
class EngineConfig:
    """Todos los valores de diseño en un solo lugar, para poder barrerlos."""
    step_sec: float = 30.0          # cada cuánto llega una ventana

    # línea base personal
    warmup_windows: int = 8         # ventanas limpias antes de poder decidir
    ewma_alpha: float = 0.02        # deriva lenta de la línea base
    z_clip: float = 4.0             # recorte de z para que un artefacto no domine

    # gating por movimiento
    gate_z: float = 2.0             # z de movimiento a partir del cual se bloquea
    gate_release_windows: int = 2   # ventanas limpias para volver a interpretar

    # umbrales de activación (sobre el score compuesto)
    theta_watch: float = 0.50
    theta_act: float = 0.90
    theta_exit: float = 0.35

    # persistencia
    k_watch: int = 2                # ventanas para entrar en vigilancia
    k_act: int = 4                  # ventanas para disparar la intervención
    k_exit: int = 2                 # ventanas bajo el umbral de salida

    # tiempos del producto
    intervention_sec: float = 90.0
    recovery_grace_sec: float = 300.0
    cooldown_sec: float = 600.0


@dataclass
class EngineState:
    state: str = "IDLE"
    score: float | None = 0.0
    gated: bool = False
    ready: bool = False             # ¿ya hay línea base utilizable?
    t: float = 0.0
    z: dict = field(default_factory=dict)
    reason: str = ""


class KairosEngine:
    """Máquina de estados de Kairos. Una instancia por usuario."""

    def __init__(self, cfg: EngineConfig | None = None):
        self.cfg = cfg or EngineConfig()
        self.reset()

    # ------------------------------------------------------------------ #
    def reset(self):
        c = self.cfg
        self._warm = {k: [] for k in TRACKED}
        self._mu = {}
        self._sd = {}
        self._ready = False
        self._scores = deque(maxlen=max(c.k_act, c.k_watch, c.k_exit))
        self._clean_streak = 0
        self.state = "IDLE"
        self._phase_start = 0.0      # inicio de INTERVENE / RECOVERY
        self._cooldown_until = -1e9
        self._exit_streak = 0
        self._episode_start = None   # inicio del episodio en curso (para TTB)
        self.events = []
        self.trace = []
        self._t = 0.0

    # ------------------------------------------------------------------ #
    # Línea base personal
    # ------------------------------------------------------------------ #
    def _finish_warmup(self):
        for k, vals in self._warm.items():
            n = len(vals)
            mu = sum(vals) / n
            var = sum((v - mu) ** 2 for v in vals) / max(1, n - 1)
            sd = math.sqrt(var)
            self._mu[k] = mu
            self._sd[k] = sd if sd > 1e-9 else 1.0
        self._ready = True

    def _update_baseline(self, feats):
        """Deriva lenta de la línea base. Solo se llama con ventanas limpias y en IDLE."""
        a = self.cfg.ewma_alpha
        for k in TRACKED:
            v = feats.get(k)
            if v is None or not math.isfinite(v):
                continue
            mu = self._mu[k]
            self._mu[k] = (1 - a) * mu + a * v
            dev = abs(v - self._mu[k])
            self._sd[k] = max(1e-9, (1 - a) * self._sd[k] + a * dev * 1.2533)

    def _z(self, k, v):
        if v is None or not math.isfinite(v):
            return None
        z = (v - self._mu[k]) / self._sd[k]
        c = self.cfg.z_clip
        return max(-c, min(c, z))

    # ------------------------------------------------------------------ #
    # Score compuesto de activación
    # ------------------------------------------------------------------ #
    def _activation_score(self, feats):
        num = den = 0.0
        zs = {}
        for k, w in FEATURE_WEIGHTS.items():
            z = self._z(k, feats.get(k))
            if z is None:
                continue
            zs[k] = round(z, 3)
            num += w * z
            den += abs(w)
        if den == 0:
            return None, zs
        return num / den, zs

    # ------------------------------------------------------------------ #
    def _mean_last(self, n):
        if len(self._scores) < n:
            return None
        vals = list(self._scores)[-n:]
        return sum(vals) / n

    def _emit(self, kind, t, detail=""):
        self.events.append({"t": round(t, 1), "kind": kind, "detail": detail,
                            "state": self.state})

    # ------------------------------------------------------------------ #
    # Un paso del motor
    # ------------------------------------------------------------------ #
    def step(self, t: float, feats: dict) -> EngineState:
        """Procesa una ventana. `t` en segundos desde el inicio del registro."""
        c = self.cfg
        self._t = t

        usable = all(
            feats.get(k) is not None and math.isfinite(feats.get(k, float("nan")))
            for k in ("hr_mean", "rmssd", "eda_scl_mean", GATE_FEATURE)
        )

        # ---- calentamiento: aún no hay línea base ----
        if not self._ready:
            if usable:
                for k in TRACKED:
                    v = feats.get(k)
                    if v is not None and math.isfinite(v):
                        self._warm[k].append(v)
                if len(self._warm["rmssd"]) >= c.warmup_windows:
                    self._finish_warmup()
                    self._emit("baseline_ready", t, "línea base personal establecida")
            return self._record(t, 0.0, False, "calibrando línea base", {})

        # ---- gating por movimiento y calidad de señal ----
        z_acc = self._z(GATE_FEATURE, feats.get(GATE_FEATURE)) if usable else None
        gated = (not usable) or (z_acc is not None and z_acc > c.gate_z)

        if gated:
            self._clean_streak = 0
            reason = ("señal insuficiente" if not usable
                      else "actividad física detectada")
            # el movimiento explica la activación: se abandona la vigilancia
            if self.state == "WATCH":
                self.state = "IDLE"
                self._scores.clear()
                self._emit("watch_cancelled", t, "movimiento explica la activación")
            # durante INTERVENE/RECOVERY el gating solo pausa la evaluación
            self._advance_timers(t, score=None, gated=True)
            return self._record(t, None, True, reason, {})

        self._clean_streak += 1
        if self._clean_streak < c.gate_release_windows and self.state == "IDLE":
            # ventanas de asentamiento tras el movimiento: no se decide todavía
            return self._record(t, 0.0, False, "asentando tras movimiento", {})

        score, zs = self._activation_score(feats)
        if score is None:
            return self._record(t, 0.0, True, "sin features válidas", {})
        self._scores.append(score)

        if self.state == "IDLE":
            self._update_baseline(feats)

        reason = self._advance_timers(t, score=score, gated=False)
        return self._record(t, score, False, reason, zs)

    # ------------------------------------------------------------------ #
    def _advance_timers(self, t, score, gated):
        """Transiciones de la máquina de estados."""
        c = self.cfg
        s = self.state

        # --- fases temporizadas: corren aunque la ventana esté bloqueada ---
        if s == "INTERVENE":
            if t - self._phase_start >= c.intervention_sec:
                self.state = "RECOVERY"
                self._phase_start = t
                self._exit_streak = 0
                self._emit("intervention_end", t, "respiración guiada completada")
            return "intervención en curso"

        if s == "RECOVERY":
            if score is not None and score < c.theta_exit:
                self._exit_streak += 1
            elif score is not None:
                self._exit_streak = 0
            if self._exit_streak >= c.k_exit:
                ttb = t - (self._episode_start if self._episode_start is not None else t)
                self.state = "IDLE"
                self._cooldown_until = t + c.cooldown_sec
                self._scores.clear()
                self._emit("resolved", t, f"activación cedió · TTB {ttb:.0f} s")
                self._episode_start = None
                return "resuelto"
            if t - self._phase_start >= c.recovery_grace_sec:
                self.state = "ESCALATE"
                self._phase_start = t
                self._emit("escalate", t, "la activación no cedió tras la intervención")
                return "escalando a contacto de confianza"
            return "midiendo recuperación"

        if s == "ESCALATE":
            # el escalamiento se emite una vez; el sistema vuelve a reposo con cooldown
            self.state = "IDLE"
            self._cooldown_until = t + c.cooldown_sec
            self._scores.clear()
            self._episode_start = None
            return "contacto notificado"

        if gated or score is None:
            return "bloqueado"

        # --- IDLE / WATCH ---
        m_watch = self._mean_last(c.k_watch)
        m_act = self._mean_last(c.k_act)

        if s == "IDLE":
            if m_watch is not None and m_watch > c.theta_watch:
                self.state = "WATCH"
                self._episode_start = t
                self._emit("watch", t,
                           f"activación sobre el umbral (score medio {m_watch:.2f})")
                return "vigilancia"
            return "reposo"

        if s == "WATCH":
            if m_act is not None and m_act > c.theta_act:
                if t < self._cooldown_until:
                    return "activación sostenida · en cooldown"
                self.state = "INTERVENE"
                self._phase_start = t
                self._emit("intervene", t,
                           f"activación sostenida {c.k_act * c.step_sec:.0f} s "
                           f"(score medio {m_act:.2f})")
                return "intervención iniciada"
            if score < c.theta_exit:
                self._exit_streak += 1
                if self._exit_streak >= c.k_exit:
                    self.state = "IDLE"
                    self._exit_streak = 0
                    self._episode_start = None
                    self._emit("watch_end", t, "la activación cedió sola")
                    return "reposo"
            else:
                self._exit_streak = 0
            return "vigilancia"

        return "reposo"

    # ------------------------------------------------------------------ #
    def _record(self, t, score, gated, reason, zs):
        score = None if score is None else round(float(score), 4)
        st = EngineState(state=self.state, score=score,
                         gated=bool(gated), ready=self._ready, t=float(t),
                         z=zs, reason=reason)
        self.trace.append(st)
        return st


# --------------------------------------------------------------------------- #
# Métricas operativas
# --------------------------------------------------------------------------- #
def operational_metrics(trace, events, labels, step_sec, stress_label=2):
    """Traduce el replay a las cifras que importan para el producto.

    `labels` es la etiqueta real de cada ventana (mismo orden que `trace`), solo para
    evaluar: el motor nunca la ve.

    - falsas alarmas por hora: intervenciones que arrancan fuera de un episodio real
    - cobertura: fracción de episodios reales con al menos una intervención
    - latencia: segundos entre el inicio del episodio y la intervención
    - TTB: tiempo hasta volver bajo el umbral de salida tras disparar
    """
    n = min(len(trace), len(labels))
    trace, labels = trace[:n], labels[:n]

    # bloques contiguos de estrés real
    episodes, start = [], None
    for i, lab in enumerate(labels):
        if lab == stress_label and start is None:
            start = i
        elif lab != stress_label and start is not None:
            episodes.append((start, i - 1))
            start = None
    if start is not None:
        episodes.append((start, n - 1))

    def in_episode(i):
        return any(a <= i <= b for a, b in episodes)

    t_of = {round(s.t, 1): i for i, s in enumerate(trace)}
    triggers = [e for e in events if e["kind"] == "intervene"]

    false_alarms, true_hits, latencies = 0, [], []
    for e in triggers:
        i = t_of.get(round(e["t"], 1))
        if i is None:
            continue
        if in_episode(i):
            true_hits.append(i)
            for a, b in episodes:
                if a <= i <= b:
                    latencies.append((i - a) * step_sec)
                    break
        else:
            false_alarms += 1

    covered = sum(1 for a, b in episodes
                  if any(a <= i <= b for i in true_hits))

    rest_windows = sum(1 for i in range(n) if not in_episode(i))
    rest_hours = rest_windows * step_sec / 3600.0
    gated_windows = sum(1 for s in trace if s.gated)

    ttbs = [float(e["detail"].split("TTB")[1].split("s")[0])
            for e in events if e["kind"] == "resolved" and "TTB" in e["detail"]]

    def med(v):
        if not v:
            return None
        v = sorted(v)
        m = len(v) // 2
        return v[m] if len(v) % 2 else (v[m - 1] + v[m]) / 2

    return {
        "windows": n,
        "hours_total": round(n * step_sec / 3600.0, 2),
        "episodes_real": len(episodes),
        "episodes_covered": covered,
        "coverage": round(covered / len(episodes), 3) if episodes else None,
        "interventions": len(triggers),
        "false_alarms": false_alarms,
        "false_alarms_per_rest_hour": round(false_alarms / rest_hours, 3) if rest_hours else None,
        "detection_latency_median_s": med(latencies),
        "gated_fraction": round(gated_windows / n, 3),
        "escalations": sum(1 for e in events if e["kind"] == "escalate"),
        "ttb_median_s": med(ttbs),
    }


def config_dict(cfg: EngineConfig):
    return asdict(cfg)
