import { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import type { SessionController, SessionSnapshot } from '../session/controller';
import type { SimulatedMotionProvider } from '../sources/motion';
import type { Profile } from '../store/db';

export interface AppContextValue {
  controller: SessionController;
  profile: Profile;
  setProfile: (p: Profile) => Promise<void>;
  /** proveedor simulado de la sesión en curso, si lo hay (para los botones de demo) */
  simMotion: SimulatedMotionProvider | null;
  setSimMotion: (p: SimulatedMotionProvider | null) => void;
}

export const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const v = useContext(AppContext);
  if (!v) throw new Error('AppContext ausente');
  return v;
}

export function useSession(): SessionSnapshot {
  const { controller } = useApp();
  return useSyncExternalStore(controller.subscribe, controller.getSnapshot);
}

/** Tiempo de registro, refrescado varias veces por segundo (cronómetros de la UI). */
export function useRecordNow(active = true, hz = 4): number {
  const { controller } = useApp();
  const [t, setT] = useState(() => controller.recordNow());
  useEffect(() => {
    if (!active) return;
    const h = setInterval(() => setT(controller.recordNow()), 1000 / hz);
    return () => clearInterval(h);
  }, [controller, active, hz]);
  return t;
}

/** Fotograma a fotograma (para la animación de respiración). */
export function useAnimationClock(active: boolean): number {
  const { controller } = useApp();
  const [t, setT] = useState(() => controller.recordNow());
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    const loop = () => {
      setT(controller.recordNow());
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [controller, active]);
  return t;
}

export function useReducedMotion(): boolean {
  const query = '(prefers-reduced-motion: reduce)';
  const [reduced, setReduced] = useState(() => globalThis.matchMedia?.(query).matches ?? false);
  useEffect(() => {
    const mq = globalThis.matchMedia?.(query);
    if (!mq) return;
    const on = () => setReduced(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return reduced;
}

export type Route = 'session' | 'history' | 'metrics' | 'settings' | 'watch' | 'onboarding';
const ROUTES: Record<string, Route> = {
  '': 'session',
  '#/': 'session',
  '#/historial': 'history',
  '#/metricas': 'metrics',
  '#/ajustes': 'settings',
  '#/reloj': 'watch',
  '#/bienvenida': 'onboarding',
};
export const HREF: Record<Route, string> = {
  session: '#/',
  history: '#/historial',
  metrics: '#/metricas',
  settings: '#/ajustes',
  watch: '#/reloj',
  onboarding: '#/bienvenida',
};

export function useRoute(): Route {
  const read = () => ROUTES[location.hash] ?? 'session';
  const [route, setRoute] = useState<Route>(read);
  useEffect(() => {
    const on = () => setRoute(read());
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return route;
}
