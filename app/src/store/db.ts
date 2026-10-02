/**
 * Persistencia local (IndexedDB vía Dexie). Nada de esto sale del teléfono salvo que el
 * usuario lo exporte a mano.
 */
import Dexie, { type Table } from 'dexie';
import { DEFAULT_CONFIG, type EngineConfig, type OperationalMetrics } from '@kairos/engine';
import type { TrustedContact } from '../session/escalation';
import type { ContextLabel, Episode } from '../session/episodes';
import type { SourceKind } from '../sources/types';
import { S } from '../ui/strings';

export type BreathingPattern = '4-6' | '4-4-6' | '5-5';

export interface Profile {
  onboarded: boolean;
  userName: string;
  contact: TrustedContact | null;
  messageTemplate: string;
  breathingPattern: BreathingPattern;
  countdownSec: number;
  engineConfig: EngineConfig;
}

export const DEFAULT_PROFILE: Profile = {
  onboarded: false,
  userName: '',
  contact: null,
  messageTemplate: S.defaultMessage,
  breathingPattern: '4-6',
  countdownSec: 30,
  engineConfig: { ...DEFAULT_CONFIG },
};

export interface SessionRecord {
  id: string;
  startedAt: string;
  endedAt: string | null;
  sourceKind: SourceKind;
  sourceName: string;
  demo: boolean;
  speed: number;
  config: EngineConfig;
  /** métricas operativas si el registro venía etiquetado */
  metrics: OperationalMetrics | null;
}

/** Ventana que el usuario marcó a mano. */
export interface Mark {
  id: string;
  sessionId: string;
  demo: boolean;
  t: number;
  at: string;
  engineState: string;
  label: ContextLabel;
}

class KairosDB extends Dexie {
  settings!: Table<{ key: string; value: unknown }, string>;
  sessions!: Table<SessionRecord, string>;
  episodes!: Table<Episode, string>;
  marks!: Table<Mark, string>;

  constructor(name = 'kairos') {
    super(name);
    this.version(1).stores({
      settings: 'key',
      sessions: 'id, startedAt',
      episodes: 'id, sessionId, startedAt, demo, needsLabel',
      marks: 'id, sessionId, at',
    });
  }
}

export let db = new KairosDB();

export async function loadProfile(): Promise<Profile> {
  const row = await db.settings.get('profile');
  const saved = (row?.value ?? {}) as Partial<Profile>;
  return {
    ...DEFAULT_PROFILE,
    ...saved,
    engineConfig: { ...DEFAULT_CONFIG, ...(saved.engineConfig ?? {}) },
  };
}

export async function saveProfile(p: Profile): Promise<void> {
  await db.settings.put({ key: 'profile', value: p });
}

export async function saveLabel(episodeId: string, label: ContextLabel): Promise<void> {
  await db.episodes.update(episodeId, { label, needsLabel: false });
}

export interface ExportFile {
  format: 'kairos-mvp-export';
  schema: 1;
  exportedAt: string;
  note: string;
  profile: Profile;
  sessions: SessionRecord[];
  episodes: Episode[];
  marks: Mark[];
}

export async function exportAll(): Promise<ExportFile> {
  return {
    format: 'kairos-mvp-export',
    schema: 1,
    exportedAt: new Date().toISOString(),
    note: 'Datos locales de Kairos MVP. Los episodios con demo=true no son de uso real.',
    profile: await loadProfile(),
    sessions: await db.sessions.toArray(),
    episodes: await db.episodes.toArray(),
    marks: await db.marks.toArray(),
  };
}

/** Borra la base completa y la vuelve a crear vacía. */
export async function deleteAll(): Promise<void> {
  const name = db.name;
  db.close();
  await Dexie.delete(name);
  db = new KairosDB(name);
  try {
    localStorage.clear();
  } catch {
    // sin almacenamiento local: nada que borrar
  }
}

export function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
