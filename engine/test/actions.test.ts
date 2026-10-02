// Extensión X-01: acciones explícitas del usuario. No existe en el Python; se prueba aparte.
import { describe, expect, it } from 'vitest';
import { KairosEngine } from '../src/index.js';
import { loadCases } from './fixtures.js';

const canonical = loadCases().find((c) => c.meta.case === 'synthetic-seed7')!;

/** Corre el registro canónico hasta que el motor entra en `state`. */
function runUntil(state: string) {
  const eng = new KairosEngine(canonical.config);
  let i = 0;
  for (; i < canonical.windows.length; i++) {
    const w = canonical.windows[i]!;
    if (eng.step(w.t, w.features).state === state) break;
  }
  return { eng, i, t: canonical.windows[i]!.t };
}

describe('end_intervention', () => {
  it('pasa de INTERVENE a RECOVERY con un evento del usuario', () => {
    const { eng, t } = runUntil('INTERVENE');
    expect(t).toBe(2160);
    const ev = eng.applyAction({ kind: 'end_intervention', t: t + 40 });
    expect(ev).toEqual({
      t: 2200,
      kind: 'intervention_end',
      detail: 'respiración terminada por el usuario',
      state: 'RECOVERY',
      actor: 'user',
    });
    expect(eng.state).toBe('RECOVERY');
    expect(eng.internals.phaseStart).toBe(2200);
    expect(eng.internals.exitStreak).toBe(0);
  });

  it('la gracia de RECOVERY se cuenta desde la acción', () => {
    const { eng, i, t } = runUntil('INTERVENE');
    eng.applyAction({ kind: 'end_intervention', t });
    const grace = canonical.config.recovery_grace_sec;
    let escalatedAt: number | null = null;
    for (const w of canonical.windows.slice(i + 1)) {
      eng.step(w.t, w.features);
      if (eng.state === 'ESCALATE') {
        escalatedAt = w.t;
        break;
      }
    }
    // en el registro canónico la activación no cede: escala justo al cumplir la gracia
    expect(escalatedAt).toBe(t + grace);
  });

  it('se ignora fuera de INTERVENE', () => {
    const { eng } = runUntil('WATCH');
    const before = JSON.stringify([eng.internals, eng.events, eng.state]);
    expect(eng.applyAction({ kind: 'end_intervention', t: 1e6 })).toBeNull();
    expect(JSON.stringify([eng.internals, eng.events, eng.state])).toBe(before);
  });

  it('un t anterior a la última ventana se lleva a esa ventana', () => {
    const { eng, t } = runUntil('INTERVENE');
    expect(eng.applyAction({ kind: 'end_intervention', t: t - 500 })!.t).toBe(t);
  });
});

describe.each(['cancel_escalation', 'open_escalation'] as const)('%s', (kind) => {
  it('sale de ESCALATE a IDLE con cooldown, como la salida natural', () => {
    const { eng, i, t } = runUntil('ESCALATE');
    expect(t).toBe(2550);
    const ev = eng.applyAction({ kind, t: t + 12 });
    expect(ev?.kind).toBe(kind === 'cancel_escalation' ? 'escalation_cancelled' : 'escalation_opened');
    expect(ev?.actor).toBe('user');
    expect(eng.state).toBe('IDLE');
    const until = 2562 + canonical.config.cooldown_sec;
    expect(eng.internals.cooldownUntil).toBe(until);
    expect(eng.internals.episodeStart).toBeNull();
    // el resto del registro no interviene durante el cooldown
    for (const w of canonical.windows.slice(i + 1)) {
      const n = eng.events.length;
      eng.step(w.t, w.features);
      for (const e of eng.events.slice(n)) {
        if (e.kind === 'intervene') expect(e.t).toBeGreaterThanOrEqual(until);
      }
    }
  });

  it('se ignora fuera de ESCALATE', () => {
    const { eng } = runUntil('RECOVERY');
    expect(eng.applyAction({ kind, t: 0 })).toBeNull();
    expect(eng.state).toBe('RECOVERY');
  });
});

it('sin acciones, el motor no emite eventos de usuario', () => {
  for (const fx of loadCases()) {
    const eng = new KairosEngine(fx.config);
    for (const w of fx.windows) eng.step(w.t, w.features);
    expect(eng.events.some((e) => 'actor' in e)).toBe(false);
  }
});
