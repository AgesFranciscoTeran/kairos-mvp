import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { KairosEngine, TRACKED, type FeatureWindow } from '@kairos/engine';
import { describe, expect, it } from 'vitest';
import { FakeScheduler, PlaybackClock, type Speed } from '../session/clock';
import { accFeatures, classifyMotion, MotionBuffer, SimulatedMotionProvider, type MotionProvider, type MotionSample } from './motion';
import { HybridSource, PhoneImuSource } from './phone';
import { parseRecord, RecordFormatError, ReplaySource, type KairosRecord } from './record';
import { canonicalRecord, generateSynthetic, scenarioRecord, SCENARIOS, SyntheticSource } from './synthetic';
import type { SensorSource } from './types';

const FIX = join(import.meta.dirname, '..', '..', '..', 'fixtures');
const fixture = (name: string) => JSON.parse(readFileSync(join(FIX, name), 'utf-8'));

/** Arranca una fuente con un reloj falso y devuelve lo que emitió tras `wallSec` s reales. */
async function runSource(
  src: SensorSource,
  opts: { speed?: Speed; wallSec: number; sched?: FakeScheduler; onWall?: (sec: number, clock: PlaybackClock) => void },
) {
  const sched = opts.sched ?? new FakeScheduler();
  const clock = new PlaybackClock(opts.speed ?? 1, sched);
  const windows: FeatureWindow[] = [];
  const statuses: string[] = [];
  src.onWindow((w) => windows.push(w));
  src.onStatus((s) => statuses.push(s.kind));
  clock.start();
  await src.start(clock);
  for (let s = 0; s < opts.wallSec; s++) {
    opts.onWall?.(s, clock);
    sched.advance(1000);
  }
  return { windows, statuses, clock, sched };
}

/** Pasa ventanas por el motor como lo hará el runner: la etiqueta no entra. */
function runEngine(windows: FeatureWindow[]) {
  const eng = new KairosEngine();
  const states = windows.map((w) => eng.step(w.t, w.features));
  return { eng, states, kinds: eng.events.map((e) => e.kind) };
}

// --------------------------------------------------------------------------- //
describe('reloj de sesión', () => {
  it('avanza a la velocidad elegida y respeta la pausa', () => {
    const sched = new FakeScheduler();
    const clock = new PlaybackClock(10, sched);
    clock.start();
    sched.advance(2000);
    expect(clock.now()).toBeCloseTo(20);
    clock.pause();
    sched.advance(5000);
    expect(clock.now()).toBeCloseTo(20);
    clock.resume();
    clock.setSpeed(1);
    sched.advance(3000);
    expect(clock.now()).toBeCloseTo(23);
  });
});

// --------------------------------------------------------------------------- //
describe('formato de registro', () => {
  it('una fixture es un registro válido', () => {
    const rec = parseRecord(fixture('synthetic-seed7.json'));
    expect(rec.windows).toHaveLength(178);
    expect(rec.stepSec).toBe(30);
    expect(rec.synthetic).toBe(true);
    expect(Object.keys(rec.windows[0]!.features).sort()).toEqual([...TRACKED].sort());
  });

  it.each([
    ['sin ventanas', { windows: [] }, /windows/],
    ['falta una feature', { windows: [{ t: 0, features: { hr_mean: 1 } }] }, /falta la feature/],
    ['t no creciente', { windows: [0, 0].map((t) => ({ t, features: Object.fromEntries(TRACKED.map((k) => [k, 1])) })) }, /creciente/],
    ['valor no numérico', { windows: [{ t: 0, features: { ...Object.fromEntries(TRACKED.map((k) => [k, 1])), rmssd: 'x' } }] }, /número o null/],
  ])('rechaza: %s', (_n, raw, msg) => {
    expect(() => parseRecord(raw)).toThrow(RecordFormatError);
    expect(() => parseRecord(raw)).toThrow(msg);
  });

  it('ReplaySource lee un archivo local', async () => {
    const blob = new Blob([JSON.stringify(fixture('synthetic-seed1.json'))]);
    const src = await ReplaySource.fromFile(Object.assign(blob, { name: 'S2.json' }));
    expect(src.meta.kind).toBe('replay');
    expect(src.meta.labeled).toBe(true);
    await expect(ReplaySource.fromFile(new Blob(['{no json']))).rejects.toThrow(/JSON válido/);
  });
});

