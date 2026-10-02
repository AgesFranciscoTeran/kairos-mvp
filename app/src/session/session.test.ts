import 'fake-indexeddb/auto';
import { DEFAULT_CONFIG, KairosEngine } from '@kairos/engine';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, deleteAll } from '../store/db';
import { SyntheticSource, type SyntheticScenarioId } from '../sources/synthetic';
import { FakeScheduler, type Speed } from './clock';
import { SessionController, type SessionOptions } from './controller';
import { InlineEngineClient } from './inlineEngineClient';
import { noWakeLock } from './wakeLock';

const CONTACT = { name: 'Vane', phone: '0991234567', channel: 'whatsapp' as const };

function setup(opts: { open?: (url: string) => boolean; contact?: SessionOptions['contact']; countdownSec?: number } = {}) {
  const sched = new FakeScheduler();
  const opened: string[] = [];
  const ctl = new SessionController({
    engineFactory: (cfg) => new InlineEngineClient(cfg),
    scheduler: sched,
    wakeLock: noWakeLock,
    openLink: (url) => {
      opened.push(url);
      return opts.open ? opts.open(url) : true;
    },
  });
  const sessionOpts = (speed: Speed): SessionOptions => ({
    config: { ...DEFAULT_CONFIG },
    speed,
    contact: opts.contact === undefined ? CONTACT : opts.contact,
    userName: 'Pancho',
    messageTemplate: 'Hola, soy {nombre}. Activé Kairos, ¿me puedes escribir o llamar cuando puedas?',
    countdownSec: opts.countdownSec ?? 30,
  });
  /** procesa la cola del controlador y cede el turno (IndexedDB usa macrotareas) */
  async function settle() {
    await ctl.idle();
    await new Promise((r) => setImmediate(r));
    await ctl.idle();
  }
  /** avanza el reloj real de a 1 s, procesando la cola, hasta que se cumpla `until` */
  async function runUntil(until: () => boolean, maxSec = 3000) {
    for (let i = 0; i < maxSec && !until(); i++) {
      sched.advance(1000);
      await settle();
    }
    if (!until()) throw new Error('no se cumplió la condición');
  }
  const start = async (scenario: SyntheticScenarioId, speed: Speed = 30) => {
    await ctl.start(new SyntheticSource(scenario), sessionOpts(speed));
  };
  return { ctl, sched, opened, runUntil, settle, start, snap: () => ctl.getSnapshot() };
}

