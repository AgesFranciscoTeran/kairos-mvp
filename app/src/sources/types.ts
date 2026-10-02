/**
 * Contrato único de las fuentes de datos.
 *
 * Una fuente emite un `FeatureWindow` cada `stepSec` segundos de registro, con todas las
 * claves de TRACKED. Extraer features desde la señal cruda es trabajo de la fuente. El
 * motor nunca sabe de dónde viene la ventana ni ve la etiqueta: el SessionRunner la separa.
 */
import type { FeatureWindow } from '@kairos/engine';
import type { SessionClock } from '../session/clock';

export type SourceKind = 'synthetic' | 'replay' | 'phone-imu' | 'hybrid';

/**
 * - `free`: acepta 1×/10×/30× en cualquier momento (registros)
 * - `locked`: la velocidad se fija al iniciar (híbrido: la ventana de movimiento depende de ella)
 * - `realtime`: siempre 1× (teléfono en vivo)
 */
export type SpeedPolicy = 'free' | 'locked' | 'realtime';

export interface SourceMeta {
  kind: SourceKind;
  /** nombre visible del registro o de la fuente */
  name: string;
  stepSec: number;
  /** ¿las ventanas traen etiqueta de evaluación? */
  labeled: boolean;
  /** duración del registro en s; null = en vivo */
  durationSec: number | null;
  speedPolicy: SpeedPolicy;
  /** ¿los datos fisiológicos son sintéticos? */
  synthetic: boolean;
  /** ¿usa el movimiento real (o simulado) del teléfono? */
  usesMotion: boolean;
}

export type SourceStatus =
  | { kind: 'idle' }
  | { kind: 'needs-permission' }
  | { kind: 'running' }
  | { kind: 'no-sensor' }
  | { kind: 'ended' }
  | { kind: 'error'; message: string };

/** Lectura instantánea de movimiento, solo para la UI (nunca entra al motor). */
export interface LiveMotion {
  /** ms de reloj real */
  at: number;
  /** std de |aceleración lineal| en ~1.2 s, m/s² (misma medida que imu-demo) */
  motion: number;
  level: 'still' | 'light' | 'walking' | 'vigorous';
  simulated: boolean;
}

export type Unsubscribe = () => void;

export interface SensorSource {
  readonly meta: SourceMeta;
  /** Arranca la fuente. Debe llamarse tras un gesto del usuario (permiso de iOS). */
  start(clock: SessionClock): Promise<void>;
  stop(): void;
  onWindow(cb: (w: FeatureWindow) => void): Unsubscribe;
  onStatus(cb: (s: SourceStatus) => void): Unsubscribe;
  onLive?(cb: (m: LiveMotion) => void): Unsubscribe;
}

/** Pequeño emisor tipado para implementar las suscripciones. */
export class Emitter<T> {
  private listeners = new Set<(v: T) => void>();
  on(cb: (v: T) => void): Unsubscribe {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
  emit(v: T): void {
    for (const cb of this.listeners) cb(v);
  }
  clear(): void {
    this.listeners.clear();
  }
}
