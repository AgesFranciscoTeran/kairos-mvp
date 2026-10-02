import { useEffect, useId, useRef, useState } from 'react';
import type { Activity, ContextLabel, Felt } from '../../session/episodes';
import { S } from '../strings';

interface Props {
  manual?: boolean;
  /** subtítulo opcional (qué pasó en el episodio) */
  context?: string;
  onSave: (label: ContextLabel) => void;
  onLater: () => void;
}

const ACTIVITIES = Object.keys(S.label.activities) as Activity[];
const FELT = Object.keys(S.label.feltOptions) as Felt[];

/**
 * Etiquetado de contexto: la semilla del dataset con contexto verificado.
 * Dos preguntas, siempre opcional ("Ahora no").
 */
export function LabelDialog({ manual, context, onSave, onLater }: Props) {
  const titleId = useId();
  const [activity, setActivity] = useState<Activity | null>(null);
  const [other, setOther] = useState('');
  const [felt, setFelt] = useState<Felt | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<Element | null>(null);

  useEffect(() => {
    returnFocus.current = document.activeElement;
    dialogRef.current?.querySelector<HTMLElement>('button')?.focus();
    return () => (returnFocus.current as HTMLElement | null)?.focus?.();
  }, []);

  const canSave = activity !== null && felt !== null && (activity !== 'other' || other.trim().length > 0);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onLater();
    // trampa de foco simple dentro del diálogo
    if (e.key === 'Tab' && dialogRef.current) {
      const els = dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), input, textarea');
      const first = els[0];
      const last = els[els.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    }
  };

  return (
    <div className="dialog-backdrop">
      <div ref={dialogRef} className="dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={onKey}>
        <h2 id={titleId}>{manual ? S.label.titleManual : S.label.title}</h2>
        {context && <p>{context}</p>}
        <p className="hint">{S.label.intro}</p>

        <fieldset>
          <legend>{S.label.whatDoing}</legend>
          <div className="chips" role="group">
            {ACTIVITIES.map((a) => (
              <button key={a} type="button" className="btn" aria-pressed={activity === a} onClick={() => setActivity(a)}>
                {S.label.activities[a]}
              </button>
            ))}
          </div>
          {activity === 'other' && (
            <label className="field" style={{ marginTop: 10 }}>
              <span>{S.label.otherPlaceholder}</span>
              <input type="text" value={other} onChange={(e) => setOther(e.target.value)} maxLength={120} />
            </label>
          )}
        </fieldset>

        <fieldset>
          <legend>{S.label.felt}</legend>
          <div className="chips" role="group">
            {FELT.map((f) => (
              <button key={f} type="button" className="btn" aria-pressed={felt === f} onClick={() => setFelt(f)}>
                {S.label.feltOptions[f]}
              </button>
            ))}
          </div>
        </fieldset>

        <div className="row between">
          <button type="button" className="btn ghost" onClick={onLater}>
            {S.label.later}
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={!canSave}
            onClick={() => {
              const label: ContextLabel = { activity: activity!, felt: felt!, labeledAt: new Date().toISOString() };
              if (activity === 'other') label.activityOther = other.trim();
              onSave(label);
            }}
          >
            {S.label.save}
          </button>
        </div>
      </div>
    </div>
  );
}
