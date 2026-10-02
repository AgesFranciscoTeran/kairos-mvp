/// <reference lib="webworker" />
// El motor vive aquí, fuera del hilo de la UI. Solo recibe ventanas y acciones; no hace red.
import { EngineRunner } from './runner';
import type { WorkerRequest, WorkerResponse } from './engineClient';

let runner: EngineRunner | null = null;

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;
  let res: WorkerResponse;
  try {
    let result: unknown = null;
    if (req.type === 'init') {
      runner = new EngineRunner(req.config);
    } else {
      if (!runner) throw new Error('motor sin inicializar');
      if (req.type === 'step') result = runner.step(req.window);
      else if (req.type === 'action') result = runner.action(req.action);
      else result = runner.metrics();
    }
    res = { id: req.id, ok: true, result };
  } catch (err) {
    res = { id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  (self as unknown as Worker).postMessage(res);
};
