// Carga de fixtures exportadas por reference/python/export_fixtures.py
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EngineConfig, EngineEvent, EngineState, OperationalMetrics, FeatureWindow } from '../src/index.js';

export const FIXTURES_DIR = join(import.meta.dirname, '..', '..', 'fixtures');

export interface FixtureCase {
  schema: number;
  meta: { case: string; description: string; synthetic: boolean; step_sec: number };
  config: EngineConfig;
  windows: Required<Pick<FeatureWindow, 't' | 'features' | 'label'>>[];
  expected: { trace: EngineState[]; events: EngineEvent[]; metrics: OperationalMetrics };
}

export function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf-8')) as T;
}

/** Casos públicos (index.json) + locales (fixtures/local/*.json, p. ej. WESAD). */
export function loadCases(): FixtureCase[] {
  const idx = readJson<{ cases: string[] }>(join(FIXTURES_DIR, 'index.json'));
  const paths = idx.cases.map((c) => join(FIXTURES_DIR, c));
  const local = join(FIXTURES_DIR, 'local');
  if (existsSync(local)) {
    for (const f of readdirSync(local)) if (f.endsWith('.json')) paths.push(join(local, f));
  }
  return paths.map((p) => readJson<FixtureCase>(p));
}
