/**
 * SessionController: orquesta una sesión en el hilo principal.
 *
 *   SensorSource ──FeatureWindow──▶ EngineClient (worker) ──StepResult──▶ episodios, UI, IndexedDB
 *
 * Reglas de tiempo (ver README, "Reloj acelerado"):
 * - El motor solo ve tiempo de registro.
 * - Al entrar en INTERVENE la reproducción baja a 1× hasta salir de esa fase, para que los
 *   90 s del motor sean 90 s reales de respiración.
 * - Al escalar, el reloj se pausa y las ventanas que ya venían se retienen hasta que el
 *   usuario decide (cancelar o abrir el mensaje). Esa decisión entra al motor por
 *   applyAction (extensión X-01).
 */
import type { EngineConfig, EngineState, OperationalMetrics, UserAction } from '@kairos/engine';
import type { FeatureWindow } from '@kairos/engine';
import { db, newId, type Mark } from '../store/db';
import type { LiveMotion, SensorSource, SourceMeta, SourceStatus } from '../sources/types';
import { PlaybackClock, realScheduler, type Scheduler, type Speed } from './clock';
import type { EngineClient } from './engineClient';
import { escalationUrl, openLink, renderMessage, type TrustedContact } from './escalation';
import { EpisodeTracker, type ContextLabel, type Episode } from './episodes';
import type { RunnerInternals, StepResult } from './runner';
import { browserWakeLock, type WakeLockPort } from './wakeLock';

export const HISTORY_LEN = 120;

export interface HistoryPoint {
  t: number;
  score: number | null;
  gated: boolean;
  state: EngineState['state'];
  hr: number | null;
  rmssd: number | null;
  eda: number | null;
  acc: number | null;
}

export interface EscalationView {
  deadlineWall: number;
  remainingSec: number;
  contactName: string | null;
  message: string;
  url: string | null;
  /** el navegador bloqueó la apertura automática: hace falta un toque */
  blocked: boolean;
}

export interface SessionSnapshot {
  status: 'idle' | 'running' | 'paused' | 'ended';
  sessionId: string | null;
  meta: SourceMeta | null;
  sourceStatus: SourceStatus['kind'];
  speed: Speed;
  /** velocidad que el usuario eligió (se restaura al salir de INTERVENE) */
  userSpeed: Speed;
  speedForced: boolean;
  last: EngineState | null;
  internals: RunnerInternals | null;
  history: HistoryPoint[];
  live: LiveMotion | null;
  episode: Episode | null;
  lastClosed: Episode | null;
  escalation: EscalationView | null;
  pendingLabels: string[];
  wakeLock: 'on' | 'off' | 'unsupported';
  metrics: OperationalMetrics | null;
}

export interface SessionOptions {
  config: EngineConfig;
  speed: Speed;
  contact: TrustedContact | null;
  userName: string;
  messageTemplate: string;
  countdownSec: number;
}

export interface ControllerDeps {
  engineFactory: (cfg: EngineConfig) => EngineClient;
  scheduler?: Scheduler;
  openLink?: (url: string) => boolean;
  wakeLock?: WakeLockPort;
  /** guardar en IndexedDB (false en algunos tests) */
  persist?: boolean;
  nowIso?: () => string;
}

const IDLE_SNAPSHOT: SessionSnapshot = {
  status: 'idle',
  sessionId: null,
  meta: null,
  sourceStatus: 'idle',
  speed: 30,
  userSpeed: 30,
  speedForced: false,
  last: null,
  internals: null,
  history: [],
  live: null,
  episode: null,
  lastClosed: null,
  escalation: null,
  pendingLabels: [],
  wakeLock: 'off',
  metrics: null,
};

export class SessionController {
  private snap: SessionSnapshot = IDLE_SNAPSHOT;
  private listeners = new Set<() => void>();
  private readonly scheduler: Scheduler;
  private readonly open: (url: string) => boolean;
  private readonly wake: WakeLockPort;
  private readonly persist: boolean;
  private readonly nowIso: () => string;

