/**
 * Fuentes que usan el movimiento del teléfono.
 *
 * - PhoneImuSource: solo movimiento en vivo. Las features fisiológicas van en null, así que
 *   el motor nunca completa el warmup (sin HRV la ventana no es interpretable). Sirve para
 *   ver el pipeline de movimiento, no el ciclo completo.
 * - HybridSource: fisiología de un registro + movimiento real del teléfono. `acc_move_std`
 *   viene SIEMPRE del teléfono, desde la primera ventana del warmup.
 */
import { emptyFeatures, type FeatureWindow } from '@kairos/engine';
import type { SessionClock } from '../session/clock';
import { LiveMotionMeter, MotionBuffer, type MotionProvider } from './motion';
import type { KairosRecord } from './record';
import { Emitter, type LiveMotion, type SensorSource, type SourceMeta, type SourceStatus } from './types';

/** Duración de la ventana de features del extractor (WIN_SEC). */
export const WIN_SEC = 60;
/** Sin muestras reales en este tiempo, avisamos que no hay sensor. */
export const NO_SENSOR_MS = 2000;

/** Conexión al proveedor de movimiento compartida por ambas fuentes. */
class MotionTap {
  readonly buffer = new MotionBuffer();
  private readonly meter = new LiveMotionMeter();
  private unsub: (() => void) | null = null;
  private gotSample = false;
  private lastLive = -Infinity;

  constructor(
    private readonly provider: MotionProvider,
    private readonly live: Emitter<LiveMotion>,
    private readonly status: Emitter<SourceStatus>,
  ) {}

  async start(clock: SessionClock): Promise<boolean> {
    this.unsub = this.provider.onSample((s) => {
      this.gotSample = true;
      this.buffer.push(s);
      const m = this.meter.push(s, this.provider.simulated);
      if (s.at - this.lastLive >= 100) {
        this.lastLive = s.at;
        this.live.emit(m);
      }
    });
    const perm = await this.provider.start();
    if (perm === 'denied') {
      this.status.emit({ kind: 'needs-permission' });
      return false;
    }
    const startedAt = clock.wallMs();
    const off = clock.onTick(() => {
      if (this.gotSample) return off();
      if (clock.wallMs() - startedAt >= NO_SENSOR_MS) {
        this.status.emit({ kind: 'no-sensor' });
        off();
      }
    });
    return true;
  }

  stop(): void {
    this.unsub?.();
    this.unsub = null;
    this.provider.stop();
  }
}

export class PhoneImuSource implements SensorSource {
  readonly meta: SourceMeta;
  private readonly windowsOut = new Emitter<FeatureWindow>();
  private readonly statusOut = new Emitter<SourceStatus>();
  private readonly liveOut = new Emitter<LiveMotion>();
  private readonly tap: MotionTap;
  private nextT: number;
  private unsubTick: (() => void) | null = null;

  constructor(provider: MotionProvider, readonly stepSec = 30) {
    this.tap = new MotionTap(provider, this.liveOut, this.statusOut);
    this.nextT = stepSec;
    this.meta = {
      kind: 'phone-imu',
      name: provider.simulated ? 'Movimiento simulado' : 'Movimiento del teléfono',
      stepSec,
      labeled: false,
      durationSec: null,
      speedPolicy: 'realtime',
      synthetic: false,
      usesMotion: true,
      realUse: !provider.simulated,
    };
  }

  async start(clock: SessionClock): Promise<void> {
    if (!(await this.tap.start(clock))) return;
    this.statusOut.emit({ kind: 'running' });
    this.unsubTick = clock.onTick((t) => {
      while (t >= this.nextT) {
        const features = emptyFeatures();
        const acc = this.tap.buffer.features(clock.wallMs(), Math.min(WIN_SEC, this.nextT));
        features.acc_move_std = acc?.acc_move_std ?? null;
        this.windowsOut.emit({ t: this.nextT, features, extra: { acc_move_mad: acc?.acc_move_mad ?? null } });
        this.nextT += this.stepSec;
      }
    });
  }

  stop(): void {
    this.unsubTick?.();
    this.tap.stop();
  }

  onWindow(cb: (w: FeatureWindow) => void) {
    return this.windowsOut.on(cb);
  }
  onStatus(cb: (s: SourceStatus) => void) {
    return this.statusOut.on(cb);
  }
  onLive(cb: (m: LiveMotion) => void) {
    return this.liveOut.on(cb);
  }
}

export class HybridSource implements SensorSource {
  readonly meta: SourceMeta;
  private readonly windowsOut = new Emitter<FeatureWindow>();
  private readonly statusOut = new Emitter<SourceStatus>();
  private readonly liveOut = new Emitter<LiveMotion>();
  private readonly tap: MotionTap;
  private next = 0;
  private readonly t0: number;
  private unsubTick: (() => void) | null = null;
  /** ventana de movimiento en s reales; se fija al iniciar según la velocidad */
  motionWindowSec = WIN_SEC;

  constructor(
    readonly record: KairosRecord,
    provider: MotionProvider,
  ) {
    this.tap = new MotionTap(provider, this.liveOut, this.statusOut);
    const ws = record.windows;
    this.t0 = ws[0]!.t;
    this.meta = {
      kind: 'hybrid',
      name: `${record.name} + ${provider.simulated ? 'movimiento simulado' : 'movimiento del teléfono'}`,
      stepSec: record.stepSec,
      labeled: ws.some((w) => w.label !== undefined),
      durationSec: ws[ws.length - 1]!.t - this.t0 + record.stepSec,
      speedPolicy: 'locked',
      synthetic: record.synthetic,
      usesMotion: true,
      realUse: false,
    };
  }

  async start(clock: SessionClock): Promise<void> {
    // a 30× una ventana de 60 s de registro dura 2 s reales: medimos el movimiento de esos 2 s
    this.motionWindowSec = WIN_SEC / clock.speed;
    if (!(await this.tap.start(clock))) return;
    this.statusOut.emit({ kind: 'running' });
    this.unsubTick = clock.onTick((t) => this.pump(t, clock));
  }

  stop(): void {
    this.unsubTick?.();
    this.unsubTick = null;
    this.tap.stop();
  }

  onWindow(cb: (w: FeatureWindow) => void) {
    return this.windowsOut.on(cb);
  }
  onStatus(cb: (s: SourceStatus) => void) {
    return this.statusOut.on(cb);
  }
  onLive(cb: (m: LiveMotion) => void) {
    return this.liveOut.on(cb);
  }

  private pump(t: number, clock: SessionClock): void {
    const ws = this.record.windows;
    while (this.next < ws.length && ws[this.next]!.t - this.t0 <= t) {
      const w = ws[this.next++]!;
      const acc = this.tap.buffer.features(clock.wallMs(), this.motionWindowSec);
      const out: FeatureWindow = {
        t: w.t - this.t0,
        // el movimiento del registro se descarta siempre: una sola unidad en la línea base
        features: { ...w.features, acc_move_std: acc?.acc_move_std ?? null },
        extra: { ...(w.extra ?? {}), acc_move_mad: acc?.acc_move_mad ?? null },
      };
      if (w.label !== undefined) out.label = w.label;
      this.windowsOut.emit(out);
    }
    if (this.next >= ws.length) {
      this.stop();
      this.statusOut.emit({ kind: 'ended' });
    }
  }
}
