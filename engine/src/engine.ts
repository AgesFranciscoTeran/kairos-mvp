/**
 * KAIROS — Motor de decisión (port TS de kairos_engine.py)
 *
 * Port fiel del motor de referencia: misma máquina de estados, mismos números, mismos
 * textos. No clasifica: recibe una ventana de features cada `step_sec` y decide qué hace
 * el sistema (IDLE, GATED, WATCH, INTERVENE, RECOVERY, ESCALATE).
 *
 * Reglas de este archivo:
 * - Si algo del Python parece un bug, se porta tal cual y se anota en
 *   docs/ENGINE_DIVERGENCES.md (H-xx).
 * - Lo que el Python no tiene (acciones del usuario) vive en `applyAction` y está marcado
 *   como extensión (X-xx). Los tests de paridad no lo llaman.
 *
 * ADVERTENCIA DE ALCANCE: pesos y umbrales son VALORES DE DISEÑO, no calibrados.
 */

import { FEATURE_WEIGHTS, GATE_FEATURE, REQUIRED_KEYS, TRACKED, type TrackedKey } from './features.js';
import { isFiniteNumber, pyFixed, pyRound, pySum } from './pycompat.js';

export type EngineStateName = 'IDLE' | 'WATCH' | 'INTERVENE' | 'RECOVERY' | 'ESCALATE';

/** Todos los valores de diseño en un solo lugar (nombres iguales al Python). */
export interface EngineConfig {
  step_sec: number;
  warmup_windows: number;
  ewma_alpha: number;
  z_clip: number;
  gate_z: number;
  gate_release_windows: number;
  theta_watch: number;
  theta_act: number;
  theta_exit: number;
  k_watch: number;
  k_act: number;
  k_exit: number;
  intervention_sec: number;
  recovery_grace_sec: number;
  cooldown_sec: number;
}

export const DEFAULT_CONFIG: Readonly<EngineConfig> = Object.freeze({
  step_sec: 30.0, // cada cuánto llega una ventana
  // línea base personal
  warmup_windows: 8, // ventanas limpias antes de poder decidir
  ewma_alpha: 0.02, // deriva lenta de la línea base
  z_clip: 4.0, // recorte de z para que un artefacto no domine
  // gating por movimiento
  gate_z: 2.0, // z de movimiento a partir del cual se bloquea
  gate_release_windows: 2, // ventanas limpias para volver a interpretar
  // umbrales de activación (sobre el score compuesto)
  theta_watch: 0.5,
  theta_act: 0.9,
  theta_exit: 0.35,
  // persistencia
  k_watch: 2, // ventanas para entrar en vigilancia
  k_act: 4, // ventanas para disparar la intervención
  k_exit: 2, // ventanas bajo el umbral de salida
  // tiempos del producto
  intervention_sec: 90.0,
  recovery_grace_sec: 300.0,
  cooldown_sec: 600.0,
});

export type EngineEventKind =
  | 'baseline_ready'
  | 'watch'
  | 'watch_cancelled'
  | 'watch_end'
  | 'intervene'
  | 'intervention_end'
  | 'resolved'
  | 'escalate'
  // extensiones (X-01), nunca aparecen en la ruta de paridad
  | 'escalation_cancelled'
  | 'escalation_opened';

export interface EngineEvent {
  t: number;
  kind: EngineEventKind;
  detail: string;
  state: EngineStateName;
  /** extensión X-01: presente solo en eventos provocados por una acción del usuario */
  actor?: 'user';
}

export interface EngineState {
  state: EngineStateName;
  score: number | null;
  gated: boolean;
  /** ¿ya hay línea base utilizable? */
  ready: boolean;
  t: number;
  z: Partial<Record<TrackedKey, number>>;
  reason: string;
}

/** Ventana tal como la acepta `step`: claves ausentes, null y no finitos = sin dato. */
export type StepFeatures = Partial<Record<string, number | null | undefined>>;

/** Extensión X-01: acciones explícitas del usuario. */
export type UserAction =
  | { kind: 'end_intervention'; t: number }
  | { kind: 'cancel_escalation'; t: number }
  | { kind: 'open_escalation'; t: number };

/** Vista de solo lectura del estado interno, para invariantes y para la UI. */
export interface EngineInternals {
  ready: boolean;
  mu: Readonly<Record<string, number>>;
  sd: Readonly<Record<string, number>>;
  warmCount: number;
  cooldownUntil: number;
  phaseStart: number;
  episodeStart: number | null;
  exitStreak: number;
  cleanStreak: number;
}

