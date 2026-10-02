// Paridad con el motor Python: mismas ventanas -> misma traza. Sin acciones de usuario.
import { describe, expect, it } from 'vitest';
import { KairosEngine, operationalMetrics } from '../src/index.js';
import { loadCases } from './fixtures.js';

const TOL = 1e-6;
const cases = loadCases();

describe.each(cases.map((c) => [c.meta.case, c] as const))('paridad · %s', (_name, fx) => {
  const eng = new KairosEngine(fx.config);
  for (const w of fx.windows) eng.step(w.t, w.features);

  it('misma cantidad de ventanas en la traza', () => {
    expect(eng.trace).toHaveLength(fx.expected.trace.length);
  });

  it('estado, gated, ready, t y reason exactos; score y z con tolerancia 1e-6', () => {
    const mismatches: string[] = [];
    fx.expected.trace.forEach((exp, i) => {
      const got = eng.trace[i]!;
      const at = `ventana ${i} (t=${exp.t})`;
      if (got.state !== exp.state) mismatches.push(`${at}: state ${got.state} != ${exp.state}`);
      if (got.gated !== exp.gated) mismatches.push(`${at}: gated`);
      if (got.ready !== exp.ready) mismatches.push(`${at}: ready`);
      if (got.t !== exp.t) mismatches.push(`${at}: t`);
      if (got.reason !== exp.reason) mismatches.push(`${at}: reason "${got.reason}" != "${exp.reason}"`);
      if ((got.score === null) !== (exp.score === null)) {
        mismatches.push(`${at}: score ${got.score} != ${exp.score}`);
      } else if (got.score !== null && Math.abs(got.score - exp.score!) > TOL) {
        mismatches.push(`${at}: score ${got.score} != ${exp.score}`);
      }
      const gk = Object.keys(got.z).sort().join(',');
      const ek = Object.keys(exp.z).sort().join(',');
      if (gk !== ek) mismatches.push(`${at}: claves z ${gk} != ${ek}`);
      for (const [k, v] of Object.entries(exp.z)) {
        const g = got.z[k as keyof typeof got.z];
        if (g === undefined || Math.abs(g - v!) > TOL) mismatches.push(`${at}: z.${k} ${g} != ${v}`);
      }
    });
    expect(mismatches).toEqual([]);
  });

  it('eventos idénticos (t, kind, detail, state)', () => {
    expect(eng.events).toEqual(fx.expected.events);
  });

  it('métricas operativas idénticas', () => {
    const labels = fx.windows.map((w) => w.label);
    const got = operationalMetrics(eng.trace, eng.events, labels, fx.config.step_sec);
    expect(got).toEqual(fx.expected.metrics);
  });
});

it('hay al menos el caso canónico', () => {
  expect(cases.map((c) => c.meta.case)).toContain('synthetic-seed7');
});
