/**
 * Registros sintéticos.
 *
 * - `canonical`: el registro de build_replay.py (semilla 7) tal como lo exportó Python. Es
 *   bit a bit el mismo que usan las fixtures de paridad y el demo publicado.
 * - escenarios: el mismo generador (bases, desplazamientos, ruido, rampas de 120 s) con un
 *   PRNG propio, para demos cortas con un desenlace conocido. No intenta reproducir el
 *   PCG64 de numpy: sus números son otros, su estructura es la misma.
 */
import { pyRound, TRACKED, type FeatureValues, type FeatureWindow } from '@kairos/engine';
import { meta as canonicalMeta, windows as canonicalWindows } from '../../../fixtures/synthetic-seed7.json';
import { RecordSource, type KairosRecord } from './record';

type Condition = 'rest' | 'activation' | 'exercise';
type Block = [start: number, end: number, cond: Condition];

const BASE = {
  hr_mean: 72, sdnn: 52, rmssd: 42, pnn50: 18, eda_scl_mean: 2.4, eda_scl_slope: 0.0,
  eda_std: 0.15, eda_scr_count: 1.0, eda_scr_amp: 0.02, temp_mean: 33.2, temp_slope: 0.0,
  acc_move_std: 1.6, acc_move_mad: 1.2,
} as const;
type BaseKey = keyof typeof BASE;

const SHIFT: Record<Condition, Partial<Record<BaseKey, number>>> = {
  rest: {},
  activation: {
    hr_mean: +16, sdnn: -18, rmssd: -20, pnn50: -11, eda_scl_mean: +1.9, eda_scl_slope: +0.006,
    eda_scr_count: +4.5, temp_mean: -0.5, temp_slope: -0.004, acc_move_std: +0.15,
  },
  exercise: {
    hr_mean: +34, sdnn: -22, rmssd: -26, pnn50: -14, eda_scl_mean: +2.6, eda_scl_slope: +0.01,
    eda_scr_count: +6.0, temp_mean: +0.3, temp_slope: +0.004, acc_move_std: +9.0, acc_move_mad: +6.5,
  },
};

const NOISE: Record<BaseKey, number> = {
  hr_mean: 2.6, sdnn: 5.0, rmssd: 4.5, pnn50: 3.0, eda_scl_mean: 0.16, eda_scl_slope: 0.002,
  eda_std: 0.03, eda_scr_count: 0.8, eda_scr_amp: 0.006, temp_mean: 0.09, temp_slope: 0.001,
  acc_move_std: 0.35, acc_move_mad: 0.25,
};

/** PRNG mulberry32 + Box-Muller. */
function prng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return () => Math.sqrt(-2 * Math.log(Math.max(next(), 1e-12))) * Math.cos(2 * Math.PI * next());
}

/** Mismo algoritmo que synthetic_record() de build_replay.py, con bloques a elección. */
export function generateSynthetic(blocks: Block[], seed: number, stepSec = 30): FeatureWindow[] {
  const normal = prng(seed);
  const end = blocks[blocks.length - 1]![1];
  const out: FeatureWindow[] = [];
  for (let t = 0; t < end - 60; t += stepSec) {
    const [a, b, cond] = blocks.find(([s, e]) => s <= t && t < e)!;
    let ramp = cond !== 'rest' ? Math.min(1.0, (t - a) / 120.0, (b - t) / 120.0) : 1.0;
    ramp = Math.max(0.0, ramp);
    const f: Record<string, number> = {};
    for (const k of Object.keys(BASE) as BaseKey[]) {
      const d = (SHIFT[cond][k] ?? 0) * (cond !== 'rest' ? ramp : 1.0);
      const drift = k === 'temp_mean' ? 0.0008 * (t / 60.0) : 0.0;
      f[k] = BASE[k] + d + drift + normal() * NOISE[k];
    }
    f['eda_scr_count'] = Math.max(0, pyRound(f['eda_scr_count']!, 0));
    f['acc_move_std'] = Math.max(0.05, f['acc_move_std']!);
    const features = {} as FeatureValues;
    for (const k of TRACKED) features[k] = f[k] ?? null;
    out.push({
      t,
      features,
      extra: { eda_std: f['eda_std']!, eda_scr_amp: f['eda_scr_amp']!, acc_move_mad: f['acc_move_mad']! },
      label: cond === 'activation' ? 2 : 1,
    });
  }
  return out;
}

export type SyntheticScenarioId = 'canonical' | 'resolves' | 'escalates' | 'exercise';

export interface SyntheticScenario {
  id: SyntheticScenarioId;
  blocks: Block[] | null;
  seed: number;
}

/**
 * Escenarios. Las semillas están elegidas y fijadas por tests (synthetic.test.ts) para que
 * el desenlace con la configuración por defecto sea el descrito.
 */
export const SCENARIOS: Record<SyntheticScenarioId, SyntheticScenario> = {
  // 90 min: ejercicio bloqueado, episodio que escala y episodio que se resuelve
  canonical: { id: 'canonical', blocks: null, seed: 7 },
  // 30 min: un episodio breve que cede tras la respiración
  resolves: { id: 'resolves', blocks: [[0, 600, 'rest'], [600, 900, 'activation'], [900, 1800, 'rest']], seed: 3 },
  // 35 min: un episodio sostenido que no cede y escala
  escalates: { id: 'escalates', blocks: [[0, 600, 'rest'], [600, 1500, 'activation'], [1500, 2100, 'rest']], seed: 1 },
  // 25 min: ejercicio; el gating debe impedir cualquier intervención
  exercise: { id: 'exercise', blocks: [[0, 600, 'rest'], [600, 900, 'exercise'], [900, 1500, 'rest']], seed: 1 },
};

export function canonicalRecord(): KairosRecord {
  return {
    name: canonicalMeta.case,
    synthetic: true,
    stepSec: canonicalMeta.step_sec,
    windows: canonicalWindows as FeatureWindow[],
  };
}

export function scenarioRecord(id: SyntheticScenarioId): KairosRecord {
  const sc = SCENARIOS[id];
  if (!sc.blocks) return canonicalRecord();
  return { name: `sintetico-${id}`, synthetic: true, stepSec: 30, windows: generateSynthetic(sc.blocks, sc.seed) };
}

export class SyntheticSource extends RecordSource {
  constructor(readonly scenario: SyntheticScenarioId = 'canonical') {
    super(scenarioRecord(scenario), 'synthetic');
  }
}