// --------------------------------------------------------------------------- //
describe('SyntheticSource y ReplaySource (reproducción)', () => {
  it('emite cada ventana cuando el reloj de registro llega a su t, y termina', async () => {
    const src = new SyntheticSource('canonical');
    // a 30×, 1 s real = 30 s de registro = 1 ventana
    const { windows, statuses } = await runSource(src, { speed: 30, wallSec: 10 });
    expect(windows.map((w) => w.t)).toEqual([0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300]);
    expect(statuses).toEqual(['running']);
    const all = await runSource(new SyntheticSource('canonical'), { speed: 30, wallSec: 200 });
    expect(all.windows).toHaveLength(178);
    expect(all.statuses).toEqual(['running', 'ended']);
  });

  it('la pausa detiene la emisión y la reanudación la retoma', async () => {
    const { windows } = await runSource(new SyntheticSource('canonical'), {
      speed: 30,
      wallSec: 10,
      onWall: (s, clock) => {
        if (s === 3) clock.pause();
        if (s === 8) clock.resume();
      },
    });
    // 3 s a 30× (t ≤ 90) + 2 s tras reanudar (t ≤ 150)
    expect(windows.map((w) => w.t)).toEqual([0, 30, 60, 90, 120, 150]);
  });

  it('el registro canónico es bit a bit el de Python y el motor reproduce sus eventos', async () => {
    const fx = fixture('synthetic-seed7.json');
    expect(canonicalRecord().windows.map((w) => w.features)).toEqual(fx.windows.map((w: FeatureWindow) => w.features));
    const { windows } = await runSource(new SyntheticSource('canonical'), { speed: 30, wallSec: 200 });
    expect(runEngine(windows).eng.events).toEqual(fx.expected.events);
  });

  it('las etiquetas viajan con la ventana, no se pierden', async () => {
    const { windows } = await runSource(new SyntheticSource('canonical'), { speed: 30, wallSec: 200 });
    expect(windows.filter((w) => w.label === 2)).toHaveLength(40);
  });

  it('una ventana emitida es una copia: mutarla no altera el registro', async () => {
    const src = new SyntheticSource('canonical');
    const { windows } = await runSource(src, { speed: 30, wallSec: 2 });
    windows[0]!.features.hr_mean = -1;
    expect(src.record.windows[0]!.features.hr_mean).not.toBe(-1);
  });
});

// --------------------------------------------------------------------------- //
describe('generador sintético', () => {
  it('respeta los bloques, las etiquetas y los límites del Python', () => {
    const ws = generateSynthetic([[0, 600, 'rest'], [600, 900, 'activation'], [900, 1800, 'rest']], 5);
    expect(ws.map((w) => w.t)).toEqual(Array.from({ length: 58 }, (_, i) => i * 30));
    expect(ws.filter((w) => w.label === 2).map((w) => w.t)).toEqual([600, 630, 660, 690, 720, 750, 780, 810, 840, 870]);
    for (const w of ws) {
      expect(Number.isInteger(w.features.eda_scr_count)).toBe(true);
      expect(w.features.eda_scr_count!).toBeGreaterThanOrEqual(0);
      expect(w.features.acc_move_std!).toBeGreaterThanOrEqual(0.05);
    }
  });

  it('es determinista por semilla', () => {
    const b = SCENARIOS.resolves.blocks!;
    expect(generateSynthetic(b, 3)).toEqual(generateSynthetic(b, 3));
    expect(generateSynthetic(b, 3)).not.toEqual(generateSynthetic(b, 4));
  });

  it('escenario "resolves": WATCH → INTERVENE → RECOVERY → resuelto, sin escalar', () => {
    const { kinds } = runEngine(scenarioRecord('resolves').windows);
    const i = kinds.indexOf('intervene');
    expect(i).toBeGreaterThan(-1);
    expect(kinds.slice(i, i + 3)).toEqual(['intervene', 'intervention_end', 'resolved']);
    expect(kinds).not.toContain('escalate');
  });

  it('escenario "escalates": la activación no cede y escala', () => {
    const { kinds } = runEngine(scenarioRecord('escalates').windows);
    const i = kinds.indexOf('intervene');
    expect(kinds.slice(i, i + 3)).toEqual(['intervene', 'intervention_end', 'escalate']);
  });

  it('escenario "exercise": el gating impide intervenir', () => {
    const { kinds, states } = runEngine(scenarioRecord('exercise').windows);
    expect(kinds).not.toContain('intervene');
    expect(states.filter((s) => s.gated).length).toBeGreaterThan(5);
  });
});

