/**
 * Registros de ventanas: el formato que exporta reference/python/export_fixtures.py
 * (`windows` + `meta`). Un archivo de fixture es un registro válido: `expected` se ignora.
 */
import { TRACKED, type FeatureValues, type FeatureWindow } from '@kairos/engine';
import type { SessionClock } from '../session/clock';
import { Emitter, type SensorSource, type SourceMeta, type SourceStatus } from './types';

export interface KairosRecord {
  name: string;
  synthetic: boolean;
  stepSec: number;
  windows: FeatureWindow[];
}

export class RecordFormatError extends Error {}

/** Valida y normaliza un JSON de registro. Lanza RecordFormatError con un mensaje claro. */
export function parseRecord(raw: unknown, fallbackName = 'registro'): KairosRecord {
  if (typeof raw !== 'object' || raw === null) throw new RecordFormatError('El archivo no es un objeto JSON.');
  const obj = raw as Record<string, unknown>;
  const meta = (obj['meta'] ?? {}) as Record<string, unknown>;
  const windowsRaw = obj['windows'];
  if (!Array.isArray(windowsRaw) || windowsRaw.length === 0) {
    throw new RecordFormatError('El archivo no trae una lista "windows" con ventanas.');
  }
  const stepSec = Number(meta['step_sec'] ?? obj['step_sec'] ?? 30);
  if (!(stepSec > 0)) throw new RecordFormatError('step_sec inválido.');

  let prevT = -Infinity;
  const windows: FeatureWindow[] = windowsRaw.map((w: unknown, i: number) => {
    const win = w as Record<string, unknown>;
    const t = win['t'];
    if (typeof t !== 'number' || !Number.isFinite(t) || t <= prevT) {
      throw new RecordFormatError(`Ventana ${i}: "t" debe ser un número creciente.`);
    }
    prevT = t;
    const f = win['features'] as Record<string, unknown> | undefined;
    if (!f || typeof f !== 'object') throw new RecordFormatError(`Ventana ${i}: faltan "features".`);
    const features = {} as FeatureValues;
    for (const k of TRACKED) {
      if (!(k in f)) throw new RecordFormatError(`Ventana ${i}: falta la feature "${k}".`);
      const v = f[k];
      if (v !== null && typeof v !== 'number') {
        throw new RecordFormatError(`Ventana ${i}: "${k}" debe ser número o null.`);
      }
      features[k] = v;
    }
    const out: FeatureWindow = { t, features };
    if (typeof win['label'] === 'number') out.label = win['label'];
    if (win['extra'] && typeof win['extra'] === 'object') {
      out.extra = win['extra'] as Record<string, number | null>;
    }
    return out;
  });

  return {
    name: String(meta['case'] ?? obj['name'] ?? fallbackName),
    synthetic: Boolean(meta['synthetic'] ?? obj['synthetic'] ?? false),
    stepSec,
    windows,
  };
}

/**
 * Reproduce un registro siguiendo el reloj de la sesión: emite cada ventana cuando el
 * tiempo de registro alcanza su `t` (relativo al inicio del registro).
 */
export class RecordSource implements SensorSource {
  readonly meta: SourceMeta;
  private readonly windowsOut = new Emitter<FeatureWindow>();
  private readonly statusOut = new Emitter<SourceStatus>();
  private next = 0;
  private t0: number;
  private unsubTick: (() => void) | null = null;

  constructor(
    readonly record: KairosRecord,
    kind: 'synthetic' | 'replay',
  ) {
    const ws = record.windows;
    this.t0 = ws[0]!.t;
    this.meta = {
      kind,
      name: record.name,
      stepSec: record.stepSec,
      labeled: ws.some((w) => w.label !== undefined),
      durationSec: ws[ws.length - 1]!.t - this.t0 + record.stepSec,
      speedPolicy: 'free',
      synthetic: record.synthetic,
      usesMotion: false,
    };
  }

  async start(clock: SessionClock): Promise<void> {
    this.unsubTick = clock.onTick((t) => this.pump(t));
    this.statusOut.emit({ kind: 'running' });
    this.pump(clock.now());
  }

  stop(): void {
    this.unsubTick?.();
    this.unsubTick = null;
  }

  onWindow(cb: (w: FeatureWindow) => void) {
    return this.windowsOut.on(cb);
  }
  onStatus(cb: (s: SourceStatus) => void) {
    return this.statusOut.on(cb);
  }

  /** Emite todas las ventanas cuyo t (relativo) ya llegó. */
  private pump(t: number): void {
    const ws = this.record.windows;
    while (this.next < ws.length && ws[this.next]!.t - this.t0 <= t) {
      const w = ws[this.next++]!;
      // copia: nadie aguas abajo puede mutar el registro
      this.windowsOut.emit({ ...w, t: w.t - this.t0, features: { ...w.features } });
    }
    if (this.next >= ws.length) {
      this.stop();
      this.statusOut.emit({ kind: 'ended' });
    }
  }
}

/** Fuente de replay: un registro cargado desde un archivo local (p. ej. WESAD). */
export class ReplaySource extends RecordSource {
  constructor(record: KairosRecord) {
    super(record, 'replay');
  }

  /** Lee un File elegido por el usuario. Nada sale del dispositivo. */
  static async fromFile(file: Blob & { name?: string }): Promise<ReplaySource> {
    let raw: unknown;
    try {
      raw = JSON.parse(await file.text());
    } catch {
      throw new RecordFormatError('El archivo no es JSON válido.');
    }
    return new ReplaySource(parseRecord(raw, file.name?.replace(/\.json$/i, '') ?? 'registro'));
  }
}
