import { useState } from 'react';
import type { Speed } from '../../session/clock';
import { SPEEDS } from '../../session/clock';
import type { Episode } from '../../session/episodes';
import { DeviceMotionProvider, LIVE_THRESHOLDS, SimulatedMotionProvider, type MotionProvider, type SimulatedActivity } from '../../sources/motion';
import { HybridSource, PhoneImuSource } from '../../sources/phone';
import { RecordFormatError, ReplaySource, parseRecord, type KairosRecord } from '../../sources/record';
import { SyntheticSource, scenarioRecord, type SyntheticScenarioId } from '../../sources/synthetic';
import type { SensorSource, SourceKind } from '../../sources/types';
import { Breathing } from '../components/Breathing';
import { LabelDialog } from '../components/LabelDialog';
import { Sparkline } from '../components/Sparkline';
import { fmtClock, fmtDuration, fmtNumber } from '../format';
import { HREF, useAnimationClock, useApp, useRecordNow, useSession } from '../hooks';
import { S } from '../strings';

const SCENARIO_IDS = Object.keys(S.session.scenarios) as SyntheticScenarioId[];
const SOURCE_KINDS: SourceKind[] = ['synthetic', 'replay', 'phone-imu', 'hybrid'];

const hasMotionSensors = () =>
  typeof window !== 'undefined' && 'DeviceMotionEvent' in window && navigator.maxTouchPoints > 0;

export function SessionScreen() {
  const snap = useSession();
  const live = snap.status === 'running' || snap.status === 'paused';
  return (
    <>
      {live ? <LiveSession /> : <SetupPanel />}
      <LabelQueue />
    </>
  );
}

