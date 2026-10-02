import { useEffect, useMemo, useState } from 'react';
import { SessionController } from './session/controller';
import { WorkerEngineClient } from './session/engineClient';
import type { SimulatedMotionProvider } from './sources/motion';
import { loadProfile, saveProfile, type Profile } from './store/db';
import { Logo } from './ui/components/Logo';
import { WatchFace } from './ui/components/WatchFace';
import { AppContext, HREF, useRoute, type Route } from './ui/hooks';
import { History } from './ui/screens/History';
import { Metrics } from './ui/screens/Metrics';
import { Onboarding } from './ui/screens/Onboarding';
import { SessionScreen } from './ui/screens/SessionScreen';
import { Settings } from './ui/screens/Settings';
import { S } from './ui/strings';

const NAV: [Route, string][] = [
  ['session', S.nav.session],
  ['history', S.nav.history],
  ['metrics', S.nav.metrics],
  ['settings', S.nav.settings],
  ['watch', S.nav.watch],
];

export function App() {
  const controller = useMemo(() => new SessionController({ engineFactory: (cfg) => new WorkerEngineClient(cfg) }), []);
  const [profile, setProfileState] = useState<Profile | null>(null);
  const [simMotion, setSimMotion] = useState<SimulatedMotionProvider | null>(null);
  const route = useRoute();

  useEffect(() => {
    void loadProfile().then(setProfileState);
  }, []);

  // el foco va al contenido al cambiar de pantalla
  useEffect(() => {
    document.getElementById('main')?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }, [route]);

  if (!profile) return null;

  const setProfile = async (p: Profile) => {
    await saveProfile(p);
    setProfileState(p);
  };
  const ctx = { controller, profile, setProfile, simMotion, setSimMotion };

  const effective: Route = !profile.onboarded ? 'onboarding' : route;
  const screen = {
    onboarding: <Onboarding />,
    session: <SessionScreen />,
    history: <History />,
    metrics: <Metrics />,
    settings: <Settings />,
    watch: (
      <div className="watch-page">
        <WatchFace />
      </div>
    ),
  }[effective];

  const showWatchColumn = effective === 'session';

  return (
    <AppContext.Provider value={ctx}>
      <a className="skip-link" href="#main">
        {S.nav.skip}
      </a>
      <div className="app">
        <header className="topbar">
          <a className="wordmark" href={HREF.session} aria-label={S.appName}>
            <Logo />
            KAIROS
          </a>
          {profile.onboarded && (
            <nav aria-label="Principal">
              <div className="nav">
                {NAV.map(([r, label]) => (
                  <a key={r} href={HREF[r]} aria-current={effective === r ? 'page' : undefined}>
                    {label}
                  </a>
                ))}
              </div>
            </nav>
          )}
        </header>
        <div className={`layout ${showWatchColumn ? 'with-watch' : ''}`}>
          <main id="main" className="phone" tabIndex={-1}>
            {screen}
          </main>
          {showWatchColumn && (
            <aside className="watch-col" aria-label={S.watch.title}>
              <WatchFace />
            </aside>
          )}
        </div>
      </div>
    </AppContext.Provider>
  );
}