export interface EngineOptions {
  /** guarda cada EngineState en `trace` (como el Python). Default: true. */
  recordTrace?: boolean;
}

/** Cola acotada equivalente a `collections.deque(maxlen=n)`. */
class Deque {
  private items: number[] = [];
  constructor(private readonly maxlen: number) {}
  append(v: number): void {
    this.items.push(v);
    if (this.items.length > this.maxlen) this.items.shift();
  }
  clear(): void {
    this.items = [];
  }
  get length(): number {
    return this.items.length;
  }
  last(n: number): number[] {
    return this.items.slice(this.items.length - n);
  }
}

/** Máquina de estados de Kairos. Una instancia por usuario. */
export class KairosEngine {
  readonly cfg: EngineConfig;
  state: EngineStateName = 'IDLE';
  events: EngineEvent[] = [];
  trace: EngineState[] = [];

  private readonly recordTrace: boolean;
  private warm: Record<string, number[]> = {};
  private mu: Record<string, number> = {};
  private sd: Record<string, number> = {};
  private ready = false;
  private scores!: Deque;
  private cleanStreak = 0;
  private phaseStart = 0.0; // inicio de INTERVENE / RECOVERY
  private cooldownUntil = -1e9;
  private exitStreak = 0;
  private episodeStart: number | null = null; // inicio del episodio en curso (para TTB)
  private tNow = 0.0;

  constructor(cfg: Partial<EngineConfig> = {}, opts: EngineOptions = {}) {
    this.cfg = { ...DEFAULT_CONFIG, ...cfg };
    this.recordTrace = opts.recordTrace ?? true;
    this.reset();
  }

  // ------------------------------------------------------------------ //
  reset(): void {
    const c = this.cfg;
    this.warm = Object.fromEntries(TRACKED.map((k) => [k, [] as number[]]));
    this.mu = {};
    this.sd = {};
    this.ready = false;
    this.scores = new Deque(Math.max(c.k_act, c.k_watch, c.k_exit));
    this.cleanStreak = 0;
    this.state = 'IDLE';
    this.phaseStart = 0.0;
    this.cooldownUntil = -1e9;
    this.exitStreak = 0;
    this.episodeStart = null;
    this.events = [];
    this.trace = [];
    this.tNow = 0.0;
  }

  get internals(): EngineInternals {
    return {
      ready: this.ready,
      mu: { ...this.mu },
      sd: { ...this.sd },
      warmCount: this.warm['rmssd']?.length ?? 0,
      cooldownUntil: this.cooldownUntil,
      phaseStart: this.phaseStart,
      episodeStart: this.episodeStart,
      exitStreak: this.exitStreak,
      cleanStreak: this.cleanStreak,
    };
  }

  // ------------------------------------------------------------------ //
  // Línea base personal
  // ------------------------------------------------------------------ //
  private finishWarmup(): void {
    for (const [k, vals] of Object.entries(this.warm)) {
      const n = vals.length;
      // H-05: con n = 0 el Python lanza ZeroDivisionError; aquí queda NaN
      const mu = pySum(vals) / n;
      const variance = pySum(vals.map((v) => (v - mu) * (v - mu))) / Math.max(1, n - 1);
      const sd = Math.sqrt(variance);
      this.mu[k] = mu;
      this.sd[k] = sd > 1e-9 ? sd : 1.0;
    }
    this.ready = true;
  }

  /** Deriva lenta de la línea base. Solo se llama con ventanas limpias y en IDLE. */
  private updateBaseline(feats: StepFeatures): void {
    const a = this.cfg.ewma_alpha;
    for (const k of TRACKED) {
      const v = feats[k];
      if (!isFiniteNumber(v)) continue;
      const mu = this.mu[k]!;
      this.mu[k] = (1 - a) * mu + a * v;
      const dev = Math.abs(v - this.mu[k]!);
      this.sd[k] = Math.max(1e-9, (1 - a) * this.sd[k]! + a * dev * 1.2533);
    }
  }

  private z(k: string, v: number | null | undefined): number | null {
    if (!isFiniteNumber(v)) return null;
    const z = (v - this.mu[k]!) / this.sd[k]!;
    const c = this.cfg.z_clip;
    return Math.max(-c, Math.min(c, z));
  }