beforeEach(async () => {
  await deleteAll();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('episodio que cede (WATCH → INTERVENE → RECOVERY → resuelto)', () => {
  it('recorre el ciclo, baja a 1× durante la respiración y pide etiqueta', async () => {
    const { ctl, snap, runUntil, start } = setup();
    await start('resolves', 30);
    const seen: string[] = [];
    ctl.subscribe(() => {
      const s = snap().last?.state;
      if (s && seen[seen.length - 1] !== s) seen.push(s);
    });

    await runUntil(() => snap().last?.state === 'INTERVENE');
    expect(snap().speed).toBe(1);
    expect(snap().speedForced).toBe(true);
    // el usuario cambia de velocidad durante la respiración: se aplica después
    ctl.setSpeed(10);
    expect(snap().speed).toBe(1);

    await runUntil(() => snap().last?.state === 'RECOVERY', 200);
    expect(snap().speed).toBe(10);
    expect(snap().speedForced).toBe(false);

    await runUntil(() => snap().status === 'ended');
    expect(seen).toEqual(expect.arrayContaining(['WATCH', 'INTERVENE', 'RECOVERY', 'IDLE']));
    const ep = snap().lastClosed!;
    expect(ep.outcome).toBe('resolved');
    expect(ep.ttbSec).toBeGreaterThan(0);
    expect(ep.intervened).toBe(true);
    expect(ep.demo).toBe(true);
    expect(ep.evidence.length).toBeGreaterThan(0);
    expect(snap().pendingLabels).toContain(ep.id);

    const stored = await db.episodes.get(ep.id);
    expect(stored?.outcome).toBe('resolved');
    const session = await db.sessions.get(snap().sessionId!);
    expect(session?.endedAt).not.toBeNull();
    expect(session?.metrics?.interventions).toBe(1);
  });

  it('la respiración dura 90 s reales aunque la sesión vaya a 30×', async () => {
    const { sched, snap, runUntil, start } = setup();
    await start('resolves', 30);
    await runUntil(() => snap().last?.state === 'INTERVENE');
    const wall0 = sched.nowMs();
    await runUntil(() => snap().last?.state === 'RECOVERY', 200);
    const realSec = (sched.nowMs() - wall0) / 1000;
    expect(realSec).toBeGreaterThanOrEqual(88);
    expect(realSec).toBeLessThanOrEqual(92);
  });

  it('terminar la respiración antes entra al motor como acción del usuario', async () => {
    const { ctl, snap, runUntil, start } = setup();
    await start('resolves', 30);
    await runUntil(() => snap().last?.state === 'INTERVENE');
    await ctl.endBreathing();
    expect(snap().last?.state).toBe('RECOVERY');
    expect(snap().speedForced).toBe(false);
    expect(snap().episode?.breathingEndedEarly).toBe(true);
    expect(snap().episode?.events.at(-1)).toMatchObject({ kind: 'intervention_end', actor: 'user' });
  });
});

describe('episodio que escala', () => {
  it('pausa el reloj, cuenta hacia atrás y se puede cancelar', async () => {
    const { ctl, sched, snap, opened, runUntil, start } = setup();
    await start('escalates', 30);
    await runUntil(() => snap().escalation !== null);
    expect(snap().last?.state).toBe('ESCALATE');
    const t0 = ctl.recordNow();
    const nHist = snap().history.length;
    sched.advance(10_000);
    await ctl.idle();
    expect(ctl.recordNow()).toBe(t0); // reloj de registro pausado
    expect(snap().history.length).toBe(nHist); // el motor no recibió ventanas
    expect(snap().escalation?.remainingSec).toBe(20);
    expect(snap().escalation?.contactName).toBe('Vane');

    await ctl.cancelEscalation();
    expect(snap().escalation).toBeNull();
    expect(snap().last?.state).toBe('IDLE');
    expect(opened).toEqual([]); // nada se abrió
    const ep = snap().lastClosed!;
    expect(ep.outcome).toBe('escalated');
    expect(ep.escalation).toBe('cancelled');
    expect(snap().pendingLabels).toContain(ep.id);

    // el reloj sigue y la sesión continúa
    sched.advance(3000);
    await ctl.idle();
    expect(ctl.recordNow()).toBeGreaterThan(t0);
  });

  it('al terminar la cuenta abre un mensaje neutro (el usuario lo envía)', async () => {
    const { snap, sched, opened, runUntil, settle, start } = setup();
    await start('escalates', 30);
    await runUntil(() => snap().escalation !== null);
    sched.advance(31_000);
    await settle();
    expect(opened).toHaveLength(1);
    const url = new URL(opened[0]!);
    expect(url.origin).toBe('https://wa.me');
    expect(url.pathname).toBe('/593991234567');
    const text = url.searchParams.get('text')!;
    expect(text).toBe('Hola, soy Pancho. Activé Kairos, ¿me puedes escribir o llamar cuando puedas?');
    expect(text).not.toMatch(/\d{2,}|pulso|score|activación (alta|sostenida)/i);
    expect(snap().escalation).toBeNull();
    expect(snap().lastClosed?.escalation).toBe('opened');
  });

  it('si el navegador bloquea la apertura, espera un toque del usuario', async () => {
    let allow = false;
    const { snap, sched, ctl, opened, runUntil, start } = setup({ open: () => allow });
    await start('escalates', 30);
    await runUntil(() => snap().escalation !== null);
    sched.advance(31_000);
    await ctl.idle();
    expect(snap().escalation?.blocked).toBe(true);
    expect(snap().last?.state).toBe('ESCALATE');
    allow = true;
    await ctl.openEscalationNow();
    expect(opened).toHaveLength(2);
    expect(snap().escalation).toBeNull();
    expect(snap().lastClosed?.escalation).toBe('opened');
  });

  it('sin contacto configurado no hay enlace, y se puede cancelar', async () => {
    const { snap, sched, ctl, opened, runUntil, start } = setup({ contact: null });
    await start('escalates', 30);
    await runUntil(() => snap().escalation !== null);
    expect(snap().escalation?.url).toBeNull();
    sched.advance(31_000);
    await ctl.idle();
    expect(opened).toEqual([]);
    expect(snap().escalation?.blocked).toBe(true);
    await ctl.cancelEscalation();
    expect(snap().last?.state).toBe('IDLE');
  });
});

describe('etiquetas y marcas', () => {
  it('etiquetar un episodio lo guarda y lo saca de la cola', async () => {
    const { ctl, snap, runUntil, start } = setup();
    await start('resolves', 30);
    await runUntil(() => snap().pendingLabels.length > 0);
    const id = snap().pendingLabels[0]!;
    await ctl.labelEpisode(id, { activity: 'exam', felt: 'yes', labeledAt: '2026-10-02T00:00:00Z' });
    expect(snap().pendingLabels).not.toContain(id);
    expect((await db.episodes.get(id))?.label?.activity).toBe('exam');
    expect((await db.episodes.get(id))?.needsLabel).toBe(false);
  });

  it('marcar un momento a mano guarda t y estado', async () => {
    const { ctl, runUntil, snap, start } = setup();
    await start('resolves', 30);
    await runUntil(() => snap().history.length > 10);
    const m = await ctl.markMoment({ activity: 'other', activityOther: 'café con amigos', felt: 'unsure', labeledAt: 'x' });
    expect(m?.t).toBeGreaterThan(0);
    expect(await db.marks.count()).toBe(1);
  });
});

it('el motor nunca recibe la etiqueta de evaluación', async () => {
  const spy = vi.spyOn(KairosEngine.prototype, 'step');
  const { snap, runUntil, start } = setup();
  await start('resolves', 30);
  await runUntil(() => snap().history.length > 30);
  expect(spy).toHaveBeenCalled();
  for (const [, feats] of spy.mock.calls) {
    expect(feats).not.toHaveProperty('label');
    expect(Object.keys(feats).sort()).toEqual(
      ['acc_move_std', 'eda_scl_mean', 'eda_scl_slope', 'eda_scr_count', 'hr_mean', 'pnn50', 'rmssd', 'sdnn', 'temp_mean', 'temp_slope'],
    );
  }
});

it('borrar todo deja la base vacía', async () => {
  const { snap, runUntil, start, ctl } = setup();
  await start('resolves', 30);
  await runUntil(() => snap().status === 'ended');
  expect(await db.episodes.count()).toBeGreaterThan(0);
  await ctl.stop();
  await deleteAll();
  expect(await db.episodes.count()).toBe(0);
  expect(await db.sessions.count()).toBe(0);
});
