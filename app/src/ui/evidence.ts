/**
 * Evidencia de la detección: las features con mayor z ponderado en la dirección de la
 * activación, dichas en lenguaje llano. Se nombran antes de proponer cualquier cosa.
 */
import { FEATURE_WEIGHTS, type EngineState, type ScoredKey } from '@kairos/engine';
import { S } from './strings';

export interface Evidence {
  key: ScoredKey;
  /** z del motor (redondeado a 3 decimales, como en la traza) */
  z: number;
  /** w·z: aporte al score en la dirección de la activación */
  contribution: number;
  text: string;
}

/** Aporte mínimo para que una señal se nombre. */
export const MIN_CONTRIBUTION = 0.25;

export function topEvidence(z: EngineState['z'], n = 3): Evidence[] {
  const out: Evidence[] = [];
  for (const [k, w] of Object.entries(FEATURE_WEIGHTS) as [ScoredKey, number][]) {
    const zk = z[k];
    if (zk === undefined) continue;
    const contribution = w * zk;
    if (contribution < MIN_CONTRIBUTION) continue;
    const base = (w > 0 ? S.evidence.up : S.evidence.down)[k as never] as string | undefined;
    if (!base) continue;
    const text = Math.abs(zk) >= 2 ? strengthen(base) : base;
    out.push({ key: k, z: zk, contribution, text: `${text} que en tu reposo` });
  }
  return out.sort((a, b) => b.contribution - a.contribution).slice(0, n);
}

/** "Tu pulso está más alto" -> "Tu pulso está bastante más alto" */
function strengthen(text: string): string {
  return text.replace(/\bmás\b/, `${S.evidence.strong} más`).replace(/\bmenos\b/, `${S.evidence.strong} menos`);
}
