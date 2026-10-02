/**
 * Movimiento del teléfono.
 *
 * Dos medidas, con propósitos distintos:
 *
 * 1. Feature para el motor (`acc_move_std`, `acc_move_mad`): exactamente la definición de
 *    acc_features() del extractor — std (ddof=0) y desviación media respecto a la mediana
 *    de la MAGNITUD de la aceleración con gravedad, sobre la ventana. Igual que el E4 de
 *    WESAD, que mide aceleración con gravedad.
 * 2. Medidor en vivo para la UI: std de |aceleración lineal| en ~1.2 s, con los umbrales
 *    heurísticos de imu-demo. Nunca entra al motor.
 *
 * Las unidades (m/s²) no son las del E4 (1/64 g). No importa: en modo híbrido
 * `acc_move_std` viene SIEMPRE del teléfono desde el warmup, así la línea base de
 * movimiento queda en una sola unidad.
 */
import { Emitter, type LiveMotion, type Unsubscribe } from './types';

export interface MotionSample {
  /** ms de reloj real */
  at: number;
  /** aceleración con gravedad (m/s²) */
  gx: number;
  gy: number;
  gz: number;
  /** aceleración lineal si el navegador la da */
  lin: [number, number, number] | null;
}

export interface MotionProvider {
  readonly simulated: boolean;
  /** Pide permiso (iOS) y empieza a escuchar. Llamar tras un gesto del usuario. */
  start(): Promise<'granted' | 'denied'>;
  stop(): void;
  onSample(cb: (s: MotionSample) => void): Unsubscribe;
}

// --------------------------------------------------------------------------- //
// 1. Features de ventana (definición del extractor)
// --------------------------------------------------------------------------- //

/** Muestras mínimas para que una ventana de movimiento sea válida. */
export const MIN_MOTION_SAMPLES = 10;

export function accFeatures(magnitudes: readonly number[]): { acc_move_std: number; acc_move_mad: number } | null {
  const n = magnitudes.length;
  if (n < MIN_MOTION_SAMPLES) return null;
  let mean = 0;
  for (const m of magnitudes) mean += m;
  mean /= n;
  let v = 0;
  for (const m of magnitudes) v += (m - mean) ** 2;
  const sorted = [...magnitudes].sort((a, b) => a - b);
  const mid = Math.floor(n / 2);
  const med = n % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  let mad = 0;
  for (const m of magnitudes) mad += Math.abs(m - med);
  return { acc_move_std: Math.sqrt(v / n), acc_move_mad: mad / n };
}

/** Búfer de magnitudes con marca de tiempo; entrega la ventana de los últimos `sec` s reales. */
export class MotionBuffer {
  private at: number[] = [];
  private mag: number[] = [];
  constructor(private readonly keepSec = 120) {}

  push(s: MotionSample): void {
    this.at.push(s.at);
    this.mag.push(Math.hypot(s.gx, s.gy, s.gz));
    const cutoff = s.at - this.keepSec * 1000;
    let drop = 0;
    while (drop < this.at.length && this.at[drop]! < cutoff) drop++;
    if (drop) {
      this.at.splice(0, drop);
      this.mag.splice(0, drop);
    }
  }

  /** Features sobre (nowMs - sec, nowMs]. */
  features(nowMs: number, sec: number) {
    const from = nowMs - sec * 1000;
    const sel: number[] = [];
    for (let i = 0; i < this.at.length; i++) if (this.at[i]! > from && this.at[i]! <= nowMs) sel.push(this.mag[i]!);
    return accFeatures(sel);
  }

  clear(): void {
    this.at = [];
    this.mag = [];
  }
}

// --------------------------------------------------------------------------- //
// 2. Medidor en vivo (lógica de imu-demo)
// --------------------------------------------------------------------------- //

/** Umbrales heurísticos de imu-demo (std de |aceleración lineal|, m/s²). */
export const LIVE_THRESHOLDS = { still: 0.15, light: 0.8, walk: 3.0 } as const;

export function classifyMotion(mov: number): LiveMotion['level'] {
  if (mov < LIVE_THRESHOLDS.still) return 'still';
  if (mov < LIVE_THRESHOLDS.light) return 'light';
  if (mov < LIVE_THRESHOLDS.walk) return 'walking';
  return 'vigorous';
}

export class LiveMotionMeter {
  private buf: number[] = [];
  private gravity: [number, number, number] = [0, 0, 0];
  constructor(private readonly win = 60) {} // ~1.2 s a 50 Hz

