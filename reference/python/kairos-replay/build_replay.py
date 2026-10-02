"""
KAIROS — Constructor de replays
===============================

Recorre un registro completo ventana a ventana, se lo entrega al motor como si llegara
en vivo desde la muñeca, y exporta todo lo que hizo el sistema a un JSON que el
dashboard reproduce en el navegador.

Dos fuentes:

    --data-dir ./WESAD      registros reales de WESAD (señales de muñeca del E4)
    --synthetic             un registro sintético con un confusor de ejercicio dentro,
                            para probar el motor y el dashboard sin descargar 2.1 GB

La extracción de características NO se duplica aquí: se importa del script de
viabilidad que ya vive en el repo, así el replay y el análisis miden exactamente lo
mismo. Si mueves ese archivo, pásalo con --extractor.

Uso
---
    python build_replay.py --synthetic --out-dir ./data
    python build_replay.py --data-dir ./WESAD --out-dir ./data

Salidas en --out-dir:
    index.json          lista de replays disponibles (lo que lee el dashboard)
    <sujeto>.json       un replay completo: serie, eventos y métricas
"""

from __future__ import annotations

import argparse
import glob
import importlib.util
import json
import os
import pickle
import sys

import numpy as np

from kairos_engine import (
    KairosEngine, EngineConfig, config_dict, operational_metrics, TRACKED,
)

DEFAULT_EXTRACTOR = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "..", "wesad-feasibility", "kairos_wesad_separability.py",
)
LABEL_FS = 700
LABEL_NAMES = {0: "transición", 1: "reposo", 2: "estrés",
               3: "diversión", 4: "meditación"}


