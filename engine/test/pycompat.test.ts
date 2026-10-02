import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { pyFixed, pyRound, pySum } from '../src/index.js';
import { FIXTURES_DIR, readJson } from './fixtures.js';

interface PyCompat {
  rounding: { x: number; r1: number; r3: number; r4: number; f0: string; f2: string }[];
  sums: { xs: number[]; sum: number }[];
}
const fx = readJson<PyCompat>(join(FIXTURES_DIR, 'pycompat.json'));

describe('pycompat contra CPython', () => {
  it('pyRound y pyFixed reproducen round() y format() en todos los valores', () => {
    const bad = fx.rounding.filter(
      (r) =>
        pyRound(r.x, 1) !== r.r1 ||
        pyRound(r.x, 3) !== r.r3 ||
        pyRound(r.x, 4) !== r.r4 ||
        pyFixed(r.x, 0) !== r.f0 ||
        pyFixed(r.x, 2) !== r.f2,
    );
    expect(bad).toEqual([]);
  });

  it('pySum reproduce sum() bit a bit', () => {
    const bad = fx.sums.filter((s) => pySum(s.xs) !== s.sum);
    expect(bad).toEqual([]);
  });

  it('casos conocidos', () => {
    expect(pySum(Array(10).fill(0.1))).toBe(1.0);
    expect(pyRound(0.03125, 4)).toBe(0.0312);
    expect(pyFixed(0.125, 2)).toBe('0.12');
    expect(pyFixed(0.375, 2)).toBe('0.38');
    expect(pyFixed(2.5, 0)).toBe('2');
    expect(pyFixed(-0.125, 2)).toBe('-0.12');
  });
});
