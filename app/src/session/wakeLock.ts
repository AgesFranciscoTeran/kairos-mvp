/**
 * Wake Lock: mantiene la pantalla encendida durante la sesión. Una PWA no monitorea en
 * segundo plano; esto solo evita que la pantalla se apague mientras la app está abierta.
 */
export interface WakeLockPort {
  /** true si se obtuvo; false si el navegador no lo soporta o lo negó */
  request(): Promise<boolean>;
  release(): void;
}

type Sentinel = { release(): Promise<void>; released?: boolean };

export function browserWakeLock(): WakeLockPort {
  let sentinel: Sentinel | null = null;
  let wanted = false;
  const nav = globalThis.navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<Sentinel> } };

  const acquire = async () => {
    if (!nav?.wakeLock) return false;
    try {
      sentinel = await nav.wakeLock.request('screen');
      return true;
    } catch {
      return false;
    }
  };
  // el navegador suelta el bloqueo al ocultar la pestaña: lo pedimos de nuevo al volver
  const onVisible = () => {
    if (wanted && document.visibilityState === 'visible') void acquire();
  };

  return {
    async request() {
      wanted = true;
      if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible);
      return acquire();
    },
    release() {
      wanted = false;
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible);
      void sentinel?.release().catch(() => {});
      sentinel = null;
    },
  };
}

export const noWakeLock: WakeLockPort = {
  request: async () => false,
  release: () => {},
};
