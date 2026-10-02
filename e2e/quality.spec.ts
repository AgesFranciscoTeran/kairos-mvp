// Privacidad, accesibilidad, movimiento reducido, offline y vocabulario.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { advanceUntil, label, nav, onboard, ORIGIN, startSynthetic, visible } from './helpers';

const FORBIDDEN = /\b(estr[eé]s|ansiedad|crisis|p[aá]nico|miedo|tristeza|enojo|ira|rabia|alegr[ií]a|angustia|nervios[oa]?)\b/i;

async function audit(page: Page, where: string) {
  const res = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const bad = res.violations.map((v) => `${where}: ${v.id} (${v.impact}) ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`);
  expect(bad, bad.join('\n')).toEqual([]);
  const text = await page.locator('body').innerText();
  const hits = text
    .split('\n')
    .filter((l) => FORBIDDEN.test(l));
  expect(hits, `${where}: vocabulario`).toEqual([]);
}

test('cero requests con datos del usuario: nada sale del origen y solo hay GET de archivos estáticos', async ({ page, context }) => {
  const external: string[] = [];
  const own: string[] = [];
  // toda request fuera del origen se registra y se aborta
  await context.route('**/*', (route) => {
    const req = route.request();
    const u = new URL(req.url());
    if (u.origin !== ORIGIN) {
      external.push(`${req.method()} ${req.url()}`);
      return route.abort();
    }
    own.push(`${req.method()} ${u.pathname}${u.search}`);
    return route.continue();
  });
  await page.clock.install();
  await page.addInitScript(() => {
    window.open = (() => ({ opener: null }) as Window) as typeof window.open;
  });

  await onboard(page, { countdownSec: 5 });
  // ciclo completo con escalamiento abierto, etiquetado y marca manual
  await startSynthetic(page, 'escalates');
  await advanceUntil(page, visible(page, 'Respira conmigo'), 300);
  await page.getByRole('button', { name: 'Terminar antes' }).click();
  await advanceUntil(page, visible(page, 'La activación no cedió'), 400);
  await page.clock.runFor(6000);
  await label(page, 'Estudiando', 'Sí');
  await page.getByRole('button', { name: 'Marcar este momento' }).click();
  await label(page, 'Cafeína', 'No');
  await page.getByRole('button', { name: 'Terminar sesión' }).click();
  // todas las pantallas y la exportación
  for (const s of ['Historial', 'Métricas', 'Ajustes', 'Vista reloj']) await nav(page, s);
  await nav(page, 'Ajustes');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar a JSON' }).click();
  const file = await download;
  const exported = JSON.parse(await (await import('node:fs/promises')).readFile((await file.path())!, 'utf-8'));
  expect(exported.format).toBe('kairos-mvp-export');
  expect(exported.episodes.length).toBeGreaterThan(0);

  expect(external).toEqual([]);
  expect(own.filter((r) => !r.startsWith('GET '))).toEqual([]);
  // ningún GET lleva parámetros (por ahí podría filtrarse algo)
  expect(own.filter((r) => r.includes('?'))).toEqual([]);
  // y todos piden archivos del build
  for (const r of own) expect(r).toMatch(/^GET \/(|index\.html|assets\/.+|registerSW\.js|manifest\.webmanifest|favicon\.svg|[\w-]+\.png|sw\.js|workbox-[\w]+\.js)$/);
});

test('la CSP impide requests a otros orígenes aunque el código lo intentara', async ({ page }) => {
  await page.goto('./');
  const blocked = await page.evaluate(async () => {
    try {
      await fetch('https://example.com/');
      return false;
    } catch {
      return true;
    }
  });
  expect(blocked).toBe(true);
});