// --------------------------------------------------------------------------- //
describe('movimiento', () => {
  it('accFeatures = acc_features() del extractor (numpy)', () => {
    const mag = [9.81, 9.79, 9.85, 10.2, 9.6, 9.81, 9.9, 9.7, 10.05, 9.77, 9.83, 9.8];
    const f = accFeatures(mag)!;
    expect(f.acc_move_std).toBeCloseTo(0.14872373717735854, 12);
    expect(f.acc_move_mad).toBeCloseTo(0.09750000000000014, 12);
    expect(accFeatures([9.8, 9.8])).toBeNull(); // muy pocas muestras
  });

  it('MotionBuffer usa solo la ventana pedida', () => {
    const b = new MotionBuffer();
    for (let i = 0; i < 100; i++) b.push({ at: i * 20, gx: 0, gy: 0, gz: i < 50 ? 9.8 : 9.8 + (i % 2 ? 3 : -3), lin: null });
    expect(b.features(980, 0.98)!.acc_move_std).toBeCloseTo(0, 9); // primera mitad: quieto
    expect(b.features(1980, 0.98)!.acc_move_std).toBeGreaterThan(2.5);
  });

  it('umbrales en vivo de imu-demo', () => {
    expect([0.05, 0.5, 2, 5].map(classifyMotion)).toEqual(['still', 'light', 'walking', 'vigorous']);
  });
});

// --------------------------------------------------------------------------- //
class SilentProvider implements MotionProvider {
  readonly simulated = false;
  async start(): Promise<'granted' | 'denied'> { return 'granted'; }
  stop() {}
  onSample(_cb: (s: MotionSample) => void) { return () => {}; }
}
class DeniedProvider extends SilentProvider {
  override async start(): Promise<'granted' | 'denied'> { return 'denied'; }
}

describe('PhoneImuSource', () => {
  it('emite cada 30 s solo acc_move_std; la fisiología va en null', async () => {
    const sched = new FakeScheduler();
    const motion = new SimulatedMotionProvider(sched, 50, () => 0.5);
    const src = new PhoneImuSource(motion);
    const live: string[] = [];
    src.onLive((m) => live.push(m.level));
    const { windows } = await runSource(src, {
      sched, wallSec: 95,
      onWall: (s) => { motion.activity = s < 60 ? 'still' : 'shaking'; },
    });
    expect(windows.map((w) => w.t)).toEqual([30, 60, 90]);
    for (const w of windows) {
      for (const k of TRACKED) if (k !== 'acc_move_std') expect(w.features[k]).toBeNull();
    }
    expect(windows[1]!.features.acc_move_std!).toBeLessThan(0.1);
    expect(windows[2]!.features.acc_move_std!).toBeGreaterThan(1);
    expect(live).toContain('still');
    expect(live).toContain('vigorous');
    expect(src.meta.speedPolicy).toBe('realtime');
  });

  it('sin HRV el motor nunca completa el warmup', async () => {
    const sched = new FakeScheduler();
    const src = new PhoneImuSource(new SimulatedMotionProvider(sched));
    const { windows } = await runSource(src, { sched, wallSec: 600 });
    const { eng, states } = runEngine(windows);
    expect(eng.internals.ready).toBe(false);
    expect(states.every((s) => s.reason === 'calibrando línea base')).toBe(true);
  });

  it('avisa si no llegan muestras del sensor', async () => {
    const { statuses } = await runSource(new PhoneImuSource(new SilentProvider()), { wallSec: 5 });
    expect(statuses).toEqual(['running', 'no-sensor']);
  });

  it('avisa si se niega el permiso', async () => {
    const { statuses, windows } = await runSource(new PhoneImuSource(new DeniedProvider()), { wallSec: 40 });
    expect(statuses).toEqual(['needs-permission']);
    expect(windows).toEqual([]);
  });
});

