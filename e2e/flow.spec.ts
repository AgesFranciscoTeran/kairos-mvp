// Flujo completo a velocidad acelerada, con reloj falso para no esperar los 90 s reales.
import { expect, test } from '@playwright/test';
import { advanceUntil, label, liveState, nav, onboard, startSynthetic, visible, watchNetwork } from './helpers';

test.beforeEach(async ({ page }) => {
  await page.clock.install();
  // window.open queda registrado, no navega
  await page.addInitScript(() => {
    (window as unknown as { __opened: string[] }).__opened = [];
    window.open = ((url: string) => {
      (window as unknown as { __opened: string[] }).__opened.push(url);
      return { opener: null } as Window;
    }) as typeof window.open;
  });
});

test('episodio sintético: WATCH → INTERVENE → RECOVERY → resuelto, etiquetado e historial', async ({ page }) => {
  const net = watchNetwork(page);
  await onboard(page);
  await startSynthetic(page, 'resolves');

  const seen: string[] = [];
  const track = async () => {
    const s = (await liveState(page).textContent())?.trim() ?? '';
    if (s && seen[seen.length - 1] !== s) seen.push(s);
  };

  await advanceUntil(page, visible(page, 'Notamos activación'), 300, track);
  await expect(page.getByText('Lo que vemos, comparado con tu reposo:')).toBeVisible();

  await advanceUntil(page, visible(page, 'Respira conmigo'), 300, track);
  await expect(page.getByText('1× durante la respiración')).toBeVisible();
  // la evidencia se nombra antes de la propuesta
  const card = page.locator('.card.gold', { hasText: 'Respira conmigo' });
  const text = (await card.innerText()).replace(/\s+/g, ' ');
  expect(text.indexOf('Lo que vemos')).toBeLessThan(text.indexOf('Te proponemos respirar'));

  // la respiración dura 90 s de reloj real
  const secs = await advanceUntil(page, visible(page, 'Midiendo tu recuperación'), 200, track);
  expect(secs).toBeGreaterThanOrEqual(86);
  expect(secs).toBeLessThanOrEqual(95);

  await advanceUntil(page, async () => (await page.getByRole('dialog').count()) > 0, 400, track);
  await expect(page.getByRole('dialog')).toContainText('La activación cedió');
  await label(page, 'Examen', 'Sí');

  expect(seen).toEqual(expect.arrayContaining(['Calibrando', 'En reposo', 'Observando', 'Respiración', 'Recuperación']));
  expect(seen.indexOf('Observando')).toBeLessThan(seen.indexOf('Respiración'));
  expect(seen.indexOf('Respiración')).toBeLessThan(seen.indexOf('Recuperación'));

  await page.getByRole('button', { name: 'Terminar sesión' }).click();
  await nav(page, 'Historial');
  const ep = page.locator('.episode').first();
  await expect(ep).toContainText('Cedió tras respirar');
  await expect(ep).toContainText('TTB');
  await expect(ep).toContainText('Examen');
  await expect(ep).toContainText('Demo');

  expect(net.external).toEqual([]);
  expect(net.nonGet).toEqual([]);
});

