/**
 * Episodios: de `watch` al cierre. Se arman a partir de los eventos del motor; el motor no
 * sabe nada de episodios, etiquetas ni persistencia.
 *
 * Se pide etiqueta de contexto al cerrar por watch_end, resolved o escalamiento.
 */
import { ttbFromDetail, type EngineEvent, type EngineState } from '@kairos/engine';
import type { SourceKind } from '../sources/types';
import { topEvidence, type Evidence } from '../ui/evidence';

export type Outcome = 'watch_end' | 'watch_cancelled' | 'resolved' | 'escalated' | 'interrupted';
export type EscalationDecision = 'cancelled' | 'opened' | 'auto';
export type Activity = 'studying' | 'exam' | 'exercise' | 'caffeine' | 'hard_conversation' | 'temperature' | 'other';
export type Felt = 'yes' | 'no' | 'unsure';

export interface ContextLabel {
  activity: Activity;
  activityOther?: string;
  felt: Felt;
  labeledAt: string;
}

export interface Episode {
  id: string;
  sessionId: string;
  sourceKind: SourceKind;
  /** true si los datos no son de uso real (sintético, replay o híbrido) */
  demo: boolean;
  startedAt: string;
  startT: number;
  endT: number | null;
  evidence: Evidence[];
  intervened: boolean;
  interveneT: number | null;
  breathingEndedEarly: boolean;
  recoveryT: number | null;
  escalated: boolean;
  escalation: EscalationDecision | null;
  outcome: Outcome | null;
  /** TTB del evento `resolved` (desde la entrada a WATCH; ver ENGINE_DIVERGENCES H-04) */
  ttbSec: number | null;
  events: EngineEvent[];
  needsLabel: boolean;
  label: ContextLabel | null;
}

export interface TrackerContext {
  sessionId: string;
  sourceKind: SourceKind;
  demo: boolean;
  newId: () => string;
  nowIso: () => string;
}

export class EpisodeTracker {
  current: Episode | null = null;

  constructor(private readonly ctx: TrackerContext) {}

  /**
   * Procesa el resultado de un paso (o de una acción). Devuelve el episodio si cambió y si
   * quedó cerrado.
   */
  apply(events: EngineEvent[], state: EngineState | null): { changed: Episode | null; closed: Episode | null } {
    let changed: Episode | null = null;
    let closed: Episode | null = null;

    for (const e of events) {
      if (e.kind === 'baseline_ready') continue;
      if (e.kind === 'watch') {
        this.current = {
          id: this.ctx.newId(),
          sessionId: this.ctx.sessionId,
          sourceKind: this.ctx.sourceKind,
          demo: this.ctx.demo,
          startedAt: this.ctx.nowIso(),
          startT: e.t,
          endT: null,
          evidence: state ? topEvidence(state.z) : [],
          intervened: false,
          interveneT: null,
          breathingEndedEarly: false,
          recoveryT: null,
          escalated: false,
          escalation: null,
          outcome: null,
          ttbSec: null,
          events: [],
          needsLabel: false,
          label: null,
        };
      }
      const ep = this.current;
      if (!ep) continue;
      ep.events.push(e);
      switch (e.kind) {
        case 'intervene':
          ep.intervened = true;
          ep.interveneT = e.t;
          if (state) {
            const ev = topEvidence(state.z);
            if (ev.length) ep.evidence = ev;
          }
          break;
        case 'intervention_end':
          ep.recoveryT = e.t;
          ep.breathingEndedEarly = e.actor === 'user';
          break;
        case 'escalate':
          ep.escalated = true;
          break;
        case 'watch_cancelled':
          closed = this.close('watch_cancelled', e.t, false);
          break;
        case 'watch_end':
          closed = this.close('watch_end', e.t, true);
          break;
        case 'resolved':
          ep.ttbSec = ttbFromDetail(e.detail);
          closed = this.close('resolved', e.t, true);
          break;
        case 'escalation_cancelled':
        case 'escalation_opened':
          ep.escalation = e.kind === 'escalation_cancelled' ? 'cancelled' : 'opened';
          closed = this.close('escalated', e.t, true);
          break;
      }
      changed = ep;
    }

    // salida natural de ESCALATE (llegó una ventana sin decisión del usuario)
    if (this.current?.escalated && state && state.state !== 'ESCALATE' && !closed) {
      this.current.escalation = 'auto';
      changed = this.current;
      closed = this.close('escalated', state.t, true);
    }
    return { changed, closed };
  }

  /** Cierra el episodio abierto al terminar la sesión. */
  interrupt(t: number): Episode | null {
    return this.current ? this.close('interrupted', t, false) : null;
  }

  private close(outcome: Outcome, t: number, needsLabel: boolean): Episode {
    const ep = this.current!;
    ep.outcome = outcome;
    ep.endT = t;
    ep.needsLabel = needsLabel;
    this.current = null;
    return ep;
  }
}
