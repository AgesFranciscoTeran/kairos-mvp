import { useState } from 'react';
import { DEFAULT_CONFIG, type EngineConfig } from '@kairos/engine';
import { deleteAll, exportAll, type BreathingPattern } from '../../store/db';
import { ContactForm, cleanContact } from '../components/ContactForm';
import { useApp, useSession } from '../hooks';
import { S } from '../strings';

const INT_FIELDS: (keyof EngineConfig)[] = ['warmup_windows', 'gate_release_windows', 'k_watch', 'k_act', 'k_exit'];
const FIELDS = Object.keys(DEFAULT_CONFIG) as (keyof EngineConfig)[];

/** Valida la configuración del motor. Devuelve los campos inválidos. */
export function invalidFields(cfg: Record<keyof EngineConfig, string>): (keyof EngineConfig)[] {
  return FIELDS.filter((k) => {
    const v = Number(cfg[k].replace(',', '.'));
    if (cfg[k].trim() === '' || !Number.isFinite(v)) return true;
    if (INT_FIELDS.includes(k)) return !Number.isInteger(v) || v < 1;
    if (k === 'ewma_alpha') return v <= 0 || v >= 1;
    if (k === 'cooldown_sec') return v < 0;
    return v <= 0;
  });
}

export function Settings() {
  const { profile, setProfile } = useApp();
  const snap = useSession();
  const [draft, setDraft] = useState(profile);
  const [cfgText, setCfgText] = useState(() => toText(profile.engineConfig));
  const [status, setStatus] = useState<string | null>(null);
  const bad = invalidFields(cfgText);

  const save = async () => {
    if (bad.length) {
      setStatus(S.settings.invalid);
      return;
    }
    const engineConfig = Object.fromEntries(FIELDS.map((k) => [k, Number(cfgText[k].replace(',', '.'))])) as unknown as EngineConfig;
    const next = cleanContact({ ...draft, engineConfig });
    await setProfile(next);
    setDraft(next);
    setStatus(S.settings.saved);
  };

  const doExport = async () => {
    const data = await exportAll();
    const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `kairos-datos-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const doDelete = async () => {
    if (!confirm(S.settings.deleteConfirm)) return;
    await deleteAll();
    location.hash = '#/bienvenida';
    location.reload();
  };

  return (
    <section aria-labelledby="set-title">
      <h1 id="set-title">{S.settings.title}</h1>

      <div className="card">
        <h2>{S.settings.contact}</h2>
        <ContactForm value={draft} onChange={setDraft} />
      </div>

      <div className="card">
        <h2>{S.settings.breathing}</h2>
        <fieldset>
          <legend>{S.settings.pattern}</legend>
          {(Object.keys(S.settings.patterns) as BreathingPattern[]).map((p) => (
            <label key={p} className="choice">
              <input type="radio" name="pattern" checked={draft.breathingPattern === p} onChange={() => setDraft({ ...draft, breathingPattern: p })} />
              <span>{S.settings.patterns[p]}</span>
            </label>
          ))}
        </fieldset>
        <label className="field">
          <span>{S.settings.countdown}</span>
          <input
            type="number"
            min={5}
            max={120}
            value={draft.countdownSec}
            onChange={(e) => setDraft({ ...draft, countdownSec: Math.max(5, Math.min(120, Number(e.target.value) || 30)) })}
          />
        </label>
      </div>

      <div className="card gold">
        <h2>{S.settings.engine}</h2>
        <p className="badge warn" role="note">
          {S.settings.engineWarning}
        </p>
        <p className="hint" style={{ marginTop: 10 }}>
          {S.settings.engineHelp}
        </p>
        <div className="grid2">
          {FIELDS.map((k) => (
            <label key={k} className="field">
              <span>{S.settings.fields[k]}</span>
              <input
                type="text"
                inputMode="decimal"
                value={cfgText[k]}
                aria-invalid={bad.includes(k)}
                onChange={(e) => setCfgText({ ...cfgText, [k]: e.target.value })}
              />
              <span className="hint mono">({DEFAULT_CONFIG[k]})</span>
            </label>
          ))}
        </div>
        <button type="button" className="btn" onClick={() => setCfgText(toText(DEFAULT_CONFIG))}>
          {S.settings.resetEngine}
        </button>
      </div>

      <div className="row" style={{ marginBottom: 16 }}>
        <button type="button" className="btn primary big" onClick={() => void save()}>
          {S.settings.save}
        </button>
        <span role="status">{status}</span>
      </div>

      <div className="card">
        <h2>{S.settings.data}</h2>
        <p>{S.settings.dataHelp}</p>
        <div className="row">
          <button type="button" className="btn" onClick={() => void doExport()}>
            {S.settings.export}
          </button>
          <button type="button" className="btn danger" onClick={() => void doDelete()} disabled={snap.status === 'running'}>
            {S.settings.deleteAll}
          </button>
        </div>
      </div>

      <div className="card">
        <h2>{S.settings.about}</h2>
        <p style={{ margin: 0 }}>{S.settings.aboutBody}</p>
      </div>
    </section>
  );
}

function toText(cfg: EngineConfig): Record<keyof EngineConfig, string> {
  return Object.fromEntries(FIELDS.map((k) => [k, String(cfg[k])])) as Record<keyof EngineConfig, string>;
}
