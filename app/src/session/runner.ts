/**
 * EngineRunner: lo único que toca el motor. Corre dentro del Web Worker (y en línea en los
 * tests). Separa la etiqueta de evaluación ANTES de llamar al motor: el motor recibe solo
 * `t` y `features`.
 */
import {
  KairosEngine,
  operationalMetrics,
  type EngineConfig,
  type EngineEvent,
  type EngineState,
  type FeatureWindow,
  type OperationalMetrics,
  type UserAction,
} from '@kairos/engine';

export interface RunnerInternals {
  ready: boolean;
  warmCount: number;
  warmupWindows: number;
  cooldownUntil: number;
  episodeStart: number | null;
  phaseStart: number;
}

export interface StepResult {
  state: EngineState;
  events: EngineEvent[];
  internals: RunnerInternals;
}

export interface ActionResult {
  event: EngineEvent | null;
  internals: RunnerInternals;
}

export class EngineRunner {
  private engine: KairosEngine;
  private labels: (number | null)[] = [];

  constructor(readonly config: EngineConfig) {
    this.engine = new KairosEngine(config);
  }

  step(w: FeatureWindow): StepResult {
    const { t, features, label } = w;
    this.labels.push(label ?? null);
    const n = this.engine.events.length;
    const state = this.engine.step(t, features);
    return { state, events: this.engine.events.slice(n), internals: this.internals() };
  }

  action(a: UserAction): ActionResult {
    return { event: this.engine.applyAction(a), internals: this.internals() };
  }

  /** Métricas operativas, solo si todas las ventanas traían etiqueta (replay etiquetado). */
  metrics(): OperationalMetrics | null {
    if (this.labels.length === 0 || this.labels.some((l) => l === null)) return null;
    return operationalMetrics(this.engine.trace, this.engine.events, this.labels as number[], this.config.step_sec);
  }

  private internals(): RunnerInternals {
    const i = this.engine.internals;
    return {
      ready: i.ready,
      warmCount: i.warmCount,
      warmupWindows: this.config.warmup_windows,
      cooldownUntil: i.cooldownUntil,
      episodeStart: i.episodeStart,
      phaseStart: i.phaseStart,
    };
  }
}
