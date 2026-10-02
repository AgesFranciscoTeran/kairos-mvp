/**
 * Dirección y peso de cada feature bajo activación simpática.
 * Signo +: sube con la activación. Signo -: baja con la activación.
 * Idéntico a FEATURE_WEIGHTS de kairos_engine.py (el orden importa: define el orden de
 * suma del score).
 */
export const FEATURE_WEIGHTS = {
  hr_mean: +0.9, // taquicardia
  rmssd: -1.0, // retirada vagal (el indicador más limpio)
  sdnn: -0.5,
  pnn50: -0.4,
  eda_scl_mean: +1.0, // nivel tónico de conductancia
  eda_scl_slope: +0.4,
  eda_scr_count: +0.7, // respuestas fásicas
  temp_mean: -0.5, // vasoconstricción periférica
  temp_slope: -0.3,
} as const;

export type ScoredKey = keyof typeof FEATURE_WEIGHTS;
export const SCORED_KEYS = Object.keys(FEATURE_WEIGHTS) as ScoredKey[];

/** Feature de movimiento usada para el gating (no entra en el score). */
export const GATE_FEATURE = 'acc_move_std' as const;

/** Features que la línea base necesita seguir. */
export const TRACKED = [...SCORED_KEYS, GATE_FEATURE] as const;
export type TrackedKey = ScoredKey | typeof GATE_FEATURE;

/** Features mínimas para que una ventana sea interpretable. */
export const REQUIRED_KEYS = ['hr_mean', 'rmssd', 'eda_scl_mean', GATE_FEATURE] as const;

/** Valores de una ventana. `null` = no disponible (NaN/None en Python). */
export type FeatureValues = Record<TrackedKey, number | null>;

/**
 * Una ventana de features, tal como la emite cualquier `SensorSource`.
 * El motor solo recibe `t` y `features`; `label` es solo para evaluar.
 */
export interface FeatureWindow {
  /** segundos de registro desde el inicio de la sesión */
  t: number;
  /** todas las claves de TRACKED */
  features: FeatureValues;
  /** features extra del extractor que el motor no usa (eda_std, acc_move_mad…) */
  extra?: Record<string, number | null>;
  /** etiqueta de evaluación (WESAD: 1 reposo, 2 condición de activación) */
  label?: number;
}

/** Ventana con todas las claves en null (útil para fuentes parciales). */
export function emptyFeatures(): FeatureValues {
  const out = {} as FeatureValues;
  for (const k of TRACKED) out[k] = null;
  return out;
}
