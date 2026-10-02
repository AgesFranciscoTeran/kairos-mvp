import { defineConfig, devices } from '@playwright/test';

/**
 * E2E contra el build de producción (vite preview). En Windows con Smart App Control se usa
 * Edge (firmado); en CI o Linux, el Chromium de Playwright: PW_CHANNEL=chromium.
 */
const channel = process.env.PW_CHANNEL ?? 'msedge';
const PORT = 4174;

export default defineConfig({
  testDir: 'e2e',
  timeout: 180_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}/`,
    ...(channel === 'chromium' ? {} : { channel }),
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'movil', use: { ...devices['Pixel 7'], ...(channel === 'chromium' ? {} : { channel }) } },
  ],
  webServer: {
    command: `npm run build -w app && npm run preview -w app -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