# --------------------------------------------------------------------------- #
# WESAD
# --------------------------------------------------------------------------- #
def load_extractor(path):
    path = os.path.abspath(path)
    if not os.path.exists(path):
        raise FileNotFoundError(
            f"No encuentro el extractor de features en {path}.\n"
            "Pásalo con --extractor, o corre en modo --synthetic.")
    spec = importlib.util.spec_from_file_location("kairos_features", path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules["kairos_features"] = mod
    spec.loader.exec_module(mod)
    return mod


def replay_wesad(pkl_path, ext, cfg):
    with open(pkl_path, "rb") as fh:
        data = pickle.load(fh, encoding="latin1")
    wrist = data["signal"]["wrist"]
    labels = np.asarray(data["label"]).ravel()
    subject = str(data["subject"])

    dur = len(labels) / LABEL_FS
    rows, win_labels = [], []
    for t0 in np.arange(0, dur - ext.WIN_SEC, cfg.step_sec):
        feats = ext.window_features(wrist, t0, ext.WIN_SEC)
        feats[ext.ALL_FEATURES[-1]] = feats.get(ext.ALL_FEATURES[-1])  # no-op defensivo
        seg = labels[int(t0 * LABEL_FS):int((t0 + ext.WIN_SEC) * LABEL_FS)]
        if len(seg) == 0:
            continue
        vals, counts = np.unique(seg, return_counts=True)
        lab = int(vals[np.argmax(counts)])
        rows.append((float(t0), feats))
        win_labels.append(lab if lab in LABEL_NAMES else 0)
    return subject, rows, win_labels, False


# --------------------------------------------------------------------------- #
# Registro sintético (incluye el confusor que el gating debe descartar)
# --------------------------------------------------------------------------- #
def synthetic_record(cfg, seed=7):
    """Bloques de 90 minutos, en segundos:
        0–1200    reposo
        1200–1500 ejercicio       (fisiología alta + movimiento alto -> debe bloquearse)
        1500–2100 reposo
        2100–3000 estrés          (fisiología alta, sin movimiento -> debe disparar)
        3000–4200 reposo
        4200–4500 estrés breve
        4500–5400 reposo
    """
    rng = np.random.default_rng(seed)
    blocks = [
        (0, 1200, "rest"), (1200, 1500, "exercise"), (1500, 2100, "rest"),
        (2100, 3000, "stress"), (3000, 4200, "rest"), (4200, 4500, "stress"),
        (4500, 5400, "rest"),
    ]
    base = {"hr_mean": 72, "sdnn": 52, "rmssd": 42, "pnn50": 18,
            "eda_scl_mean": 2.4, "eda_scl_slope": 0.0, "eda_std": 0.15,
            "eda_scr_count": 1.0, "eda_scr_amp": 0.02,
            "temp_mean": 33.2, "temp_slope": 0.0,
            "acc_move_std": 1.6, "acc_move_mad": 1.2}
    # desplazamiento multiplicativo/aditivo por condición
    shift = {
        "rest":     {},
        "stress":   {"hr_mean": +16, "sdnn": -18, "rmssd": -20, "pnn50": -11,
                     "eda_scl_mean": +1.9, "eda_scl_slope": +0.006,
                     "eda_scr_count": +4.5, "temp_mean": -0.5, "temp_slope": -0.004,
                     "acc_move_std": +0.15},
        "exercise": {"hr_mean": +34, "sdnn": -22, "rmssd": -26, "pnn50": -14,
                     "eda_scl_mean": +2.6, "eda_scl_slope": +0.010,
                     "eda_scr_count": +6.0, "temp_mean": +0.3, "temp_slope": +0.004,
                     "acc_move_std": +9.0, "acc_move_mad": +6.5},
    }
    noise = {"hr_mean": 2.6, "sdnn": 5.0, "rmssd": 4.5, "pnn50": 3.0,
             "eda_scl_mean": 0.16, "eda_scl_slope": 0.002, "eda_std": 0.03,
             "eda_scr_count": 0.8, "eda_scr_amp": 0.006,
             "temp_mean": 0.09, "temp_slope": 0.001,
             "acc_move_std": 0.35, "acc_move_mad": 0.25}

    rows, labels = [], []
    for t in np.arange(0, blocks[-1][1] - 60, cfg.step_sec):
        cond = next(c for a, b, c in blocks if a <= t < b)
        # rampa suave al entrar y salir del bloque, como en un registro real
        a, b = next((a, b) for a, b, c in blocks if a <= t < b)
        ramp = min(1.0, (t - a) / 120.0, (b - t) / 120.0) if cond != "rest" else 1.0
        ramp = max(0.0, ramp)
        f = {}
        for k, v in base.items():
            d = shift[cond].get(k, 0.0) * (ramp if cond != "rest" else 1.0)
            drift = 0.0008 * (t / 60.0) if k == "temp_mean" else 0.0
            f[k] = float(v + d + drift + rng.normal(0, noise[k]))
        f["eda_scr_count"] = max(0.0, round(f["eda_scr_count"]))
        f["acc_move_std"] = max(0.05, f["acc_move_std"])
        rows.append((float(t), f))
        labels.append(2 if cond == "stress" else 1)
    return "DEMO-sintético", rows, labels, True


# --------------------------------------------------------------------------- #
# Ejecución del motor + exportación
# --------------------------------------------------------------------------- #
def run_replay(subject, rows, labels, synthetic, cfg):
    eng = KairosEngine(cfg)
    for t, feats in rows:
        eng.step(t, feats)

    metrics = operational_metrics(eng.trace, eng.events, labels, cfg.step_sec)

    def col(key):
        return [round(float(f.get(key)), 3) if f.get(key) is not None
                and np.isfinite(f.get(key)) else None for _, f in rows]

    return {
        "subject": subject,
        "synthetic": synthetic,
        "step_sec": cfg.step_sec,
        "duration_sec": rows[-1][0] if rows else 0,
        "t": [round(s.t, 1) for s in eng.trace],
        "score": [s.score for s in eng.trace],
        "state": [s.state for s in eng.trace],
        "gated": [1 if s.gated else 0 for s in eng.trace],
        "reason": [s.reason for s in eng.trace],
        "label": labels[:len(eng.trace)],
        "label_names": LABEL_NAMES,
        "signals": {"hr": col("hr_mean"), "rmssd": col("rmssd"),
                    "eda": col("eda_scl_mean"), "acc": col("acc_move_std")},
        "events": eng.events,
        "metrics": metrics,
        "config": config_dict(cfg),
    }


def main():
    ap = argparse.ArgumentParser(description="Kairos — construir replays")
    ap.add_argument("--data-dir", help="carpeta WESAD con S2/S2.pkl, S3/S3.pkl, ...")
    ap.add_argument("--synthetic", action="store_true",
                    help="generar un registro sintético en vez de usar WESAD")
    ap.add_argument("--extractor", default=DEFAULT_EXTRACTOR,
                    help="ruta a kairos_wesad_separability.py")
    ap.add_argument("--out-dir", default="data")
    ap.add_argument("--step-sec", type=float, default=30.0)
    args = ap.parse_args()

    if not args.synthetic and not args.data_dir:
        ap.error("elige --synthetic o --data-dir")

    cfg = EngineConfig(step_sec=args.step_sec)
    os.makedirs(args.out_dir, exist_ok=True)
    index = []

    if args.synthetic:
        subject, rows, labels, syn = synthetic_record(cfg)
        payload = run_replay(subject, rows, labels, syn, cfg)
        name = "demo-sintetico"
        with open(os.path.join(args.out_dir, f"{name}.json"), "w") as fh:
            json.dump(payload, fh, ensure_ascii=False, separators=(",", ":"))
        index.append({"file": f"{name}.json", "subject": subject, "synthetic": True})
        print(f"  {subject}: {len(rows)} ventanas · {payload['metrics']}")
    else:
        ext = load_extractor(args.extractor)
        paths = sorted(glob.glob(os.path.join(args.data_dir, "**", "S*.pkl"),
                                 recursive=True))
        if not paths:
            raise FileNotFoundError(
                f"No hay .pkl de WESAD en {args.data_dir!r} "
                "(esperado WESAD/S2/S2.pkl, ...)")
        for p in paths:
            subject, rows, labels, syn = replay_wesad(p, ext, cfg)
            payload = run_replay(subject, rows, labels, syn, cfg)
            fname = f"{subject}.json"
            with open(os.path.join(args.out_dir, fname), "w") as fh:
                json.dump(payload, fh, ensure_ascii=False, separators=(",", ":"))
            index.append({"file": fname, "subject": subject, "synthetic": False})
            m = payload["metrics"]
            print(f"  {subject}: {m['windows']} ventanas · "
                  f"{m['interventions']} intervenciones · "
                  f"{m['false_alarms']} falsas alarmas · "
                  f"cobertura {m['coverage']}")

    with open(os.path.join(args.out_dir, "index.json"), "w") as fh:
        json.dump({"replays": index}, fh, ensure_ascii=False, indent=1)
    print(f"\nListo. {len(index)} replay(s) en {args.out_dir}/")


if __name__ == "__main__":
    main()