test('accesibilidad (axe, WCAG 2.1 AA) y vocabulario en todas las pantallas', async ({ page }) => {
  await page.clock.install();
  await page.addInitScript(() => {
    window.open = (() => null) as typeof window.open; // fuerza el caso "bloqueado"
  });
  await page.goto('./');
  await audit(page, 'bienvenida 1');
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await audit(page, 'bienvenida 2');
  await page.getByRole('button', { name: 'Entiendo' }).click();
  await audit(page, 'bienvenida 3');
  await page.getByLabel('Tu nombre (para el mensaje)').fill('Pancho');
  await page.getByLabel('Nombre del contacto').fill('Vane');
  await page.getByLabel('Teléfono del contacto').fill('0991234567');
  await page.getByRole('button', { name: 'Empezar' }).click();
  await expect(page.getByRole('button', { name: 'Iniciar sesión' })).toBeVisible();
  await audit(page, 'configuración de sesión');

  await startSynthetic(page, 'escalates');
  await advanceUntil(page, visible(page, 'Aprendiendo tu reposo'), 20);
  await audit(page, 'warmup');
  await advanceUntil(page, visible(page, 'Notamos activación'), 300);
  await audit(page, 'detección');
  await advanceUntil(page, visible(page, 'Respira conmigo'), 300);
  await audit(page, 'respiración');
  await page.clock.runFor(5000);
  await page.getByRole('button', { name: 'Terminar antes' }).click();
  await audit(page, 'recuperación');
  await advanceUntil(page, visible(page, 'La activación no cedió'), 400);
  await audit(page, 'escalamiento');
  await page.clock.runFor(31_000);
  await expect(page.getByText('El navegador no abrió el mensaje automáticamente.')).toBeVisible();
  await audit(page, 'escalamiento bloqueado');
  await page.getByRole('button', { name: 'Cancelar' }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await audit(page, 'etiquetado');
  await page.getByRole('button', { name: 'Ahora no' }).click();
  await page.getByRole('button', { name: 'Terminar sesión' }).click();
  await nav(page, 'Historial');
  await audit(page, 'historial');
  await nav(page, 'Métricas');
  await audit(page, 'métricas');
  await nav(page, 'Ajustes');
  await audit(page, 'ajustes');
  await nav(page, 'Vista reloj');
  await audit(page, 'vista reloj');
});

test('con prefers-reduced-motion la respiración no anima el tamaño', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.clock.install();
  await onboard(page, { contact: false });
  await startSynthetic(page, 'resolves');
  await advanceUntil(page, visible(page, 'Respira conmigo'), 300);
  const core = page.locator('main .breath-core');
  const scales = new Set<string>();
  for (let i = 0; i < 8; i++) {
    scales.add(await core.evaluate((el) => (el as HTMLElement).style.transform));
    await page.clock.runFor(700);
  }
  expect([...scales]).toEqual(['scale(1)']);
  // la fase sigue anunciándose para lector de pantalla
  await expect(page.locator('main .breath p[aria-live="polite"]')).toHaveText(/Inhala|Exhala/);
});

test('sin prefers-reduced-motion la respiración sí se expande y contrae', async ({ page }) => {
  await page.clock.install();
  await onboard(page, { contact: false });
  await startSynthetic(page, 'resolves');
  await advanceUntil(page, visible(page, 'Respira conmigo'), 300);
  const core = page.locator('main .breath-core');
  const scales = new Set<string>();
  for (let i = 0; i < 8; i++) {
    scales.add(await core.evaluate((el) => (el as HTMLElement).style.transform));
    await page.clock.runFor(700);
  }
  expect(scales.size).toBeGreaterThan(3);
});

test.describe('PWA', () => {
  test.use({ serviceWorkers: 'allow' });
  test('instalable y funciona sin conexión tras la primera visita', async ({ page, context }) => {
    await page.goto('./');
    const manifest = await page.evaluate(async () => (await fetch('./manifest.webmanifest')).json());
    expect(manifest.display).toBe('standalone');
    expect(manifest.icons.map((i: { sizes: string }) => i.sizes)).toContain('512x512');
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    await context.setOffline(true);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Qué es Kairos' })).toBeVisible();
    // el demo sintético corre offline
    await page.getByRole('button', { name: 'Siguiente' }).click();
    await page.getByRole('button', { name: 'Entiendo' }).click();
    await page.getByRole('button', { name: 'Configurar después' }).click();
    await page.getByRole('button', { name: 'Iniciar sesión' }).click();
    await expect(page.getByText('Aprendiendo tu reposo')).toBeVisible();
    await context.setOffline(false);
  });
});

test('borrar todos los datos vacía el historial y vuelve a la bienvenida', async ({ page }) => {
  await page.clock.install();
  await onboard(page);
  await startSynthetic(page, 'resolves');
  await advanceUntil(page, visible(page, 'Respira conmigo'), 300);
  await page.getByRole('button', { name: 'Terminar sesión' }).click();
  await nav(page, 'Ajustes');
  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'Borrar todos mis datos' }).click();
  await expect(page.getByRole('heading', { name: 'Qué es Kairos' })).toBeVisible();
  const counts = await page.evaluate(
    () =>
      new Promise<number[]>((resolve) => {
        const req = indexedDB.open('kairos');
        req.onsuccess = () => {
          const db = req.result;
          const names = ['episodes', 'sessions', 'marks', 'settings'].filter((n) => db.objectStoreNames.contains(n));
          if (!names.length) return resolve([]);
          const tx = db.transaction(names, 'readonly');
          Promise.all(names.map((n) => new Promise<number>((r) => { const c = tx.objectStore(n).count(); c.onsuccess = () => r(c.result); }))).then(resolve);
        };
      }),
  );
  expect(counts.every((c) => c === 0)).toBe(true);
});
