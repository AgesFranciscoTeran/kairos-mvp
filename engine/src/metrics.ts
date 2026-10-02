/**
 * Métricas operativas (port de `operational_metrics` de kairos_engine.py).
 *
 * `labels` es la etiqueta real de cada ventana (mismo orden que `trace`), solo para
 * evaluar: el motor nunca la ve.
 *
 * - falsas alarmas por hora: intervenciones que arrancan fuera de un episodio real
 * - cobertura: fracción de episodios reales con al menos una intervención
 * - latencia: segundos entre el inicio del episodio y la intervención
 * - TTB: lo que reporta el evento `resolved` (ver H-04)
 */

import type { EngineEvent, EngineState } from './engine.js';
import { pyRound } from './pycompat.js';

export interface OperationalMetrics {
  windows: number;
  hours_total: number;
  episodes_real: number;
  episodes_covered: number;
  coverage: number | null;
  interventions: number;
  false_alarms: number;
  false_alarms_per_rest_hour: number | null;
  detection_latency_median_s: number | null;
  gated_fraction: number;
  escalations: number;
  ttb_median_s: number | null;
}

function median(v: number[]): number | null {
  if (v.length === 0) return null;
  const s = [...v].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** Extrae el TTB del texto del evento, igual que el Python: split("TTB")[1].split("s")[0]. */
export function ttbFromDetail(detail: string): number | null {
  if (!detail.includes('TTB')) return null;
  const n = Number(detail.split('TTB')[1]!.split('s')[0]);
  return Number.isFinite(n) ? n : null;
}

export function operationalMetrics(
  traceIn: readonly EngineState[],
  events: readonly EngineEvent[],
  labelsIn: readonly number[],
  stepSec: number,
  stressLabel = 2,
): OperationalMetrics {
  const n = Math.min(traceIn.length, labelsIn.length);
  const trace = traceIn.slice(0, n);
  const labels = labelsIn.slice(0, n);

  // bloques contiguos de la condición etiquetada
  const episodes: [number, number][] = [];
  let start: number | null = null;
  labels.forEach((lab, i) => {
    if (lab === stressLabel && start === null) {
      start = i;
    } else if (lab !== stressLabel && start !== null) {
      episodes.push([start, i - 1]);
      start = null;
    }
  });
  if (start !== null) episodes.push([start, n - 1]);

  const inEpisode = (i: number) => episodes.some(([a, b]) => a <= i && i <= b);

  // dict de Python: si dos ventanas comparten t redondeado, gana la última
  const tOf = new Map<number, number>();
  trace.forEach((s, i) => tOf.set(pyRound(s.t, 1), i));
  const triggers = events.filter((e) => e.kind === 'intervene');

  let falseAlarms = 0;
  const trueHits: number[] = [];
  const latencies: number[] = [];
  for (const e of triggers) {
    const i = tOf.get(pyRound(e.t, 1));
    if (i === undefined) continue;
    if (inEpisode(i)) {
      trueHits.push(i);
      for (const [a, b] of episodes) {
        if (a <= i && i <= b) {
          latencies.push((i - a) * stepSec);
          break;
        }
      }
    } else {
      falseAlarms += 1;
    }
  }

  const covered = episodes.filter(([a, b]) => trueHits.some((i) => a <= i && i <= b)).length;

  let restWindows = 0;
  for (let i = 0; i < n; i++) if (!inEpisode(i)) restWindows += 1;
  const restHours = (restWindows * stepSec) / 3600.0;
  const gatedWindows = trace.filter((s) => s.gated).length;

  const ttbs = events
    .filter((e) => e.kind === 'resolved' && e.detail.includes('TTB'))
    .map((e) => ttbFromDetail(e.detail))
    .filter((v): v is number => v !== null);

  return {
    windows: n,
    hours_total: pyRound((n * stepSec) / 3600.0, 2),
    episodes_real: episodes.length,
    episodes_covered: covered,
    coverage: episodes.length ? pyRound(covered / episodes.length, 3) : null,
    interventions: triggers.length,
    false_alarms: falseAlarms,
    false_alarms_per_rest_hour: restHours ? pyRound(falseAlarms / restHours, 3) : null,
    detection_latency_median_s: median(latencies),
    gated_fraction: pyRound(gatedWindows / n, 3),
    escalations: events.filter((e) => e.kind === 'escalate').length,
    ttb_median_s: median(ttbs),
  };
}