test('escalamiento: cuenta regresiva cancelable, no se abre nada', async ({ page }) => {
  const net = watchNetwork(page);
  await onboard(page, { countdownSec: 20 });
  await startSynthetic(page, 'escalates');

  await advanceUntil(page, visible(page, 'Respira conmigo'), 300);
  await page.getByRole('button', { name: 'Terminar antes' }).click();
  await advanceUntil(page, visible(page, 'La activación no cedió'), 400);

  const alert = page.getByRole('alertdialog');
  await expect(alert).toContainText('Abriremos un mensaje para Vane');
  await expect(alert).toContainText('Hola, soy Pancho. Activé Kairos, ¿me puedes escribir o llamar cuando puedas?');
  await expect(alert.getByRole('button', { name: 'Cancelar' })).toBeFocused();

  // la cuenta corre en reloj real; el registro está pausado
  // el cronómetro en pantalla se refresca a 2 Hz: se lee cuando ya muestra el valor pausado
  await page.clock.runFor(1000);
  const t0 = await page.getByLabel('Tiempo de registro').textContent();
  await page.clock.runFor(4000);
  await expect(alert).toContainText('Se abre en 15 s');
  await page.waitForTimeout(600);
  expect(await page.getByLabel('Tiempo de registro').textContent()).toBe(t0);

  await alert.getByRole('button', { name: 'Cancelar' }).click();
  await expect(alert).toBeHidden();
  await expect(page.getByRole('dialog')).toContainText('Escalamiento cancelado');
  await label(page, 'Conversación difícil', 'No sé');

  // pasado el plazo original, sigue sin abrirse nada
  await page.clock.runFor(30_000);
  expect(await page.evaluate(() => (window as unknown as { __opened: string[] }).__opened)).toEqual([]);

  // la sesión siguió: otro episodio pudo cerrarse y pedir etiqueta
  if (await page.getByRole('dialog').count()) await page.getByRole('button', { name: 'Ahora no' }).click();
  await page.getByRole('button', { name: 'Terminar sesión' }).click();
  await nav(page, 'Historial');
  const esc = page.locator('.episode', { hasText: 'Escalado' });
  await expect(esc).toHaveCount(1);
  await expect(esc).toContainText('cancelado');
  await expect(esc).toContainText('Conversación difícil');
  expect(net.external).toEqual([]);
});

test('escalamiento: al terminar la cuenta se abre un mensaje prellenado (el usuario lo envía)', async ({ page }) => {
  await onboard(page, { countdownSec: 10 });
  await startSynthetic(page, 'escalates');
  await advanceUntil(page, visible(page, 'Respira conmigo'), 300);
  await page.getByRole('button', { name: 'Terminar antes' }).click();
  await advanceUntil(page, visible(page, 'La activación no cedió'), 400);
  await page.clock.runFor(11_000);
  await expect(page.getByRole('dialog')).toContainText('Mensaje abierto');
  const opened = await page.evaluate(() => (window as unknown as { __opened: string[] }).__opened);
  expect(opened).toHaveLength(1);
  const url = new URL(opened[0]!);
  expect(url.origin).toBe('https://wa.me');
  expect(url.searchParams.get('text')).toBe('Hola, soy Pancho. Activé Kairos, ¿me puedes escribir o llamar cuando puedas?');
});

test('híbrido: sacudir el teléfono bloquea la interpretación y se ve en pantalla', async ({ page }) => {
  await onboard(page, { contact: false });
  await page.getByLabel('Híbrida: registro + movimiento').check();
  await page.getByLabel('Simulado (para escritorio)').check();
  await startSynthetic(page, 'escalates');
  await advanceUntil(page, visible(page, 'Activación respecto a tu reposo'), 120);
  await expect(page.getByText('Bloqueado por movimiento')).toHaveCount(0);

  await page.getByRole('button', { name: 'Sacudir' }).click();
  await advanceUntil(page, visible(page, 'Bloqueado por movimiento'), 10);
  await expect(page.getByText('Hay movimiento: la fisiología no se interpreta ahora.')).toBeVisible();
  await expect(page.getByRole('meter', { name: 'Movimiento ahora' })).toHaveAttribute('aria-valuetext', 'Vigoroso');

  // mientras se sacude, el episodio de activación no llega a intervenir
  await advanceUntil(page, async () => (await page.getByLabel('Tiempo de registro').textContent())!.startsWith('25:'), 120);
  await expect(page.getByText('Respira conmigo')).toHaveCount(0);

  await page.getByRole('button', { name: 'Quieto' }).click();
  await advanceUntil(page, async () => (await page.getByText('Bloqueado por movimiento').count()) === 0, 20);
});

test('terminar la respiración antes pasa a recuperación', async ({ page }) => {
  await onboard(page, { contact: false });
  await startSynthetic(page, 'resolves');
  await advanceUntil(page, visible(page, 'Respira conmigo'), 300);
  await page.clock.runFor(10_000);
  await page.getByRole('button', { name: 'Terminar antes' }).click();
  await expect(page.getByText('Midiendo tu recuperación')).toBeVisible();
  await expect(page.getByText('1× durante la respiración')).toHaveCount(0);
});