  // ------------------------------------------------------------------ //
  // Score compuesto de activación
  // ------------------------------------------------------------------ //
  private activationScore(feats: StepFeatures): [number | null, EngineState['z']] {
    let num = 0.0;
    let den = 0.0;
    const zs: EngineState['z'] = {};
    for (const [k, w] of Object.entries(FEATURE_WEIGHTS) as [TrackedKey, number][]) {
      const z = this.z(k, feats[k]);
      if (z === null) continue;
      zs[k] = pyRound(z, 3);
      num += w * z;
      den += Math.abs(w);
    }
    if (den === 0) return [null, zs];
    return [num / den, zs];
  }

  // ------------------------------------------------------------------ //
  private meanLast(n: number): number | null {
    if (this.scores.length < n) return null;
    return pySum(this.scores.last(n)) / n;
  }

  private emit(kind: EngineEventKind, t: number, detail = '', actor?: 'user'): EngineEvent {
    const ev: EngineEvent = { t: pyRound(t, 1), kind, detail, state: this.state };
    if (actor) ev.actor = actor;
    this.events.push(ev);
    return ev;
  }

  // ------------------------------------------------------------------ //
  // Un paso del motor
  // ------------------------------------------------------------------ //
  /** Procesa una ventana. `t` en segundos desde el inicio del registro. */
  step(t: number, feats: StepFeatures): EngineState {
    const c = this.cfg;
    this.tNow = t;

    const usable = REQUIRED_KEYS.every((k) => isFiniteNumber(feats[k]));

    // ---- calentamiento: aún no hay línea base ----
    if (!this.ready) {
      if (usable) {
        for (const k of TRACKED) {
          const v = feats[k];
          if (isFiniteNumber(v)) this.warm[k]!.push(v);
        }
        if (this.warm['rmssd']!.length >= c.warmup_windows) {
          this.finishWarmup();
          this.emit('baseline_ready', t, 'línea base personal establecida');
        }
      }
      return this.record(t, 0.0, false, 'calibrando línea base', {});
    }

    // ---- gating por movimiento y calidad de señal ----
    const zAcc = usable ? this.z(GATE_FEATURE, feats[GATE_FEATURE]) : null;
    const gated = !usable || (zAcc !== null && zAcc > c.gate_z);

    if (gated) {
      this.cleanStreak = 0;
      const reason = !usable ? 'señal insuficiente' : 'actividad física detectada';
      // el movimiento explica la activación: se abandona la vigilancia
      if (this.state === 'WATCH') {
        this.state = 'IDLE';
        this.scores.clear();
        this.emit('watch_cancelled', t, 'movimiento explica la activación');
      }
      // durante INTERVENE/RECOVERY el gating solo pausa la evaluación
      this.advanceTimers(t, null, true);
      return this.record(t, null, true, reason, {});
    }

    this.cleanStreak += 1;
    if (this.cleanStreak < c.gate_release_windows && this.state === 'IDLE') {
      // ventanas de asentamiento tras el movimiento: no se decide todavía
      return this.record(t, 0.0, false, 'asentando tras movimiento', {});
    }

    const [score, zs] = this.activationScore(feats);
    if (score === null) {
      return this.record(t, 0.0, true, 'sin features válidas', {});
    }
    this.scores.append(score);

    if (this.state === 'IDLE') {
      this.updateBaseline(feats);
    }

    const reason = this.advanceTimers(t, score, false);
    return this.record(t, score, false, reason, zs);
  }

