// Motor en el mismo hilo: para tests. La app usa WorkerEngineClient.
import type { EngineConfig, FeatureWindow, UserAction } from '@kairos/engine';
import type { EngineClient } from './engineClient';
import { EngineRunner } from './runner';

export class InlineEngineClient implements EngineClient {
  private runner: EngineRunner;
  constructor(config: EngineConfig) {
    this.runner = new EngineRunner(config);
  }
  async step(w: FeatureWindow) {
    return this.runner.step(w);
  }
  async action(a: UserAction) {
    return this.runner.action(a);
  }
  async metrics() {
    return this.runner.metrics();
  }
  dispose() {}
}
