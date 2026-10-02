import { useEffect, useState } from 'react';
import type { OperationalMetrics } from '@kairos/engine';
import type { Episode } from '../../session/episodes';
import { db, type SessionRecord } from '../../store/db';
import { fmtDate, fmtDuration, fmtNumber, fmtPercent } from '../format';
import { useSession } from '../hooks';
import { S } from '../strings';

function median(v: number[]): number | null {
  if (!v.length) return null;
  const s = [...v].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** Resumen de uso a partir de los episodios guardados. */
export function summarize(eps: Episode[]) {
  const closed = eps.filter((e) => e.outcome && e.outcome !== 'watch_cancelled');
  const intervened = closed.filter((e) => e.intervened);
  const ttbs = closed.map((e) => e.ttbSec).filter((v): v is number => v !== null);
  return {
    episodes: closed.length,
    interventions: intervened.length,
    escalations: closed.filter((e) => e.escalated).length,
    reportedFalse: intervened.filter((e) => e.label?.felt === 'no').length,
    ttbMedian: median(ttbs),
    withTtb: closed.filter((e) => e.ttbSec !== null),
  };
}

export function Metrics() {
  const snap = useSession();
  const [last, setLast] = useState<SessionRecord | null>(null);
  const [eps, setEps] = useState<Episode[]>([]);

  useEffect(() => {
    void (async () => {
      const sessions = await db.sessions.orderBy('startedAt').reverse().toArray();
      setLast(sessions.find((s) => s.metrics) ?? null);
      setEps(await db.episodes.toArray());
    })();
  }, [snap.status, snap.lastClosed]);

  const real = summarize(eps.filter((e) => !e.demo));
  const demo = summarize(eps.filter((e) => e.demo));

  return (
    <section aria-labelledby="met-title">
      <h1 id="met-title">{S.metrics.title}</h1>
      <p className="banner">{S.metrics.honesty}</p>

      <div className="card">
        <h2>{S.metrics.replayTitle}</h2>
        {last?.metrics ? (
          <>
            <p className="muted">
              {last.sourceName} · {fmtDate(last.startedAt)}
            </p>
            <ReplayTable m={last.metrics} />
            <p className="hint" style={{ marginTop: 10, marginBottom: 0 }}>
              {S.metrics.replayLabelNote}
            </p>
          </>
        ) : (
          <p style={{ margin: 0 }}>{S.metrics.replayNone}</p>
        )}
      </div>

      <UsageCard title={S.metrics.realTitle} s={real} empty={S.metrics.realNone} />
      <UsageCard title={S.metrics.demoTitle} s={demo} empty={S.history.empty} />
    </section>
  );
}

function ReplayTable({ m }: { m: OperationalMetrics }) {
  const rows: [string, string][] = [
    [S.metrics.m.windows, String(m.windows)],
    [S.metrics.m.hours_total, fmtNumber(m.hours_total)],
    [S.metrics.m.episodes_real, String(m.episodes_real)],
    [S.metrics.m.coverage, fmtPercent(m.coverage)],
    [S.metrics.m.interventions, String(m.interventions)],
    [S.metrics.m.false_alarms, String(m.false_alarms)],
    [S.metrics.m.false_alarms_per_rest_hour, fmtNumber(m.false_alarms_per_rest_hour)],
    [S.metrics.m.detection_latency_median_s, fmtDuration(m.detection_latency_median_s)],
    [S.metrics.m.gated_fraction, fmtPercent(m.gated_fraction)],
    [S.metrics.m.escalations, String(m.escalations)],
    [S.metrics.m.ttb_median_s, fmtDuration(m.ttb_median_s)],
  ];
  return (
    <table className="metrics">
      <tbody>
        {rows.map(([k, v]) => (
          <tr key={k}>
            <th scope="row">{k}</th>
            <td>{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function UsageCard({ title, s, empty }: { title: string; s: ReturnType<typeof summarize>; empty: string }) {
  const maxTtb = Math.max(1, ...s.withTtb.map((e) => e.ttbSec!));
  return (
    <div className="card">
      <h2>{title}</h2>
      {s.episodes === 0 ? (
        <p style={{ margin: 0 }}>{empty}</p>
      ) : (
        <>
          <table className="metrics">
            <tbody>
              <tr>
                <th scope="row">{S.metrics.r.episodes}</th>
                <td>{s.episodes}</td>
              </tr>
              <tr>
                <th scope="row">{S.metrics.r.interventions}</th>
                <td>{s.interventions}</td>
              </tr>
              <tr>
                <th scope="row">{S.metrics.r.escalations}</th>
                <td>{s.escalations}</td>
              </tr>
              <tr>
                <th scope="row">
                  {S.metrics.r.reportedFalse}
                  <div className="hint">{S.metrics.r.reportedFalseHelp}</div>
                </th>
                <td>{s.reportedFalse}</td>
              </tr>
              <tr>
                <th scope="row">{S.metrics.r.ttbMedian}</th>
                <td>{fmtDuration(s.ttbMedian)}</td>
              </tr>
            </tbody>
          </table>
          {s.withTtb.length > 0 && (
            <>
              <h3 style={{ marginTop: 16 }}>{S.metrics.ttbPerEpisode}</h3>
              <ul className="plain">
                {s.withTtb.map((e) => (
                  <li key={e.id} style={{ marginBottom: 8 }}>
                    <div className="row between">
                      <span className="muted">{fmtDate(e.startedAt)}</span>
                      <span className="mono">{fmtDuration(e.ttbSec)}</span>
                    </div>
                    <div className="bar" style={{ width: `${(e.ttbSec! / maxTtb) * 100}%` }} />
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </div>
  );
}
