"""
KAIROS MVP — Exportador de fixtures de paridad
==============================================

Corre el motor de referencia (Python) sobre registros conocidos y guarda, por caso:

    windows    las ventanas de features que entran al motor, sin redondear
    expected   la traza que produjo el motor: estado, score, gated, ready, z, reason,
               eventos y métricas operativas

El port TypeScript (engine/) debe reproducir `expected` a partir de `windows`.

Los floats se escriben con repr de Python, que es exacto ida y vuelta en IEEE-754,
así que JS lee exactamente los mismos doubles. NaN se exporta como null.

Casos:
    synthetic-seed7           el registro canónico de build_replay.py (el demo público)
    synthetic-seed{N}         otras semillas del mismo generador, para cobertura
    synthetic-gaps            semilla 7 con huecos de señal (null) inyectados
    synthetic-altcfg          semilla 7 con un EngineConfig alternativo (cooldown corto…)
    wesad-S{N}                solo con --wesad-dir; se escriben en fixtures/local/
                              (ignorada por git: datos derivados de WESAD no se publican)

Uso:
    python reference/python/export_fixtures.py
    python reference/python/export_fixtures.py --wesad-dir ./WESAD --max-subjects 3
"""

from __future__ import annotations

import argparse
import glob
import json
import math
import os
import platform
import sys
from dataclasses import replace

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "kairos-replay"))

import numpy as np  # noqa: E402

import build_replay as br  # noqa: E402
from kairos_engine import (  # noqa: E402
    KairosEngine, EngineConfig, config_dict, operational_metrics, TRACKED,
)

REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
FIXTURES = os.path.join(REPO, "fixtures")
EXTRA_KEYS = ["eda_std", "eda_scr_amp", "acc_move_mad"]
SCHEMA = 1


def _source_commit():
    with open(os.path.join(HERE, "SOURCE_COMMIT"), encoding="utf-8") as fh:
        for line in fh:
            if line.startswith("commit:"):
                return line.split()[1]
    return None


def _num(v):
    """float finito o None (NaN/inf/ausente -> None)."""
    if v is None:
        return None
    v = float(v)
    return v if math.isfinite(v) else None


# --------------------------------------------------------------------------- #
# Construcción de casos
# --------------------------------------------------------------------------- #
def run_case(name, rows, labels, cfg, *, synthetic, description):
    eng = KairosEngine(cfg)
    for t, feats in rows:
        eng.step(t, feats)
    metrics = operational_metrics(eng.trace, eng.events, labels, cfg.step_sec)

    windows = []
    for (t, f), lab in zip(rows, labels):
        windows.append({
            "t": float(t),
            "features": {k: _num(f.get(k)) for k in TRACKED},
            "extra": {k: _num(f.get(k)) for k in EXTRA_KEYS if k in f},
            "label": int(lab),
        })

    trace = [{
        "t": s.t, "state": s.state, "score": s.score, "gated": s.gated,
        "ready": s.ready, "z": s.z, "reason": s.reason,
    } for s in eng.trace]

    return {
        "schema": SCHEMA,
        "meta": {
            "case": name,
            "description": description,
            "synthetic": synthetic,
            "step_sec": cfg.step_sec,
            "source_commit": _source_commit(),
            "python": platform.python_version(),
            "numpy": np.__version__,
            "label_names": br.LABEL_NAMES,
        },
        "config": config_dict(cfg),
        "windows": windows,
        "expected": {"trace": trace, "events": eng.events, "metrics": metrics},
    }


def synthetic_rows(cfg, seed):
    _, rows, labels, _ = br.synthetic_record(cfg, seed=seed)
    return rows, labels


def gaps_rows(cfg):
    """Semilla 7 con huecos: HRV perdida (señal insuficiente), features secundarias nulas
    y una ventana sin movimiento. El warmup queda limpio para que la línea base exista."""
    rows, labels = synthetic_rows(cfg, 7)
    rng = np.random.default_rng(2026)
    out = []
    for i, (t, f) in enumerate(rows):
        f = dict(f)
        if i >= 12:
            r = rng.random()
            if r < 0.06:                       # PPG perdido: sin HRV
                for k in ("hr_mean", "sdnn", "rmssd", "pnn50"):
                    f[k] = float("nan")
            elif r < 0.10:                     # features secundarias ausentes
                f["temp_slope"] = None
                f["pnn50"] = float("nan")
            elif r < 0.12:                     # sin acelerómetro
                f["acc_move_std"] = None
            elif r < 0.14:                     # EDA perdida
                f["eda_scl_mean"] = float("nan")
        out.append((t, f))
    return out, labels


ALT_CFG = dict(warmup_windows=6, gate_release_windows=1, k_act=3, k_exit=3,
               recovery_grace_sec=180.0, cooldown_sec=240.0, theta_exit=0.45)