  private clock: PlaybackClock | null = null;
  private source: SensorSource | null = null;
  private engine: EngineClient | null = null;
  private tracker: EpisodeTracker | null = null;
  private opts: SessionOptions | null = null;
  private queue: Promise<void> = Promise.resolve();
  private held: FeatureWindow[] = [];
  private unsubs: (() => void)[] = [];
  private stopCountdown: (() => void) | null = null;

  constructor(private readonly deps: ControllerDeps) {
    this.scheduler = deps.scheduler ?? realScheduler;
    this.open = deps.openLink ?? openLink;
    this.wake = deps.wakeLock ?? browserWakeLock();
    this.persist = deps.persist ?? true;
    this.nowIso = deps.nowIso ?? (() => new Date().toISOString());
  }

  // ------------------------------------------------------------------ //
  // Suscripción (useSyncExternalStore)
  // ------------------------------------------------------------------ //
  subscribe = (cb: () => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };
  getSnapshot = () => this.snap;

  /** Tiempo de registro actual (para cronómetros de la UI). */
  recordNow(): number {
    return this.clock?.now() ?? 0;
  }

  /** Espera a que se procesen todas las ventanas en cola (tests). */
  idle(): Promise<void> {
    return this.queue;
  }

  // ------------------------------------------------------------------ //
  // Ciclo de vida
  // ------------------------------------------------------------------ //
  /** Debe llamarse desde un gesto del usuario (permisos de sensores, Wake Lock). */
  async start(source: SensorSource, opts: SessionOptions): Promise<void> {
    if (this.source) await this.stop();
    const speed: Speed = source.meta.speedPolicy === 'realtime' ? 1 : opts.speed;
    const sessionId = newId();
    this.opts = { ...opts, speed };
    this.source = source;
    this.engine = this.deps.engineFactory(opts.config);
    this.clock = new PlaybackClock(speed, this.scheduler);
    this.held = [];
    this.queue = Promise.resolve();
    this.tracker = new EpisodeTracker({
      sessionId,
      sourceKind: source.meta.kind,
      demo: !source.meta.realUse,
      newId,
      nowIso: this.nowIso,
    });

    this.set({
      ...IDLE_SNAPSHOT,
      status: 'running',
      sessionId,
      meta: source.meta,
      sourceStatus: 'idle',
      speed,
      userSpeed: speed,
      pendingLabels: this.snap.pendingLabels,
    });

    this.unsubs.push(
      source.onWindow((w) => this.enqueue(w)),
      source.onStatus((s) => this.onSourceStatus(s)),
    );
    if (source.onLive) this.unsubs.push(source.onLive((m) => this.set({ live: m })));

    if (this.persist) {
      void db.sessions
        .add({
          id: sessionId,
          startedAt: this.nowIso(),
          endedAt: null,
          sourceKind: source.meta.kind,
          sourceName: source.meta.name,
          demo: !source.meta.realUse,
          speed,
          config: opts.config,
          metrics: null,
        })
        .catch(() => {});
    }

    this.clock.start();
    void this.wake.request().then((ok) => this.set({ wakeLock: ok ? 'on' : 'unsupported' }));
    await source.start(this.clock);
  }

  pause(): void {
    if (!this.clock || this.snap.status !== 'running') return;
    this.clock.pause();
    this.set({ status: 'paused' });
  }

  resume(): void {
    if (!this.clock || this.snap.status !== 'paused' || this.snap.escalation) return;
    this.clock.resume();
    this.set({ status: 'running' });
  }

  setSpeed(s: Speed): void {
    if (!this.clock || !this.snap.meta) return;
    if (this.snap.meta.speedPolicy !== 'free') return;
    if (this.snap.speedForced) {
      this.set({ userSpeed: s }); // se aplica al salir de la respiración
      return;
    }
    this.clock.setSpeed(s);
    this.set({ speed: s, userSpeed: s });
  }

  async stop(): Promise<void> {
    if (!this.source) return;
    this.source.stop();
    this.clock?.stop();
    this.stopCountdown?.();
    this.stopCountdown = null;
    await this.queue;
    await this.finish();
  }

