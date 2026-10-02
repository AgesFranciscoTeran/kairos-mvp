// Invariantes de seguridad del motor. Corren sobre las fixtures y sobre flujos aleatorios,
// sin acciones de usuario (motor de referencia puro) y con acciones (extensión X-01).
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, KairosEngine, type EngineConfig, type UserAction } from '../src/index.js';
import { loadCases } from './fixtures.js';
import { randomStream, rng } from './streams.js';

type Win = { t: number; features: Record<string, number | null> };

function checkRun(cfg: Partial<EngineConfig>, windows: Win[], actionSeed?: number): string[] {
  const eng = new KairosEngine(cfg);
  const violations: string[] = [];
  const r = actionSeed === undefined ? null : rng(actionSeed);
  let sawIntervene = false; // hubo INTERVENE en el episodio en curso

  for (const w of windows) {
    const before = eng.internals;
    const stateBefore = eng.state;
    const nEvents = eng.events.length;
    const st = eng.step(w.t, w.features);
    const after = eng.internals;
    const newEvents = eng.events.slice(nEvents);
    const baselineChanged =
      before.ready && JSON.stringify([before.mu, before.sd]) !== JSON.stringify([after.mu, after.sd]);

    if (st.gated && baselineChanged) violations.push(`t=${w.t}: ventana bloqueada actualizó la línea base`);
    if (stateBefore !== 'IDLE' && baselineChanged) {
      violations.push(`t=${w.t}: línea base actualizada en ${stateBefore}`);
    }
    if (!before.ready) {
      const decided = newEvents.some((e) => e.kind !== 'baseline_ready');
      if (decided || st.state !== 'IDLE' || st.gated || st.score !== 0) {
        violations.push(`t=${w.t}: decisión antes de completar el warmup`);
      }
    }
    for (const e of newEvents) {
      if (e.kind === 'intervene') {
        if (w.t < before.cooldownUntil) violations.push(`t=${w.t}: INTERVENE en cooldown`);
        sawIntervene = true;
      }
      if (e.kind === 'escalate' && !sawIntervene) violations.push(`t=${w.t}: ESCALATE sin INTERVENE`);
      if (e.kind === 'resolved') sawIntervene = false;
    }
    if (stateBefore === 'ESCALATE' && st.state !== 'ESCALATE') sawIntervene = false;

    // extensión: acciones aleatorias del usuario entre ventanas
    if (r && r.next() < 0.5) {
      const kinds: UserAction['kind'][] = ['end_intervention', 'cancel_escalation', 'open_escalation'];
      const ev = eng.applyAction({ kind: kinds[r.int(0, 2)]!, t: w.t + r.next() * 20 });
      if (ev && ev.kind !== 'intervention_end') sawIntervene = false;
    }
  }
  return violations;
}

describe('invariantes sobre las fixtures', () => {
  for (const fx of loadCases()) {
    it(fx.meta.case, () => {
      expect(checkRun(fx.config, fx.windows)).toEqual([]);
    });
  }
});

describe('invariantes sobre flujos aleatorios', () => {
  const configs: Partial<EngineConfig>[] = [
    {},
    { warmup_windows: 3, k_act: 2, k_exit: 1, cooldown_sec: 60, recovery_grace_sec: 60 },
    { gate_release_windows: 1, theta_watch: 0.2, theta_act: 0.4, theta_exit: 0.1 },
    { intervention_sec: 30, recovery_grace_sec: 30, cooldown_sec: 0 },
  ];
  configs.forEach((cfg, ci) => {
    it(`config ${ci} · 40 flujos sin acciones`, () => {
      for (let s = 1; s <= 40; s++) expect(checkRun(cfg, randomStream(s * 97 + ci, 400))).toEqual([]);
    });
    it(`config ${ci} · 40 flujos con acciones del usuario`, () => {
      for (let s = 1; s <= 40; s++) {
        expect(checkRun(cfg, randomStream(s * 131 + ci, 400), s)).toEqual([]);
      }
    });
  });

  it('los flujos aleatorios ejercitan todos los estados', () => {
    const seen = new Set<string>();
    for (let s = 1; s <= 40; s++) {
      const eng = new KairosEngine({ ...DEFAULT_CONFIG, k_act: 2 });
      for (const w of randomStream(s, 400)) seen.add(eng.step(w.t, w.features).state);
    }
    expect([...seen].sort()).toEqual(['ESCALATE', 'IDLE', 'INTERVENE', 'RECOVERY', 'WATCH']);
  });
});
