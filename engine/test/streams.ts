// Flujos aleatorios reproducibles para probar invariantes más allá de las fixtures.
import { emptyFeatures, type FeatureValues } from '../src/index.js';

/** PRNG mulberry32: determinista y suficiente para tests. */
export function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const normal = () => {
    const u = Math.max(next(), 1e-12);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * next());
  };
  return { next, normal, int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)) };
}

const BASE: Record<string, number> = {
  hr_mean: 72, sdnn: 52, rmssd: 42, pnn50: 18, eda_scl_mean: 2.4, eda_scl_slope: 0,
  eda_scr_count: 1, temp_mean: 33.2, temp_slope: 0, acc_move_std: 1.6,
};
const NOISE: Record<string, number> = {
  hr_mean: 2.6, sdnn: 5, rmssd: 4.5, pnn50: 3, eda_scl_mean: 0.16, eda_scl_slope: 0.002,
  eda_scr_count: 0.8, temp_mean: 0.09, temp_slope: 0.001, acc_move_std: 0.35,
};
const ACT: Record<string, number> = {
  hr_mean: 16, sdnn: -18, rmssd: -20, pnn50: -11, eda_scl_mean: 1.9, eda_scl_slope: 0.006,
  eda_scr_count: 4.5, temp_mean: -0.5, temp_slope: -0.004, acc_move_std: 0.15,
};

/** Bloques aleatorios de reposo, activación de intensidad variable, movimiento y huecos. */
export function randomStream(seed: number, n: number, stepSec = 30): { t: number; features: FeatureValues }[] {
  const r = rng(seed);
  const out: { t: number; features: FeatureValues }[] = [];
  let mode = 'rest';
  let left = 10;
  let intensity = 1;
  for (let i = 0; i < n; i++) {
    if (left-- <= 0) {
      const p = r.next();
      mode = p < 0.45 ? 'rest' : p < 0.8 ? 'act' : p < 0.95 ? 'move' : 'gap';
      left = r.int(2, 30);
      intensity = 0.3 + r.next() * 2.5;
    }
    const f = emptyFeatures();
    for (const k of Object.keys(BASE)) {
      const shift = mode === 'act' ? (ACT[k] ?? 0) * intensity : 0;
      f[k as keyof FeatureValues] = BASE[k]! + shift + r.normal() * NOISE[k]!;
    }
    if (mode === 'move') f.acc_move_std = 6 + r.next() * 8;
    if (mode === 'gap' && r.next() < 0.7) {
      f.rmssd = null;
      f.hr_mean = null;
    }
    if (r.next() < 0.03) f.temp_slope = null;
    f.acc_move_std = Math.max(0.05, f.acc_move_std!);
    out.push({ t: i * stepSec, features: f });
  }
  return out;
}
