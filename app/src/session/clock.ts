/**
 * Reloj de registro de la sesión.
 *
 * El motor solo conoce el tiempo de registro (el `t` de cada ventana). La velocidad de
 * reproducción solo cambia cuán rápido avanza ese tiempo respecto del reloj real. Las
 * fases humanas (respiración, cuenta regresiva) corren en reloj real y las coordina la
 * sesión: baja a 1× durante INTERVENE y pausa durante el escalamiento.
 */
import type { Unsubscribe } from '../sources/types';

export type Speed = 1 | 10 | 30;
export const SPEEDS: readonly Speed[] = [1, 10, 30];

/** Fuente de tiempo real y temporizador, inyectable para tests. */
export interface Scheduler {
  nowMs(): number;
  every(ms: number, fn: () => void): () => void;
}

export const realScheduler: Scheduler = {
  nowMs: () => performance.now(),
  every: (ms, fn) => {
    const h = setInterval(fn, ms);
    return () => clearInterval(h);
  },
};

export interface SessionClock {
  /** segundos de registro desde el inicio de la sesión */
  now(): number;
  /** ms de reloj real (para fuentes que miden señal real) */
  wallMs(): number;
  readonly speed: Speed;
  readonly paused: boolean;
  /** se llama en cada tic (~10 Hz de reloj real) con el tiempo de registro */
  onTick(cb: (t: number) => void): Unsubscribe;
}

export class PlaybackClock implements SessionClock {
  private recordT = 0;
  private lastWall: number | null = null;
  private stopTimer: (() => void) | null = null;
  private listeners = new Set<(t: number) => void>();
  private _speed: Speed;
  private _paused = true;

  constructor(
    speed: Speed = 1,
    private readonly scheduler: Scheduler = realScheduler,
    private readonly tickMs = 100,
  ) {
    this._speed = speed;
  }

  get speed(): Speed {
    return this._speed;
  }
  get paused(): boolean {
    return this._paused;
  }

  now(): number {
    this.advance();
    return this.recordT;
  }

  wallMs(): number {
    return this.scheduler.nowMs();
  }

  /** Empieza a correr (o reanuda). */
  start(): void {
    if (!this.stopTimer) this.stopTimer = this.scheduler.every(this.tickMs, () => this.tick());
    this.resume();
  }

  /** Detiene el temporizador por completo. */
  stop(): void {
    this.pause();
    this.stopTimer?.();
    this.stopTimer = null;
  }

  pause(): void {
    this.advance();
    this._paused = true;
    this.lastWall = null;
  }

  resume(): void {
    if (!this._paused) return;
    this._paused = false;
    this.lastWall = this.scheduler.nowMs();
  }

  setSpeed(s: Speed): void {
    this.advance(); // lo transcurrido hasta aquí se cuenta a la velocidad anterior
    this._speed = s;
  }

  /**
   * Retrocede el tiempo de registro a `t` (nunca adelanta). Solo para alinear la respiración
   * con la ventana que disparó la intervención: el tiempo que corrió a 30× mientras el motor
   * respondía no se le resta a los 90 s reales. Quien llama garantiza que no se emitió
   * ninguna ventana posterior a `t`.
   */
  rewindTo(t: number): void {
    this.advance();
    if (t < this.recordT) this.recordT = t;
  }

  onTick(cb: (t: number) => void): Unsubscribe {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /** Fuerza un tic (útil en tests y tras reanudar). */
  tick(): void {
    const t = this.now();
    for (const cb of this.listeners) cb(t);
  }

  private advance(): void {
    if (this._paused || this.lastWall === null) return;
    const w = this.scheduler.nowMs();
    this.recordT += ((w - this.lastWall) / 1000) * this._speed;
    this.lastWall = w;
  }
}

/** Planificador manual para tests: el tiempo solo avanza con `advance`. */
export class FakeScheduler implements Scheduler {
  private t = 0;
  private timers: { every: number; next: number; fn: () => void }[] = [];
  nowMs(): number {
    return this.t;
  }
  every(ms: number, fn: () => void): () => void {
    const timer = { every: ms, next: this.t + ms, fn };
    this.timers.push(timer);
    return () => {
      this.timers = this.timers.filter((x) => x !== timer);
    };
  }
  /** Avanza `ms` de reloj real, disparando los temporizadores en orden. */
  advance(ms: number): void {
    const end = this.t + ms;
    for (;;) {
      const due = this.timers.filter((x) => x.next <= end).sort((a, b) => a.next - b.next)[0];
      if (!due) break;
      this.t = due.next;
      due.next += due.every;
      due.fn();
    }
    this.t = end;
  }
}