// ------------------------------------------------------------------ //
// Configuración de la sesión
// ------------------------------------------------------------------ //
function SetupPanel() {
  const { controller, profile, setSimMotion } = useApp();
  const snap = useSession();
  const [kind, setKind] = useState<SourceKind>('synthetic');
  const [scenario, setScenario] = useState<SyntheticScenarioId>('resolves');
  const [physio, setPhysio] = useState<'scenario' | 'file'>('scenario');
  const [file, setFile] = useState<KairosRecord | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [motion, setMotion] = useState<'real' | 'simulated'>(hasMotionSensors() ? 'real' : 'simulated');
  const [speed, setSpeed] = useState<Speed>(30);
  const [starting, setStarting] = useState(false);

  const needsFile = kind === 'replay' || (kind === 'hybrid' && physio === 'file');
  const usesScenario = kind === 'synthetic' || (kind === 'hybrid' && physio === 'scenario');
  const canStart = !starting && (!needsFile || file !== null);

  const onFile = async (f: File | undefined) => {
    setFileError(null);
    setFile(null);
    if (!f) return;
    try {
      setFile(parseRecord(JSON.parse(await f.text()), f.name.replace(/\.json$/i, '')));
    } catch (e) {
      setFileError(e instanceof RecordFormatError ? e.message : 'No se pudo leer el archivo.');
    }
  };

  const start = async () => {
    setStarting(true);
    let provider: MotionProvider | null = null;
    if (kind === 'phone-imu' || kind === 'hybrid') {
      provider = motion === 'real' ? new DeviceMotionProvider() : new SimulatedMotionProvider();
      setSimMotion(provider instanceof SimulatedMotionProvider ? provider : null);
    } else {
      setSimMotion(null);
    }
    let source: SensorSource;
    if (kind === 'synthetic') source = new SyntheticSource(scenario);
    else if (kind === 'replay') source = new ReplaySource(file!);
    else if (kind === 'phone-imu') source = new PhoneImuSource(provider!);
    else source = new HybridSource(physio === 'file' ? file! : scenarioRecord(scenario), provider!);

    await controller.start(source, {
      config: profile.engineConfig,
      speed,
      contact: profile.contact,
      userName: profile.userName,
      messageTemplate: profile.messageTemplate,
      countdownSec: profile.countdownSec,
    });
    setStarting(false);
  };

  return (
    <section aria-labelledby="setup-title">
      <h1 id="setup-title">{S.session.title}</h1>
      {snap.status === 'ended' && (
        <div className="card gold" role="status">
          <p>{S.session.ended}</p>
          <p className="muted">
            <a href={HREF.history}>{S.nav.history}</a> · <a href={HREF.metrics}>{S.nav.metrics}</a>
          </p>
        </div>
      )}

      <div className="card">
        <fieldset>
          <legend>{S.session.chooseSource}</legend>
          {SOURCE_KINDS.map((k) => (
            <label key={k} className="choice">
              <input type="radio" name="source" checked={kind === k} onChange={() => setKind(k)} />
              <span>{S.session.sources[k]}</span>
            </label>
          ))}
          <p className="hint">{S.session.sourceHelp[kind]}</p>
        </fieldset>

        {kind === 'hybrid' && (
          <fieldset>
            <legend>Fisiología</legend>
            <label className="choice">
              <input type="radio" name="physio" checked={physio === 'scenario'} onChange={() => setPhysio('scenario')} />
              <span>{S.session.sources.synthetic}</span>
            </label>
            <label className="choice">
              <input type="radio" name="physio" checked={physio === 'file'} onChange={() => setPhysio('file')} />
              <span>{S.session.sources.replay}</span>
            </label>
          </fieldset>
        )}

        {usesScenario && (
          <div className="field">
            <label htmlFor="scenario-select" style={{ display: 'block', fontSize: '.9rem', color: 'var(--sage)', marginBottom: 4 }}>
              {S.session.scenario}
            </label>
            <select id="scenario-select" value={scenario} onChange={(e) => setScenario(e.target.value as SyntheticScenarioId)}>
              {SCENARIO_IDS.map((id) => (
                <option key={id} value={id}>
                  {S.session.scenarios[id]}
                </option>
              ))}
            </select>
          </div>
        )}

        {needsFile && (
          <label className="field">
            <span>{S.session.loadFile}</span>
            <input type="file" accept="application/json,.json" onChange={(e) => void onFile(e.target.files?.[0])} />
            {file && <span className="hint">{S.session.fileLoaded(file.name, file.windows.length)}</span>}
            {fileError && (
              <span className="error-text" role="alert">
                {fileError}
              </span>
            )}
          </label>
        )}

        {(kind === 'phone-imu' || kind === 'hybrid') && (
          <fieldset>
            <legend>{S.session.motionSource}</legend>
            <label className="choice">
              <input type="radio" name="motion" checked={motion === 'real'} onChange={() => setMotion('real')} />
              <span>{S.session.motionReal}</span>
            </label>
            <label className="choice">
              <input type="radio" name="motion" checked={motion === 'simulated'} onChange={() => setMotion('simulated')} />
              <span>{S.session.motionSimulated}</span>
            </label>
          </fieldset>
        )}

        {kind !== 'phone-imu' && (
          <fieldset>
            <legend>{S.session.speed}</legend>
            <div className="seg" role="group" aria-label={S.session.speed}>
              {SPEEDS.map((s) => (
                <button key={s} type="button" className="btn" aria-pressed={speed === s} onClick={() => setSpeed(s)}>
                  {S.session.speedX(s)}
                </button>
              ))}
            </div>
            {kind === 'hybrid' && <p className="hint">{S.session.speedLocked}</p>}
          </fieldset>
        )}

        <button type="button" className="btn primary big block" disabled={!canStart} onClick={() => void start()}>
          {S.session.start}
        </button>
        <p className="hint" style={{ marginTop: 10 }}>
          {S.session.backgroundNote}
        </p>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ //
// Sesión en curso
// ------------------------------------------------------------------ //
function LiveSession() {
  const snap = useSession();
  const st = snap.last;
  let main: React.ReactNode;
  if (snap.escalation) main = <EscalationView />;
  else if (st?.state === 'INTERVENE') main = <BreathingView />;
  else if (st?.state === 'RECOVERY') main = <RecoveryView />;
  else main = <MonitorView />;

  return (
    <section aria-label={S.session.title}>
      <SessionControls />
      {/* anuncio del estado para lector de pantalla */}
      <p className="sr-only" aria-live="polite">
        {stateLabel(st)}
      </p>
      {main}
    </section>
  );
}

/** Texto del estado: el mismo para la pantalla y para el lector de pantalla. */
function stateLabel(st: ReturnType<typeof useSession>['last']): string {
  if (!st) return S.monitor.noData;
  if (!st.ready) return S.stateWarmup;
  if (st.gated) return S.stateGated;
  return S.states[st.state];
}

function SessionControls() {
  const { controller } = useApp();
  const snap = useSession();
  const t = useRecordNow(true, 2);
  const meta = snap.meta!;
  const canSpeed = meta.speedPolicy === 'free';
  return (
    <div className="card">
      <div className="row between">
        <div className="row">
          <span className={`badge ${meta.realUse ? 'gold' : ''}`}>{meta.realUse ? S.session.realBadge : S.session.demoBadge}</span>
          {meta.synthetic && <span className="badge">{S.session.syntheticBadge}</span>}
          {meta.usesMotion && !meta.realUse && meta.name.includes('simulado') && <span className="badge">{S.session.simulatedBadge}</span>}
        </div>
        <span className="mono" aria-label={S.session.recordTime}>
          {fmtClock(t)}
          {meta.durationSec ? ` / ${fmtClock(meta.durationSec)}` : ''}
        </span>
      </div>
      <p className="hint" style={{ margin: '6px 0 10px' }}>
        {meta.name}
      </p>
      <div className="row between">
        <div className="row">
          {snap.status === 'running' ? (
            <button type="button" className="btn" onClick={() => controller.pause()} disabled={!!snap.escalation}>
              {S.session.pause}
            </button>
          ) : (
            <button type="button" className="btn" onClick={() => controller.resume()} disabled={!!snap.escalation}>
              {S.session.play}
            </button>
          )}
          {meta.speedPolicy !== 'realtime' && (
            <div className="seg" role="group" aria-label={S.session.speed}>
              {SPEEDS.map((s) => (
                <button
                  key={s}
                  type="button"
                  className="btn"
                  aria-pressed={snap.userSpeed === s}
                  disabled={!canSpeed}
                  onClick={() => controller.setSpeed(s)}
                >
                  {S.session.speedX(s)}
                </button>
              ))}
            </div>
          )}
        </div>
        <button type="button" className="btn ghost" onClick={() => void controller.stop()}>
          {S.session.stop}
        </button>
      </div>
      {snap.speedForced && (
        <p className="banner" style={{ marginTop: 10 }}>
          {S.session.speedForced}
        </p>
      )}
      <p className="hint" style={{ marginTop: 8, marginBottom: 0 }}>
        {snap.wakeLock === 'on' ? S.session.wakeLockOn : S.session.wakeLockOff} · {S.session.backgroundNote}
      </p>
      {snap.sourceStatus === 'needs-permission' && <p className="error-text" role="alert">{S.session.needsPermission}</p>}
      {snap.sourceStatus === 'no-sensor' && <p className="error-text" role="alert">{S.session.noSensor}</p>}
    </div>
  );
}

function MonitorView() {
  const snap = useSession();
  const { profile } = useApp();
  const [marking, setMarking] = useState(false);
  const { controller } = useApp();
  const st = snap.last;
  const internals = snap.internals;
  const cfg = profile.engineConfig;
  const h = snap.history;
  const ready = st?.ready ?? false;

  return (
    <>
      {snap.episode && st?.state === 'WATCH' && <DetectionCard episode={snap.episode} />}
      {snap.lastClosed && !snap.episode && <ClosedBanner ep={snap.lastClosed} />}

      <div className="card" data-state={st ? (st.gated && ready ? 'GATED' : st.state) : 'IDLE'}>
        <div className="row between">
          <span className="state-pill">
            {stateLabel(st)}
          </span>
          {st?.score !== null && st?.score !== undefined && ready && !st.gated && (
            <span className="mono big-number" style={{ fontSize: '1.6rem' }}>
              {fmtNumber(st.score)}
            </span>
          )}
        </div>

        {!ready && (
          <div className="stack" style={{ marginTop: 12 }}>
            <h3>{S.monitor.warmup}</h3>
            <div
              className="meter"
              role="progressbar"
              aria-label={S.monitor.warmup}
              aria-valuemin={0}
              aria-valuemax={internals?.warmupWindows ?? cfg.warmup_windows}
              aria-valuenow={internals?.warmCount ?? 0}
            >
              <div style={{ width: `${((internals?.warmCount ?? 0) / (internals?.warmupWindows ?? cfg.warmup_windows)) * 100}%` }} />
            </div>
            <p className="hint">
              {S.monitor.warmupProgress(internals?.warmCount ?? 0, internals?.warmupWindows ?? cfg.warmup_windows)}. {S.monitor.warmupHelp}
            </p>
          </div>
        )}

        {ready && st?.gated && (
          <p className="banner" style={{ marginTop: 10 }}>
            {st.reason === 'señal insuficiente' ? S.monitor.gatedSignal : S.monitor.gatedMotion}
          </p>
        )}
        {ready && st?.reason === 'asentando tras movimiento' && <p className="hint">{S.monitor.settling}</p>}
        {ready && internals && st && st.t < internals.cooldownUntil && st.state === 'IDLE' && (
          <p className="hint">{S.monitor.cooldown}</p>
        )}

        {ready && (
          <div style={{ marginTop: 12 }}>
            <p className="hint" style={{ marginBottom: 4 }}>
              {S.monitor.score}
            </p>
            <Sparkline
              big
              label={`${S.monitor.score}: ${fmtNumber(st?.score ?? null)}`}
              values={h.map((p) => (p.gated ? null : p.score))}
              gated={h.map((p) => p.gated)}
              thresholds={[
                { value: cfg.theta_watch, color: 'rgba(217,180,91,.6)' },
                { value: cfg.theta_act, color: 'rgba(224,104,122,.7)' },
              ]}
              min={-1}
              max={3}
            />
            <p className="hint">{S.monitor.scoreHelp}</p>
          </div>
        )}
      </div>

      {snap.meta?.usesMotion && <MotionPanel />}

      <div className="card">
        <h2>{S.monitor.signals}</h2>
        <Signal name={S.monitor.signalNames.hr} unit="lpm" values={h.map((p) => p.hr)} digits={0} />
        <Signal name={S.monitor.signalNames.rmssd} unit="ms" values={h.map((p) => p.rmssd)} digits={0} />
        <Signal name={S.monitor.signalNames.eda} unit="µS" values={h.map((p) => p.eda)} digits={2} />
        <Signal name={S.monitor.signalNames.acc} unit="" values={h.map((p) => p.acc)} digits={2} gated={h.map((p) => p.gated)} />
      </div>

      <button type="button" className="btn block" onClick={() => setMarking(true)}>
        {S.session.markMoment}
      </button>
      {marking && (
        <LabelDialog
          manual
          onLater={() => setMarking(false)}
          onSave={(label) => {
            void controller.markMoment(label);
            setMarking(false);
          }}
        />
      )}
    </>
  );
}

function Signal({ name, unit, values, digits, gated }: { name: string; unit: string; values: (number | null)[]; digits: number; gated?: boolean[] }) {
  const last = [...values].reverse().find((v) => v !== null) ?? null;
  const text = `${name}: ${last === null ? '—' : `${fmtNumber(last, digits)} ${unit}`}`;
  return (
    <div className="sig">
      <span className="muted">{name}</span>
      <span className="val">
        {fmtNumber(last, digits)} {unit}
      </span>
      <Sparkline values={values} gated={gated} label={text} color="#93ab9d" />
    </div>
  );
}

function MotionPanel() {
  const snap = useSession();
  const { simMotion } = useApp();
  const [activity, setActivity] = useState<SimulatedActivity>(simMotion?.activity ?? 'still');
  const m = snap.live;
  const frac = m ? Math.min(1, m.motion / LIVE_THRESHOLDS.walk) : 0;
  const moving = m ? m.motion >= LIVE_THRESHOLDS.light : false;
  return (
    <div className="card">
      <div className="row between">
        <h2 style={{ margin: 0 }}>{S.monitor.liveMotion}</h2>
        <span>{m ? S.monitor.liveLevels[m.level] : '—'}</span>
      </div>
      <div
        className={`meter motion ${moving ? 'gated' : ''}`}
        style={{ marginTop: 10 }}
        role="meter"
        aria-label={S.monitor.liveMotion}
        aria-valuemin={0}
        aria-valuemax={1}
        aria-valuenow={Number(frac.toFixed(2))}
        aria-valuetext={m ? S.monitor.liveLevels[m.level] : '—'}
      >
        <div style={{ width: `${frac * 100}%` }} />
      </div>
      {simMotion && (
        <div className="row" style={{ marginTop: 12 }}>
          <span className="hint">{S.session.simulate}:</span>
          <div className="seg" role="group" aria-label={S.session.simulate}>
            {(['still', 'walking', 'shaking'] as SimulatedActivity[]).map((a) => (
              <button
                key={a}
                type="button"
                className="btn"
                aria-pressed={activity === a}
                onClick={() => {
                  simMotion.activity = a;
                  setActivity(a);
                }}
              >
                {S.session.simActivities[a]}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function EvidenceList({ ep }: { ep: Episode }) {
  if (!ep.evidence.length) return <p>{S.detection.noEvidence}</p>;
  return (
    <>
      <p className="muted" style={{ marginBottom: 4 }}>
        {S.detection.evidenceLead}
      </p>
      <ul className="evidence">
        {ep.evidence.map((e) => (
          <li key={e.key}>{e.text}</li>
        ))}
      </ul>
    </>
  );
}

function DetectionCard({ episode }: { episode: Episode }) {
  return (
    <div className="card gold" role="status">
      <h2>{S.detection.watchTitle}</h2>
      <EvidenceList ep={episode} />
      <p className="muted" style={{ margin: 0 }}>
        {S.detection.watchBody}
      </p>
    </div>
  );
}

function ClosedBanner({ ep }: { ep: Episode }) {
  if (ep.outcome === 'resolved') {
    return (
      <div className="card gold" role="status">
        <h2>{S.resolved.title}</h2>
        <p style={{ margin: 0 }}>{S.resolved.ttb(fmtDuration(ep.ttbSec))}</p>
      </div>
    );
  }
  if (ep.outcome === 'watch_end') {
    return (
      <div className="card" role="status">
        <p style={{ margin: 0 }}>{S.resolved.watchEnd}</p>
      </div>
    );
  }
  if (ep.outcome === 'escalated') {
    return (
      <div className="card" role="status">
        <p style={{ margin: 0 }}>{ep.escalation === 'cancelled' ? S.escalation.cancelled : S.escalation.opened}</p>
      </div>
    );
  }
  return null;
}

function BreathingView() {
  const snap = useSession();
  const { controller, profile } = useApp();
  const t = useAnimationClock(true);
  const start = snap.internals?.phaseStart ?? t;
  return (
    <div className="card gold">
      <h2>{S.detection.interveneTitle}</h2>
      {snap.episode && <EvidenceList ep={snap.episode} />}
      <p>{S.detection.proposal}</p>
      <h3 style={{ textAlign: 'center', marginTop: 8 }}>{S.breathing.title}</h3>
      <Breathing
        elapsed={t - start}
        total={profile.engineConfig.intervention_sec}
        pattern={profile.breathingPattern}
        paused={snap.status === 'paused'}
      />
      <button type="button" className="btn block" onClick={() => void controller.endBreathing()}>
        {S.breathing.endEarly}
      </button>
      <p className="hint" style={{ textAlign: 'center', marginTop: 10 }}>
        {S.breathing.footer}
      </p>
    </div>
  );
}

function RecoveryView() {
  const snap = useSession();
  const { profile } = useApp();
  const t = useRecordNow(true, 2);
  const start = snap.internals?.episodeStart ?? t;
  const graceLeft = Math.max(0, (snap.internals?.phaseStart ?? t) + profile.engineConfig.recovery_grace_sec - t);
  const name = profile.contact?.name;
  return (
    <>
      <div className="card gold">
        <h2>{S.recovery.title}</h2>
        <p>{S.recovery.body}</p>
        <p className="muted" style={{ marginBottom: 2 }}>
          {S.recovery.ttb}
        </p>
        <p className="big-number" aria-live="off">
          {fmtClock(t - start)}
        </p>
        <p className="hint">{S.recovery.ttbHelp}</p>
        <p style={{ margin: 0 }}>
          {name ? S.recovery.grace(fmtDuration(graceLeft), name) : S.recovery.graceNoContact(fmtDuration(graceLeft))}
        </p>
      </div>
      <MonitorSignalsOnly />
    </>
  );
}

function MonitorSignalsOnly() {
  const snap = useSession();
  const { profile } = useApp();
  const h = snap.history;
  return (
    <div className="card">
      <p className="hint" style={{ marginBottom: 4 }}>
        {S.monitor.score}
      </p>
      <Sparkline
        big
        label={S.monitor.score}
        values={h.map((p) => (p.gated ? null : p.score))}
        gated={h.map((p) => p.gated)}
        thresholds={[{ value: profile.engineConfig.theta_exit, color: 'rgba(143,211,176,.7)' }]}
        min={-1}
        max={3}
      />
    </div>
  );
}

function EscalationView() {
  const snap = useSession();
  const { controller } = useApp();
  const esc = snap.escalation!;
  return (
    <div className="card alert" role="alertdialog" aria-labelledby="esc-title" aria-describedby="esc-body">
      <h2 id="esc-title" style={{ color: 'var(--cream)' }}>
        {S.escalation.title}
      </h2>
      <p id="esc-body">{esc.contactName ? S.escalation.body(esc.contactName) : S.escalation.bodyNoContact}</p>
      {esc.url && !esc.blocked && (
        <p className="countdown" aria-live="off">
          {esc.remainingSec}
          <span className="sr-only"> s</span>
        </p>
      )}
      {esc.url && !esc.blocked && <p className="hint">{S.escalation.countdown(esc.remainingSec)}</p>}
      {esc.blocked && esc.url && <p role="alert">{S.escalation.openBlocked}</p>}
      {esc.url && (
        <>
          <p className="muted" style={{ marginBottom: 4 }}>
            {S.escalation.preview}
          </p>
          <p className="message-preview">{esc.message}</p>
        </>
      )}
      <p className="hint">{S.escalation.secure}</p>
      <div className="row" style={{ marginTop: 12 }}>
        <button type="button" className="btn big" onClick={() => void controller.cancelEscalation()} autoFocus>
          {S.escalation.cancel}
        </button>
        {esc.url ? (
          <button type="button" className="btn primary big" onClick={() => void controller.openEscalationNow()}>
            {esc.blocked ? S.escalation.openManual : S.escalation.openNow}
          </button>
        ) : (
          <a className="btn" href={HREF.settings}>
            {S.escalation.configure}
          </a>
        )}
      </div>
      <p style={{ marginTop: 16, marginBottom: 0 }}>
        {S.escalation.emergency}{' '}
        <a href="tel:911" className="btn ghost">
          {S.escalation.emergencyCall}
        </a>
      </p>
    </div>
  );
}

// ------------------------------------------------------------------ //
// Cola de etiquetado
// ------------------------------------------------------------------ //
function LabelQueue() {
  const snap = useSession();
  const { controller } = useApp();
  const id = snap.pendingLabels[0];
  if (!id || snap.escalation) return null;
  const ep = snap.lastClosed?.id === id ? snap.lastClosed : null;
  const context = ep
    ? ep.outcome === 'resolved'
      ? `${S.resolved.title} · ${S.resolved.ttb(fmtDuration(ep.ttbSec))}`
      : ep.outcome === 'watch_end'
        ? S.resolved.watchEnd
        : ep.escalation === 'cancelled'
          ? S.escalation.cancelled
          : S.escalation.opened
    : undefined;
  return (
    <LabelDialog
      key={id}
      context={context}
      onLater={() => controller.dismissLabel(id)}
      onSave={(label) => void controller.labelEpisode(id, label)}
    />
  );
}