  // ------------------------------------------------------------------ //
  // Acciones del usuario
  // ------------------------------------------------------------------ //
  endBreathing(): Promise<void> {
    return this.act({ kind: 'end_intervention', t: this.recordNow() });
  }

  cancelEscalation(): Promise<void> {
    return this.closeEscalation('cancel_escalation');
  }

  /** Abre el mensaje desde un toque del usuario (siempre permitido por el navegador). */
  openEscalationNow(): Promise<void> {
    const esc = this.snap.escalation;
    if (!esc?.url) return Promise.resolve();
    if (!this.open(esc.url)) {
      this.set({ escalation: { ...esc, blocked: true } });
      return Promise.resolve();
    }
    return this.closeEscalation('open_escalation');
  }

  async labelEpisode(id: string, label: ContextLabel): Promise<void> {
    if (this.persist) await db.episodes.update(id, { label, needsLabel: false });
    this.set({ pendingLabels: this.snap.pendingLabels.filter((x) => x !== id) });
  }

  /** "Ahora no": sale de la cola visible; queda pendiente en el historial. */
  dismissLabel(id: string): void {
    this.set({ pendingLabels: this.snap.pendingLabels.filter((x) => x !== id) });
  }

  async markMoment(label: ContextLabel): Promise<Mark | null> {
    if (!this.snap.sessionId) return null;
    const mark: Mark = {
      id: newId(),
      sessionId: this.snap.sessionId,
      demo: !(this.snap.meta?.realUse ?? false),
      t: this.recordNow(),
      at: this.nowIso(),
      engineState: this.snap.last?.state ?? 'IDLE',
      label,
    };
    if (this.persist) await db.marks.add(mark);
    return mark;
  }

  // ------------------------------------------------------------------ //
  // Internos
  // ------------------------------------------------------------------ //
  private set(patch: Partial<SessionSnapshot>): void {
    this.snap = { ...this.snap, ...patch };
    for (const cb of this.listeners) cb();
  }

  private enqueue(w: FeatureWindow): void {
    this.queue = this.queue.then(() => {
      // durante el escalamiento las ventanas esperan la decisión del usuario
      if (this.snap.escalation) {
        this.held.push(w);
        return;
      }
      return this.process(w);
    });
  }

  private async process(w: FeatureWindow): Promise<void> {
    if (!this.engine) return;
    const prev = this.snap.last?.state ?? 'IDLE';
    const res = await this.engine.step(w);
    const f = w.features;
    const point: HistoryPoint = {
      t: res.state.t,
      score: res.state.score,
      gated: res.state.gated,
      state: res.state.state,
      hr: f.hr_mean,
      rmssd: f.rmssd,
      eda: f.eda_scl_mean,
      acc: f.acc_move_std,
    };
    const history = [...this.snap.history, point].slice(-HISTORY_LEN);
    this.set({ last: res.state, internals: res.internals, history });
    this.track(res);
    this.applyTimePolicy(prev, res.state.state);
    if (res.events.some((e) => e.kind === 'escalate')) this.beginEscalation();
  }

  private async act(a: UserAction): Promise<void> {
    // las acciones van por la misma cola que las ventanas: el orden se respeta
    this.queue = this.queue.then(async () => {
      if (!this.engine) return;
      const prev = this.snap.last?.state ?? 'IDLE';
      const res = await this.engine.action(a);
      if (!res.event) return;
      const state = this.snap.last ? { ...this.snap.last, state: res.event.state } : null;
      this.set({ last: state, internals: res.internals });
      this.track({ state: state!, events: [res.event], internals: res.internals });
      this.applyTimePolicy(prev, res.event.state);
    });
    return this.queue;
  }

  private track(res: StepResult): void {
    if (!this.tracker) return;
    const { changed, closed } = this.tracker.apply(res.events, res.state);
    if (changed && this.persist) void db.episodes.put(structuredClone(changed)).catch(() => {});
    if (closed) {
      const pending = closed.needsLabel ? [...this.snap.pendingLabels, closed.id] : this.snap.pendingLabels;
      this.set({ episode: null, lastClosed: { ...closed }, pendingLabels: pending });
    } else if (changed) {
      this.set({ episode: { ...changed } });
    }
  }

