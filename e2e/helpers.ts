import { expect, type Page } from '@playwright/test';

/** Bienvenida completa, con o sin contacto de confianza. */
export async function onboard(page: Page, opts: { contact?: boolean; countdownSec?: number } = {}) {
  await page.goto('./');
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await page.getByRole('button', { name: 'Entiendo' }).click();
  if (opts.contact === false) {
    await page.getByRole('button', { name: 'Configurar después' }).click();
  } else {
    await page.getByLabel('Tu nombre (para el mensaje)').fill('Pancho');
    await page.getByLabel('Nombre del contacto').fill('Vane');
    await page.getByLabel('Teléfono del contacto').fill('0991234567');
    await page.getByRole('button', { name: 'Empezar' }).click();
  }
  await expect(page.getByRole('button', { name: 'Iniciar sesión' })).toBeVisible();
  if (opts.countdownSec) {
    await nav(page, 'Ajustes');
    await page.getByLabel('Cuenta regresiva del escalamiento (s)').fill(String(opts.countdownSec));
    await page.getByRole('button', { name: 'Guardar', exact: true }).click();
    await expect(page.getByText('Guardado')).toBeVisible();
    await nav(page, 'Sesión');
  }
}

export function nav(page: Page, name: string) {
  return page.getByRole('navigation').getByRole('link', { name }).click();
}

export async function startSynthetic(page: Page, scenario: 'resolves' | 'escalates' | 'exercise' | 'canonical') {
  await page.getByLabel('Registro', { exact: true }).selectOption(scenario);
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
}

/** Texto del estado que se anuncia al lector de pantalla (región aria-live). */
export function liveState(page: Page) {
  return page.locator('section[aria-label="Sesión"] > p[aria-live="polite"]');
}

/**
 * Avanza el reloj falso de la página de a 1 s, dejando que el worker responda entre pasos,
 * hasta que `until` se cumpla. Requiere page.clock.install() antes de navegar.
 */
export async function advanceUntil(page: Page, until: () => Promise<boolean>, maxSec = 600, onTick?: () => Promise<void>) {
  for (let i = 0; i < maxSec; i++) {
    if (await until()) return i;
    await page.clock.runFor(1000);
    await page.waitForTimeout(15);
    await onTick?.();
  }
  throw new Error('la condición no se cumplió a tiempo');
}

export const visible = (page: Page, text: string | RegExp) => async () =>
  (await page.getByText(text).count()) > 0 && (await page.getByText(text).first().isVisible());

/** Respuestas del diálogo de etiquetado. */
export async function label(page: Page, activity: string, felt: 'Sí' | 'No' | 'No sé') {
  const dlg = page.getByRole('dialog');
  await expect(dlg).toBeVisible();
  await dlg.getByRole('button', { name: activity }).click();
  await dlg.getByRole('button', { name: felt, exact: true }).click();
  await dlg.getByRole('button', { name: 'Guardar' }).click();
  await expect(dlg).toBeHidden();
}

/** Registra toda request que salga del origen de la app. */
export const ORIGIN = 'http://localhost:4174';

export function watchNetwork(page: Page) {
  const origin = ORIGIN;
  const external: string[] = [];
  const nonGet: string[] = [];
  page.context().on('request', (r) => {
    const u = new URL(r.url());
    if (u.protocol === 'data:' || u.protocol === 'blob:') return;
    if (u.origin !== origin) external.push(r.url());
    else if (r.method() !== 'GET') nonGet.push(`${r.method()} ${r.url()}`);
  });
  return { external, nonGet };
}
