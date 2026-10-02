import { S } from './strings';

/** 270 -> "4 min 30 s"; 45 -> "45 s" */
export function fmtDuration(sec: number | null | undefined): string {
  if (sec === null || sec === undefined || !Number.isFinite(sec)) return '—';
  const s = Math.max(0, Math.round(sec));
  if (s < 60) return S.seconds(s);
  return S.minutes(Math.floor(s / 60), s % 60);
}

/** Reloj de registro: 2160 -> "36:00"; 5400 -> "1:30:00" */
export function fmtClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const mm = h ? String(m).padStart(2, '0') : String(m);
  return `${h ? `${h}:` : ''}${mm}:${String(r).padStart(2, '0')}`;
}

export function fmtNumber(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return v.toLocaleString('es-EC', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('es-EC', { dateStyle: 'medium', timeStyle: 'short' });
}

export function fmtPercent(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  return `${Math.round(v * 100)} %`;
}
