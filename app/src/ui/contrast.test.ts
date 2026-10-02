// Contraste AA de los pares texto/fondo de la UI. axe no puede evaluarlo sobre los fondos
// en degradado (lo marca "incompleto"), así que se verifica aquí contra los tokens.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(import.meta.dirname, '..', 'styles.css'), 'utf-8');
const token = (name: string) => {
  const m = css.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, 'i'));
  if (!m) throw new Error(`token --${name} no encontrado`);
  return m[1]!;
};

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
export function contrast(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1! + 0.05) / (l2! + 0.05);
}

// fondos reales: tokens + los extremos de los degradados de styles.css
const BG = {
  deep: token('deep'),
  ink: token('ink'),
  card: token('card'),
  cardBottom: '#0d1d16',
  jade: token('jade'),
  gradientTop: '#10261b',
  screen: token('screen'),
  alert: '#2a0f15',
  alertBottom: '#160a0d',
};
const TEXT = {
  cream: token('cream'),
  sage: token('sage'),
  gold: token('gold'),
  goldDim: token('gold-dim'),
  breath: token('breath'),
  recovery: '#8fd3b0',
  error: '#f08a99',
};

describe('contraste AA (≥ 4,5:1 texto normal)', () => {
  for (const [tn, tc] of Object.entries(TEXT)) {
    for (const [bn, bc] of Object.entries(BG)) {
      it(`${tn} sobre ${bn}`, () => {
        expect(contrast(tc, bc)).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
  it('botón primario: tinta sobre dorado', () => {
    expect(contrast(token('ink'), token('gold'))).toBeGreaterThanOrEqual(4.5);
  });
  it('botón de peligro y badge de aviso: crema sobre carmín', () => {
    expect(contrast(token('cream'), token('carmine'))).toBeGreaterThanOrEqual(4.5);
  });
  it('anillo de foco visible sobre los fondos (≥ 3:1, componentes no textuales)', () => {
    for (const bc of Object.values(BG)) expect(contrast(token('gold'), bc)).toBeGreaterThanOrEqual(3);
  });
});