  // ------------------------------------------------------------------ //
  /** Transiciones de la máquina de estados. */
  private advanceTimers(t: number, score: number | null, gated: boolean): string {
    const c = this.cfg;
    const s = this.state;

    // --- fases temporizadas: corren aunque la ventana esté bloqueada ---
    if (s === 'INTERVENE') {
      if (t - this.phaseStart >= c.intervention_sec) {
        this.state = 'RECOVERY';
        this.phaseStart = t;
        this.exitStreak = 0;
        this.emit('intervention_end', t, 'respiración guiada completada');
      }
      return 'intervención en curso';
    }

    if (s === 'RECOVERY') {
      if (score !== null && score < c.theta_exit) {
        this.exitStreak += 1;
      } else if (score !== null) {
        this.exitStreak = 0;
      }
      if (this.exitStreak >= c.k_exit) {
        const ttb = t - (this.episodeStart !== null ? this.episodeStart : t);
        this.state = 'IDLE';
        this.cooldownUntil = t + c.cooldown_sec;
        this.scores.clear();
        this.emit('resolved', t, `activación cedió · TTB ${pyFixed(ttb, 0)} s`);
        this.episodeStart = null;
        return 'resuelto';
      }
      // H-03: la gracia corre también en ventanas bloqueadas
      if (t - this.phaseStart >= c.recovery_grace_sec) {
        this.state = 'ESCALATE';
        this.phaseStart = t;
        this.emit('escalate', t, 'la activación no cedió tras la intervención');
        return 'escalando a contacto de confianza';
      }
      return 'midiendo recuperación';
    }

    if (s === 'ESCALATE') {
      // el escalamiento se emite una vez; el sistema vuelve a reposo con cooldown
      this.state = 'IDLE';
      this.cooldownUntil = t + c.cooldown_sec;
      this.scores.clear();
      this.episodeStart = null;
      return 'contacto notificado';
    }

    if (gated || score === null) {
      return 'bloqueado';
    }

    // --- IDLE / WATCH ---
    const mWatch = this.meanLast(c.k_watch);
    const mAct = this.meanLast(c.k_act);

    if (s === 'IDLE') {
      if (mWatch !== null && mWatch > c.theta_watch) {
        this.state = 'WATCH';
        this.episodeStart = t;
        // H-01: el Python no reinicia exitStreak aquí
        this.emit('watch', t, `activación sobre el umbral (score medio ${pyFixed(mWatch, 2)})`);
        return 'vigilancia';
      }
      return 'reposo';
    }

    if (s === 'WATCH') {
      if (mAct !== null && mAct > c.theta_act) {
        if (t < this.cooldownUntil) {
          return 'activación sostenida · en cooldown';
        }
        this.state = 'INTERVENE';
        this.phaseStart = t;
        this.emit(
          'intervene',
          t,
          `activación sostenida ${pyFixed(c.k_act * c.step_sec, 0)} s ` +
            `(score medio ${pyFixed(mAct, 2)})`,
        );
        return 'intervención iniciada';
      }
      if (score < c.theta_exit) {
        this.exitStreak += 1;
        if (this.exitStreak >= c.k_exit) {
          this.state = 'IDLE';
          this.exitStreak = 0;
          this.episodeStart = null;
          this.emit('watch_end', t, 'la activación cedió sola');
          return 'reposo';
        }
      } else {
        this.exitStreak = 0;
      }
      return 'vigilancia';
    }

    return 'reposo';
  }

  // ------------------------------------------------------------------ //
  private record(
    t: number,
    score: number | null,
    gated: boolean,
    reason: string,
    zs: EngineState['z'],
  ): EngineState {
    const st: EngineState = {
      state: this.state,
      score: score === null ? null : pyRound(score, 4),
      gated,
      ready: this.ready,
      t,
      z: zs,
      reason,
    };
    if (this.recordTrace) this.trace.push(st);
    return st;
  }

  // ------------------------------------------------------------------ //
  // EXTENSIÓN X-01 — acciones explícitas del usuario (no existe en el Python)
  // ------------------------------------------------------------------ //
  /**
   * Aplica una acción del usuario. Devuelve el evento emitido, o null si la acción no
   * corresponde al estado actual (se ignora sin efectos). `t` es tiempo de registro y no
   * puede ser anterior a la última ventana procesada.
   */
  applyAction(action: UserAction): EngineEvent | null {
    const c = this.cfg;
    const t = Math.max(action.t, this.tNow);
    switch (action.kind) {
      case 'end_intervention': {
        if (this.state !== 'INTERVENE') return null;
        // mismo efecto que el fin natural de la intervención, adelantado
        this.state = 'RECOVERY';
        this.phaseStart = t;
        this.exitStreak = 0;
        return this.emit('intervention_end', t, 'respiración terminada por el usuario', 'user');
      }
      case 'cancel_escalation':
      case 'open_escalation': {
        if (this.state !== 'ESCALATE') return null;
        // mismo efecto que la salida natural de ESCALATE, con un evento explícito
        this.state = 'IDLE';
        this.cooldownUntil = t + c.cooldown_sec;
        this.scores.clear();
        this.episodeStart = null;
        return action.kind === 'cancel_escalation'
          ? this.emit('escalation_cancelled', t, 'escalamiento cancelado por el usuario', 'user')
          : this.emit('escalation_opened', t, 'el usuario abrió el mensaje al contacto', 'user');
      }
    }
  }
}