  /** 1× durante INTERVENE; restaura la velocidad del usuario al salir. */
  private applyTimePolicy(prev: EngineState['state'], next: EngineState['state']): void {
    if (!this.clock) return;
    if (next === 'INTERVENE' && prev !== 'INTERVENE' && this.clock.speed !== 1) {
      this.clock.setSpeed(1);
      this.set({ speed: 1, speedForced: true });
    } else if (prev === 'INTERVENE' && next !== 'INTERVENE' && this.snap.speedForced) {
      this.clock.setSpeed(this.snap.userSpeed);
      this.set({ speed: this.snap.userSpeed, speedForced: false });
    }
  }

  private beginEscalation(): void {
    if (!this.clock || !this.opts) return;
    this.clock.pause();
    const o = this.opts;
    const message = renderMessage(o.messageTemplate, o.userName);
    const url = o.contact ? escalationUrl(o.contact, message) : null;
    const deadlineWall = this.scheduler.nowMs() + o.countdownSec * 1000;
    this.set({
      escalation: { deadlineWall, remainingSec: o.countdownSec, contactName: o.contact?.name ?? null, message, url, blocked: false },
    });
    this.stopCountdown = this.scheduler.every(250, () => this.countdownTick());
  }

  private countdownTick(): void {
    const esc = this.snap.escalation;
    if (!esc) return;
    const remaining = Math.max(0, Math.ceil((esc.deadlineWall - this.scheduler.nowMs()) / 1000));
    if (remaining > 0) {
      if (remaining !== esc.remainingSec) this.set({ escalation: { ...esc, remainingSec: remaining } });
      return;
    }
    this.stopCountdown?.();
    this.stopCountdown = null;
    // fin de la cuenta: intentamos abrir el mensaje; el usuario igual tiene que pulsar enviar
    if (esc.url && this.open(esc.url)) {
      void this.closeEscalation('open_escalation');
    } else {
      this.set({ escalation: { ...esc, remainingSec: 0, blocked: true } });
    }
  }

  private async closeEscalation(kind: 'cancel_escalation' | 'open_escalation'): Promise<void> {
    if (!this.snap.escalation) return;
    this.stopCountdown?.();
    this.stopCountdown = null;
    await this.act({ kind, t: this.recordNow() });
    this.set({ escalation: null });
    // las ventanas retenidas pasan ahora, en orden
    const held = this.held;
    this.held = [];
    for (const w of held) this.enqueue(w);
    if (this.snap.status === 'running') this.clock?.resume();
    await this.queue;
    // el registro pudo terminar mientras el usuario decidía
    if (this.snap.sourceStatus === 'ended' && !this.snap.escalation) await this.finish();
  }

  private onSourceStatus(s: SourceStatus): void {
    this.set({ sourceStatus: s.kind });
    if (s.kind === 'ended') {
      // termina cuando se procesó la última ventana (y no hay un escalamiento pendiente)
      void this.queue.then(() => {
        if (!this.snap.escalation) void this.finish();
      });
    }
  }

  private async finish(): Promise<void> {
    if (!this.source) return;
    const interrupted = this.tracker?.interrupt(this.recordNow()) ?? null;
    if (interrupted && this.persist) await db.episodes.put(structuredClone(interrupted)).catch(() => {});
    const metrics = (await this.engine?.metrics().catch(() => null)) ?? null;
    if (this.persist && this.snap.sessionId) {
      await db.sessions.update(this.snap.sessionId, { endedAt: this.nowIso(), metrics }).catch(() => {});
    }
    for (const u of this.unsubs) u();
    this.unsubs = [];
    this.engine?.dispose();
    this.wake.release();
    this.clock?.stop();
    this.source = null;
    this.engine = null;
    this.set({ status: 'ended', escalation: null, episode: null, metrics, wakeLock: 'off' });
  }
}