def build_cases():
    cfg = EngineConfig()
    cases = []
    rows, labels = synthetic_rows(cfg, 7)
    cases.append(run_case("synthetic-seed7", rows, labels, cfg, synthetic=True,
                          description="Registro canónico de build_replay.py (semilla 7)"))
    for seed in (1, 2, 3, 11, 42):
        rows, labels = synthetic_rows(cfg, seed)
        cases.append(run_case(f"synthetic-seed{seed}", rows, labels, cfg, synthetic=True,
                              description=f"Generador sintético, semilla {seed}"))
    rows, labels = gaps_rows(cfg)
    cases.append(run_case("synthetic-gaps", rows, labels, cfg, synthetic=True,
                          description="Semilla 7 con huecos de señal inyectados"))
    alt = replace(cfg, **ALT_CFG)
    rows, labels = synthetic_rows(alt, 7)
    cases.append(run_case("synthetic-altcfg", rows, labels, alt, synthetic=True,
                          description="Semilla 7 con EngineConfig alternativo"))
    return cases


def build_wesad_cases(data_dir, max_subjects):
    cfg = EngineConfig()
    ext = br.load_extractor(os.path.join(HERE, "wesad-feasibility",
                                         "kairos_wesad_separability.py"))
    paths = sorted(glob.glob(os.path.join(data_dir, "**", "S*.pkl"), recursive=True))
    if not paths:
        raise FileNotFoundError(f"No hay .pkl de WESAD en {data_dir!r}")
    cases = []
    for p in paths[:max_subjects]:
        subject, rows, labels, _ = br.replay_wesad(p, ext, cfg)
        cases.append(run_case(f"wesad-{subject}", rows, labels, cfg, synthetic=False,
                              description=f"WESAD sujeto {subject} (muñeca, E4)"))
    return cases


def build_pycompat():
    """Casos para verificar que pySum / pyRound / pyFixed del port igualan a CPython:
    valores aleatorios, empates exactos (k/2^n) y listas que la suma ingenua no reproduce."""
    rng = np.random.default_rng(99)
    vals = [float(v) for v in rng.normal(0, 3, 3000)]
    vals += [float(v) for v in rng.uniform(-1, 1, 1000) * 1e-3]
    vals += [k / 2 ** n for n in range(1, 8) for k in range(-40, 41, 1)]   # empates
    vals += [0.125, 0.375, 2.5, 3.5, -0.125, -2.5, 0.03125, 1e-12, -1e-12, 0.0]
    rounding = [{"x": v, "r1": round(v, 1), "r3": round(v, 3), "r4": round(v, 4),
                 "f0": f"{v:.0f}", "f2": f"{v:.2f}"} for v in vals]
    sums = []
    for i in range(300):
        n = int(rng.integers(1, 40))
        scale = 10.0 ** int(rng.integers(-3, 4))
        xs = [float(v) for v in rng.normal(0, scale, n)]
        sums.append({"xs": xs, "sum": sum(xs)})
    sums.append({"xs": [0.1] * 10, "sum": sum([0.1] * 10)})
    sums.append({"xs": [1e16, 1.0, -1e16], "sum": sum([1e16, 1.0, -1e16])})
    return {"schema": SCHEMA, "python": platform.python_version(),
            "rounding": rounding, "sums": sums}


def write(case, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, f"{case['meta']['case']}.json")
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(case, fh, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    return path


def main():
    ap = argparse.ArgumentParser(description="Kairos MVP — exportar fixtures de paridad")
    ap.add_argument("--out-dir", default=FIXTURES)
    ap.add_argument("--wesad-dir", help="carpeta WESAD con S2/S2.pkl, ...")
    ap.add_argument("--max-subjects", type=int, default=3)
    args = ap.parse_args()

    index = []
    for case in build_cases():
        path = write(case, args.out_dir)
        index.append(os.path.basename(path))
        kinds = [e["kind"] for e in case["expected"]["events"]]
        print(f"  {case['meta']['case']}: {len(case['windows'])} ventanas · eventos {kinds}")

    with open(os.path.join(args.out_dir, "pycompat.json"), "w", encoding="utf-8",
              newline="\n") as fh:
        json.dump(build_pycompat(), fh, separators=(",", ":"), allow_nan=False)

    if args.wesad_dir:
        local = os.path.join(args.out_dir, "local")
        for case in build_wesad_cases(args.wesad_dir, args.max_subjects):
            write(case, local)
            print(f"  {case['meta']['case']}: {len(case['windows'])} ventanas (local)")
    else:
        print("  WESAD no indicado: solo fixtures sintéticas.")

    with open(os.path.join(args.out_dir, "index.json"), "w", encoding="utf-8",
              newline="\n") as fh:
        json.dump({"schema": SCHEMA, "cases": index}, fh, indent=1)


if __name__ == "__main__":
    main()
