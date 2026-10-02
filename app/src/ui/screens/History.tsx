import { useEffect, useState } from 'react';
import type { Episode } from '../../session/episodes';
import { db, type Mark } from '../../store/db';
import { LabelDialog } from '../components/LabelDialog';
import { fmtDate, fmtDuration } from '../format';
import { useApp, useSession } from '../hooks';
import { S } from '../strings';

type Filter = 'all' | 'real' | 'demo';

export function History() {
  const snap = useSession();
  const { controller } = useApp();
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [marks, setMarks] = useState<Mark[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [editing, setEditing] = useState<Episode | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    void (async () => {
      const eps = await db.episodes.orderBy('startedAt').reverse().toArray();
      // los episodios explicados por movimiento no cierran un ciclo: no se listan
      setEpisodes(eps.filter((e) => e.outcome && e.outcome !== 'watch_cancelled'));
      setMarks(await db.marks.orderBy('at').reverse().toArray());
    })();
  }, [snap.lastClosed, snap.pendingLabels, version]);

  const shown = episodes.filter((e) => filter === 'all' || (filter === 'real' ? !e.demo : e.demo));

  return (
    <section aria-labelledby="hist-title">
      <h1 id="hist-title">{S.history.title}</h1>
      <div className="seg" role="group" aria-label="Filtro" style={{ marginBottom: 14 }}>
        {(['all', 'real', 'demo'] as Filter[]).map((f) => (
          <button key={f} type="button" className="btn" aria-pressed={filter === f} onClick={() => setFilter(f)}>
            {f === 'all' ? S.history.filterAll : f === 'real' ? S.history.filterReal : S.history.filterDemo}
          </button>
        ))}
      </div>

      <div className="card">
        {shown.length === 0 && <p style={{ margin: 0 }}>{S.history.empty}</p>}
        <ul className="plain">
          {shown.map((e) => (
            <li key={e.id} className="episode">
              <div className="row between">
                <strong>{S.history.outcome[e.outcome!]}</strong>
                <span className="badge">{e.demo ? S.history.demo : S.history.real}</span>
              </div>
              <div className="muted">{fmtDate(e.startedAt)}</div>
              <div className="row" style={{ gap: 14 }}>
                {e.ttbSec !== null && (
                  <span>
                    {S.history.ttb}: <span className="mono">{fmtDuration(e.ttbSec)}</span>
                  </span>
                )}
                {e.intervened && (
                  <span>
                    {S.history.intervened}
                    {e.breathingEndedEarly ? ` (${S.history.endedEarly})` : ''}
                  </span>
                )}
                {e.escalation && <span>{S.history.escalation[e.escalation]}</span>}
              </div>
              <div className="row between" style={{ marginTop: 4 }}>
                <span className="muted">
                  {e.label
                    ? `${S.label.activities[e.label.activity]}${e.label.activityOther ? ` (${e.label.activityOther})` : ''} · ${S.label.felt} ${S.label.feltOptions[e.label.felt]}`
                    : S.history.noLabel}
                </span>
                <button type="button" className="btn ghost" onClick={() => setEditing(e)}>
                  {S.history.edit}
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>

      {marks.length > 0 && (
        <div className="card">
          <h2>{S.history.marks}</h2>
          <ul className="plain">
            {marks
              .filter((m) => filter === 'all' || (filter === 'real' ? !m.demo : m.demo))
              .map((m) => (
                <li key={m.id} className="episode">
                  <div className="muted">{fmtDate(m.at)}</div>
                  <div>
                    {S.label.activities[m.label.activity]}
                    {m.label.activityOther ? ` (${m.label.activityOther})` : ''} · {S.label.felt} {S.label.feltOptions[m.label.felt]}
                  </div>
                </li>
              ))}
          </ul>
        </div>
      )}

      {editing && (
        <LabelDialog
          context={`${S.history.outcome[editing.outcome!]} · ${fmtDate(editing.startedAt)}`}
          onLater={() => setEditing(null)}
          onSave={(label) => {
            void controller.labelEpisode(editing.id, label).then(() => setVersion((v) => v + 1));
            setEditing(null);
          }}
        />
      )}
    </section>
  );
}
