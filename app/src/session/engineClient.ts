/**
 * Cliente del motor. En la app el motor corre en un Web Worker; en los tests, en línea
 * (inlineEngineClient.ts). Ambas implementaciones tienen la misma interfaz y el mismo orden
 * de mensajes. Este archivo no importa el motor: el motor solo entra al bundle del worker.
 */
import type { EngineConfig, FeatureWindow, OperationalMetrics, UserAction } from '@kairos/engine';
import type { ActionResult, StepResult } from './runner';

export interface EngineClient {
  step(w: FeatureWindow): Promise<StepResult>;
  action(a: UserAction): Promise<ActionResult>;
  metrics(): Promise<OperationalMetrics | null>;
  dispose(): void;
}

export type WorkerRequest =
  | { id: number; type: 'init'; config: EngineConfig }
  | { id: number; type: 'step'; window: FeatureWindow }
  | { id: number; type: 'action'; action: UserAction }
  | { id: number; type: 'metrics' };

/** Omit distributivo: conserva la unión discriminada. */
type WithoutId<T> = T extends unknown ? Omit<T, 'id'> : never;

export type WorkerResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: string };

export class WorkerEngineClient implements EngineClient {
  private worker: Worker;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

  constructor(config: EngineConfig) {
    this.worker = new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const p = this.pending.get(e.data.id);
      if (!p) return;
      this.pending.delete(e.data.id);
      if (e.data.ok) p.resolve(e.data.result);
      else p.reject(new Error(e.data.error));
    };
    void this.call({ type: 'init', config });
  }

  step(w: FeatureWindow) {
    return this.call({ type: 'step', window: w }) as Promise<StepResult>;
  }
  action(a: UserAction) {
    return this.call({ type: 'action', action: a }) as Promise<ActionResult>;
  }
  metrics() {
    return this.call({ type: 'metrics' }) as Promise<OperationalMetrics | null>;
  }
  dispose() {
    this.worker.terminate();
    for (const p of this.pending.values()) p.reject(new Error('motor detenido'));
    this.pending.clear();
  }

  private call(req: WithoutId<WorkerRequest>): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ ...req, id } as WorkerRequest);
    });
  }
}