  /** Igual que onMotion() de imu-demo: lineal si existe; si no, filtro de gravedad. */
  push(s: MotionSample, simulated: boolean): LiveMotion {
    let ax: number, ay: number, az: number;
    if (s.lin && (s.lin[0] || s.lin[1] || s.lin[2])) {
      [ax, ay, az] = s.lin;
    } else {
      const a = 0.85;
      const g = this.gravity;
      g[0] = a * g[0] + (1 - a) * s.gx;
      g[1] = a * g[1] + (1 - a) * s.gy;
      g[2] = a * g[2] + (1 - a) * s.gz;
      ax = s.gx - g[0];
      ay = s.gy - g[1];
      az = s.gz - g[2];
    }
    this.buf.push(Math.hypot(ax, ay, az));
    if (this.buf.length > this.win) this.buf.shift();
    const mean = this.buf.reduce((p, x) => p + x, 0) / this.buf.length;
    const mov = Math.sqrt(this.buf.reduce((p, x) => p + (x - mean) ** 2, 0) / this.buf.length);
    return { at: s.at, motion: mov, level: classifyMotion(mov), simulated };
  }
}

// --------------------------------------------------------------------------- //
// Proveedores
// --------------------------------------------------------------------------- //

type DMEvent = {
  acceleration: { x: number | null; y: number | null; z: number | null } | null;
  accelerationIncludingGravity: { x: number | null; y: number | null; z: number | null } | null;
};

/** DeviceMotion real. Requiere HTTPS; en iOS, permiso explícito tras un gesto. */
export class DeviceMotionProvider implements MotionProvider {
  readonly simulated = false;
  private readonly out = new Emitter<MotionSample>();
  private handler = (e: Event) => this.onMotion(e as unknown as DMEvent);

  async start(): Promise<'granted' | 'denied'> {
    const DME = (globalThis as { DeviceMotionEvent?: { requestPermission?: () => Promise<string> } })
      .DeviceMotionEvent;
    if (DME && typeof DME.requestPermission === 'function') {
      try {
        if ((await DME.requestPermission()) !== 'granted') return 'denied';
      } catch {
        // algunos navegadores lanzan si no hubo gesto: seguimos e intentamos escuchar
      }
    }
    globalThis.addEventListener('devicemotion', this.handler);
    return 'granted';
  }

  stop(): void {
    globalThis.removeEventListener('devicemotion', this.handler);
  }

  onSample(cb: (s: MotionSample) => void) {
    return this.out.on(cb);
  }

  private onMotion(e: DMEvent): void {
    // Chrome de escritorio emite eventos con valores nulos: solo cuentan los que traen datos
    const g = e.accelerationIncludingGravity;
    const l = e.acceleration;
    const gOK = g && g.x !== null && g.y !== null && g.z !== null;
    const lOK = l && l.x !== null && l.y !== null && l.z !== null;
    if (!gOK && !lOK) return;
    const lin: [number, number, number] | null = lOK ? [l!.x!, l!.y!, l!.z!] : null;
    // sin gravedad (raro): usamos la lineal más 1 g en z para que la magnitud sea comparable
    const [gx, gy, gz] = gOK ? [g!.x!, g!.y!, g!.z!] : [lin![0], lin![1], lin![2] + 9.81];
    this.out.emit({ at: performance.now(), gx, gy, gz, lin });
  }
}

export type SimulatedActivity = 'still' | 'walking' | 'shaking';

/**
 * Movimiento simulado para demostrar el gating en escritorio. La UI lo marca siempre como
 * simulado. La actividad la elige quien presenta (no es aleatoria como en imu-demo).
 */
export class SimulatedMotionProvider implements MotionProvider {
  readonly simulated = true;
  private readonly out = new Emitter<MotionSample>();
  private stopTimer: (() => void) | null = null;
  private phase = 0;
  activity: SimulatedActivity = 'still';

  constructor(
    private readonly clock: { nowMs(): number; every(ms: number, fn: () => void): () => void } = {
      nowMs: () => performance.now(),
      every: (ms, fn) => {
        const h = setInterval(fn, ms);
        return () => clearInterval(h);
      },
    },
    private readonly hz = 50,
    private readonly random: () => number = Math.random,
  ) {}

  async start(): Promise<'granted'> {
    this.stopTimer ??= this.clock.every(1000 / this.hz, () => this.emitSample());
    return 'granted';
  }

  stop(): void {
    this.stopTimer?.();
    this.stopTimer = null;
  }

  onSample(cb: (s: MotionSample) => void) {
    return this.out.on(cb);
  }

  private emitSample(): void {
    this.phase += 1 / this.hz;
    // amplitudes elegidas para caer en las clases de imu-demo: quieto, caminando, vigoroso
    const amp = { still: 0.04, walking: 4, shaking: 14 }[this.activity];
    const freq = { still: 0, walking: 1.9, shaking: 5 }[this.activity];
    const jitter = () => (this.random() - 0.5) * 2;
    const wave = amp * Math.sin(2 * Math.PI * freq * this.phase);
    const lx = jitter() * amp * 0.3;
    const ly = jitter() * amp * 0.3;
    const lz = wave + jitter() * amp * 0.2;
    this.out.emit({ at: this.clock.nowMs(), gx: lx, gy: ly, gz: 9.81 + lz, lin: [lx, ly, lz] });
  }
}
