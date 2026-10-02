import { fmtClock } from '../format';
import { useApp, useRecordNow, useSession, useAnimationClock } from '../hooks';
import { S } from '../strings';
import { Breathing } from './Breathing';

/**
 * Vista reloj: el estado mínimo y la respiración guiada, como en la pantalla de muñeca de
 * los mockups. Se alimenta de la misma sesión que la vista de teléfono.
 */
export function WatchFace() {
  const snap = useSession();
  const { controller, profile } = useApp();
  const st = snap.last;
  const inBreath = st?.state === 'INTERVENE' && !snap.escalation;
  const animT = useAnimationClock(inBreath);
  const now = useRecordNow(snap.status === 'running' || snap.status === 'paused');
  const clock = new Date().toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit' });

  let body: React.ReactNode;
  if (snap.status === 'idle' || snap.status === 'ended' || !st) {
    body = <p className="big">{snap.status === 'ended' ? S.session.ended : S.monitor.noData}</p>;
  } else if (snap.escalation) {
    const esc = snap.escalation;
    body = (
      <>
        <p className="big">{S.escalation.title}</p>
        <p className="countdown" style={{ fontSize: '1.8rem' }}>
          {esc.blocked ? '—' : esc.remainingSec}
        </p>
        <button type="button" className="btn" onClick={() => void controller.cancelEscalation()}>
          {S.escalation.cancel}
        </button>
      </>
    );
  } else if (inBreath) {
    body = (
      <Breathing
        compact
        elapsed={animT - (snap.internals?.phaseStart ?? animT)}
        total={profile.engineConfig.intervention_sec}
        pattern={profile.breathingPattern}
        paused={snap.status === 'paused'}
      />
    );
  } else if (!st.ready) {
    body = (
      <>
        <p className="big">{S.stateWarmup}</p>
        <p className="muted">{S.monitor.warmupProgress(snap.internals?.warmCount ?? 0, snap.internals?.warmupWindows ?? 8)}</p>
      </>
    );
  } else if (st.state === 'RECOVERY') {
    const start = snap.internals?.episodeStart ?? now;
    body = (
      <>
        <p className="big">{S.states.RECOVERY}</p>
        <p className="mono">{fmtClock(now - start)}</p>
      </>
    );
  } else {
    const gated = st.gated;
    body = (
      <p className="big state-pill" data-state={gated ? 'GATED' : st.state}>
        {gated ? S.stateGated : S.states[st.state]}
      </p>
    );
  }

  return (
    <div>
      <div className="watch" role="region" aria-label={S.watch.title}>
        <div className="watch-screen">
          <span className="time" aria-hidden="true">
            {clock}
          </span>
          <span className="wm">KAIROS</span>
          {body}
        </div>
      </div>
      <p className="watch-caption">{S.watch.title}</p>
    </div>
  );
}