// --------------------------------------------------------------------------- //
describe('HybridSource', () => {
  const record: KairosRecord = scenarioRecord('escalates');

  it('fisiología del registro, acc_move_std siempre del teléfono, etiqueta intacta', async () => {
    const sched = new FakeScheduler();
    const motion = new SimulatedMotionProvider(sched);
    const src = new HybridSource(record, motion);
    const { windows } = await runSource(src, { sched, speed: 30, wallSec: 30 });
    expect(src.motionWindowSec).toBe(2);
    expect(src.meta.speedPolicy).toBe('locked');
    windows.forEach((w, i) => {
      const r = record.windows[i]!;
      for (const k of TRACKED) if (k !== 'acc_move_std') expect(w.features[k]).toBe(r.features[k]);
      expect(w.label).toBe(r.label);
    });
    // desde la primera ventana (warmup incluido) el movimiento es del teléfono, no del registro
    const recAcc = record.windows.slice(1, windows.length).map((w) => w.features.acc_move_std);
    const gotAcc = windows.slice(1).map((w) => w.features.acc_move_std);
    for (let i = 0; i < gotAcc.length; i++) expect(gotAcc[i]).not.toBe(recAcc[i]);
    expect(Math.max(...gotAcc.map(Number))).toBeLessThan(0.2); // teléfono quieto
  });

  it('sacudir el teléfono bloquea la interpretación y evita la intervención', async () => {
    const sched = new FakeScheduler();
    const motion = new SimulatedMotionProvider(sched);
    const src = new HybridSource(record, motion);
    // a 30×: 1 s real = 30 s de registro. El bloque de activación va de 600 a 1500 s.
    const { windows } = await runSource(src, {
      sched, speed: 30, wallSec: 75,
      onWall: (s) => { motion.activity = s >= 19 && s < 52 ? 'shaking' : 'still'; },
    });
    const { states, kinds } = runEngine(windows);
    expect(kinds).toContain('baseline_ready');
    const during = states.filter((s) => s.t >= 600 && s.t < 1500);
    expect(during.filter((s) => s.gated).length).toBeGreaterThan(during.length * 0.8);
    expect(states.find((s) => s.t === 900)?.reason).toBe('actividad física detectada');
    expect(kinds).not.toContain('intervene');
  });

  it('con el teléfono quieto, el mismo registro sí interviene', async () => {
    const sched = new FakeScheduler();
    const src = new HybridSource(record, new SimulatedMotionProvider(sched));
    const { windows } = await runSource(src, { sched, speed: 30, wallSec: 75 });
    expect(runEngine(windows).kinds).toContain('intervene');
  });
});

// --------------------------------------------------------------------------- //
it('las cuatro fuentes cumplen la misma interfaz', () => {
  const sched = new FakeScheduler();
  const sources: SensorSource[] = [
    new SyntheticSource(),
    new ReplaySource(parseRecord(fixture('synthetic-seed2.json'))),
    new PhoneImuSource(new SimulatedMotionProvider(sched)),
    new HybridSource(canonicalRecord(), new SimulatedMotionProvider(sched)),
  ];
  expect(sources.map((s) => s.meta.kind)).toEqual(['synthetic', 'replay', 'phone-imu', 'hybrid']);
  for (const s of sources) {
    expect(typeof s.start).toBe('function');
    expect(typeof s.stop).toBe('function');
    expect(typeof s.onWindow).toBe('function');
    expect(typeof s.onStatus).toBe('function');
    expect(s.meta.stepSec).toBe(30);
  }
});
