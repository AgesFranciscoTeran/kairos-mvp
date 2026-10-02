import type { BreathingPattern } from '../../store/db';
import { fmtClock } from '../format';
import { useReducedMotion } from '../hooks';
import { S } from '../strings';

export interface BreathStep {
  phase: 'inhale' | 'hold' | 'exhale';
  sec: number;
}

export function parsePattern(p: BreathingPattern): BreathStep[] {
  const n = p.split('-').map(Number);
  if (n.length === 3) {
    return [
      { phase: 'inhale', sec: n[0]! },
      { phase: 'hold', sec: n[1]! },
      { phase: 'exhale', sec: n[2]! },
    ];
  }
  return [
    { phase: 'inhale', sec: n[0]! },
    { phase: 'exhale', sec: n[1]! },
  ];
}

/** Fase actual del patrón a los `elapsed` segundos. */
export function breathAt(steps: BreathStep[], elapsed: number) {
  const cycle = steps.reduce((s, x) => s + x.sec, 0);
  let pos = ((elapsed % cycle) + cycle) % cycle;
  for (let i = 0; i < steps.length; i++) {
    const st = steps[i]!;
    if (pos < st.sec) {
      return { step: st, next: steps[(i + 1) % steps.length]!, progress: pos / st.sec, left: Math.ceil(st.sec - pos) };
    }
    pos -= st.sec;
  }
  return { step: steps[0]!, next: steps[1]!, progress: 0, left: steps[0]!.sec };
}

const PHASE_TEXT = { inhale: S.breathing.inhale, hold: S.breathing.hold, exhale: S.breathing.exhale };

interface Props {
  elapsed: number;
  total: number;
  pattern: BreathingPattern;
  paused?: boolean;
  compact?: boolean;
}

export function Breathing({ elapsed, total, pattern, paused, compact }: Props) {
  const reduced = useReducedMotion();
  const steps = parsePattern(pattern);
  const e = Math.max(0, Math.min(total, elapsed));
  const { step, next, progress, left } = breathAt(steps, e);

  // escala del núcleo: crece al inhalar, se sostiene, se contrae al exhalar
  const scale = reduced
    ? 1
    : step.phase === 'inhale'
      ? 0.62 + 0.38 * progress
      : step.phase === 'hold'
        ? 1
        : 1 - 0.38 * progress;

  const size = compact ? 150 : 220;
  const r = compact ? 66 : 100;
  const circ = 2 * Math.PI * r;
  const done = e / total;

  return (
    <div className="breath">
      {/* el lector de pantalla oye la fase solo cuando cambia */}
      <p className="sr-only" aria-live="polite">
        {paused ? S.breathing.paused : `${PHASE_TEXT[step.phase]}, ${S.breathing.seconds(step.sec)}`}
      </p>
      <div className="breath-ring" style={{ width: size, height: size }} aria-hidden="true">
        <svg viewBox={`0 0 ${size} ${size}`}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#1d3a2b" strokeWidth="6" />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="#6fd59a"
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={circ}
            strokeDashoffset={circ * (1 - done)}
          />
        </svg>
        <div
          className="breath-core"
          style={{
            transform: `scale(${scale})`,
            width: compact ? 100 : 150,
            height: compact ? 100 : 150,
          }}
        >
          <span className="breath-phase">{paused ? S.breathing.paused : PHASE_TEXT[step.phase]}</span>
          <span className="breath-secs mono">{S.breathing.seconds(left)}</span>
        </div>
      </div>
      {!compact && (
        <>
          <p className="breath-then">
            {S.breathing.then} <strong>{PHASE_TEXT[next.phase]}</strong> · {S.breathing.seconds(next.sec)}
          </p>
          <p className="muted mono">{S.breathing.remaining(fmtClock(total - e))}</p>
        </>
      )}
    </div>
  );
}
