import { describe, expect, it } from 'vitest';
import { escalationUrl, normalizePhone, renderMessage } from '../session/escalation';
import { topEvidence } from './evidence';
import { S } from './strings';

/** Todos los textos de la UI, aplanados (incluye las funciones evaluadas con argumentos de ejemplo). */
function allStrings(obj: unknown): string[] {
  if (typeof obj === 'string') return [obj];
  if (typeof obj === 'function') {
    const args = [1, 2, 3].map(String);
    try {
      return allStrings((obj as (...a: unknown[]) => unknown)(...args.map((a, i) => (i === 0 ? 3 : a))));
    } catch {
      return [];
    }
  }
  if (Array.isArray(obj)) return obj.flatMap(allStrings);
  if (obj && typeof obj === 'object') return Object.values(obj).flatMap(allStrings);
  return [];
}

describe('vocabulario', () => {
  const texts = allStrings(S);
  // ni "estrés", ni "ansiedad", ni "crisis", ni nombres de emociones
  const FORBIDDEN =
    /\b(estr[eé]s|estresad[oa]s?|ansiedad|ansios[oa]s?|crisis|p[aá]nico|emoci[oó]n(es|al)?|miedo|tristeza|triste|enojo|enojad[oa]|ira|rabia|alegr[ií]a|feliz|angustia|nervios[oa]?s?|preocupaci[oó]n|frustraci[oó]n|depresi[oó]n)\b/i;

  it('hay textos que revisar', () => {
    expect(texts.length).toBeGreaterThan(150);
  });

  it('ningún texto usa palabras prohibidas, salvo para decir que no se detectan emociones', () => {
    const offenders = texts.filter((t) => FORBIDDEN.test(t) && t !== 'No detecta emociones ni dice lo que sientes.');
    expect(offenders).toEqual([]);
  });

  it('el mensaje por defecto al contacto es neutro y sin datos fisiológicos', () => {
    const msg = renderMessage(S.defaultMessage, 'Ana');
    expect(msg).toBe('Hola, soy Ana. Activé Kairos, ¿me puedes escribir o llamar cuando puedas?');
    expect(msg).not.toMatch(/pulso|variabilidad|piel|score|activación|\d/i);
  });
});

describe('enlace de escalamiento', () => {
  it.each([
    ['0991234567', '593991234567'],
    ['+593 99 123 4567', '593991234567'],
    ['593991234567', '593991234567'],
    ['00593991234567', '593991234567'],
    ['+1 (415) 555-0100', '14155550100'],
    ['12', null],
    ['', null],
  ])('normaliza %s', (raw, expected) => {
    expect(normalizePhone(raw)).toBe(expected);
  });

  it('arma wa.me y sms: con el texto codificado', () => {
    const msg = renderMessage('Hola, soy {nombre}. ¿Me escribes?', 'José');
    expect(escalationUrl({ name: 'A', phone: '0991234567', channel: 'whatsapp' }, msg)).toBe(
      'https://wa.me/593991234567?text=Hola%2C%20soy%20Jos%C3%A9.%20%C2%BFMe%20escribes%3F',
    );
    expect(escalationUrl({ name: 'A', phone: '0991234567', channel: 'sms' }, msg)).toMatch(
      /^sms:\+593991234567\?&body=Hola%2C/,
    );
    expect(escalationUrl({ name: 'A', phone: 'x', channel: 'sms' }, msg)).toBeNull();
  });

  it('un nombre vacío no deja el marcador a la vista', () => {
    expect(renderMessage('Hola, soy {nombre}.', '  ')).toBe('Hola, soy yo.');
  });
});

describe('evidencia', () => {
  it('ordena por aporte en la dirección de la activación y la dice en lenguaje llano', () => {
    const ev = topEvidence({ hr_mean: 1.2, rmssd: -2.5, eda_scl_mean: 0.8, temp_mean: 0.9, sdnn: 0.3 });
    expect(ev.map((e) => e.key)).toEqual(['rmssd', 'hr_mean', 'eda_scl_mean']);
    expect(ev[0]!.text).toBe('Tu variabilidad cardiaca está bastante más baja que en tu reposo');
    expect(ev[1]!.text).toBe('Tu pulso está más alto que en tu reposo');
  });

  it('no nombra señales que van en contra de la activación ni aportes mínimos', () => {
    expect(topEvidence({ hr_mean: -2, rmssd: 2, eda_scl_mean: 0.1 })).toEqual([]);
  });
});
