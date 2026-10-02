"""Las fixtures son la verdad contra la que se mide el port TS: estos tests aseguran que
están al día, que sobreviven el viaje por JSON y que el caso canónico coincide con el
replay publicado en kairos-tech."""

import json
import math
import os

import pytest

import export_fixtures as ef
from kairos_engine import KairosEngine, EngineConfig, TRACKED

FIX = ef.FIXTURES


def _load(name):
    with open(os.path.join(FIX, name), encoding="utf-8") as fh:
        return json.load(fh)


def _index():
    return _load("index.json")["cases"]


def test_index_lists_every_case():
    built = {c["meta"]["case"] + ".json" for c in ef.build_cases()}
    assert set(_index()) == built


@pytest.mark.parametrize("case", ef.build_cases(), ids=lambda c: c["meta"]["case"])
def test_fixture_files_are_up_to_date(case):
    # el JSON en disco es exactamente lo que produce el exportador hoy
    on_disk = _load(case["meta"]["case"] + ".json")
    fresh = json.loads(json.dumps(case, ensure_ascii=False, allow_nan=False))
    assert on_disk == fresh, "fixtures desactualizadas: corre export_fixtures.py"


@pytest.mark.parametrize("name", _index())
def test_windows_carry_every_tracked_key(name):
    for w in _load(name)["windows"]:
        assert set(w["features"]) == set(TRACKED)
        assert isinstance(w["t"], float)


@pytest.mark.parametrize("name", _index())
def test_json_roundtrip_reproduces_trace(name):
    """Alimentar el motor con las ventanas leídas desde JSON (null en vez de NaN) da la
    misma traza: el formato no pierde información que el motor use."""
    d = _load(name)
    eng = KairosEngine(EngineConfig(**d["config"]))
    for w in d["windows"]:
        eng.step(w["t"], w["features"])
    got = [{"t": s.t, "state": s.state, "score": s.score, "gated": s.gated,
            "ready": s.ready, "z": s.z, "reason": s.reason} for s in eng.trace]
    assert got == d["expected"]["trace"]
    assert eng.events == d["expected"]["events"]


def test_canonical_case_matches_published_replay():
    pub_path = os.path.join(ef.HERE, "kairos-replay", "demo-sintetico.json")
    with open(pub_path, encoding="utf-8") as fh:
        pub = json.load(fh)
    d = _load("synthetic-seed7.json")
    tr = d["expected"]["trace"]
    assert [s["state"] for s in tr] == pub["state"]
    assert [s["score"] for s in tr] == pub["score"]
    assert d["expected"]["events"] == pub["events"]
    assert d["expected"]["metrics"] == pub["metrics"]


def test_stale_exit_streak_is_reference_behaviour():
    """Caracterización (ver docs/ENGINE_DIVERGENCES.md, D-01): el motor de referencia no
    reinicia _exit_streak al entrar en WATCH. En el registro canónico, el WATCH de t=930
    hereda 1 y termina con una sola ventana bajo theta_exit (k_exit=2)."""
    ev = _load("synthetic-seed7.json")["expected"]["events"]
    kinds = [(e["t"], e["kind"]) for e in ev]
    assert (930.0, "watch") in kinds and (960.0, "watch_end") in kinds


def test_no_nan_in_fixtures():
    for name in _index():
        with open(os.path.join(FIX, name), encoding="utf-8") as fh:
            raw = fh.read()
        assert "NaN" not in raw and "Infinity" not in raw
