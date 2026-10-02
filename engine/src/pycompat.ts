/**
 * Aritmética con la semántica exacta de CPython (3.12+), para que el port produzca los
 * mismos doubles y los mismos textos que el motor de referencia.
 * Ver docs/ENGINE_DIVERGENCES.md, "Detalles de paridad".
 */

/** `sum()` de floats de CPython ≥ 3.12: suma compensada de Neumaier (cs_add / cs_to_double). */
export function pySum(values: Iterable<number>): number {
  let hi = 0.0;
  let lo = 0.0;
  for (const x of values) {
    const t = hi + x;
    if (Math.abs(hi) >= Math.abs(x)) {
      lo += hi - t + x;
    } else {
      lo += x - t + hi;
    }
    hi = t;
  }
  // igual que cs_to_double: no deja que la compensación vuelva NaN una suma infinita
  if (lo !== 0 && Number.isFinite(lo)) {
    return hi + lo;
  }
  return hi;
}

/**
 * Cadena decimal con `nd` decimales, redondeada como `f"{x:.{nd}f}"` de Python: sobre el
 * valor binario exacto, con empates al par. `toFixed` también usa el valor exacto pero
 * resuelve los empates alejándose de cero; solo difiere en empates exactos.
 */
export function pyFixed(x: number, nd: number): string {
  if (!Number.isFinite(x)) {
    return Number.isNaN(x) ? 'nan' : x > 0 ? 'inf' : '-inf';
  }
  const neg = x < 0 || Object.is(x, -0);
  const ax = Math.abs(x);
  let s = ax.toFixed(nd);
  // Un empate exacto exige que ax tenga a lo sumo nd+1 cifras binarias fraccionarias
  // (ax = k / 2^(nd+1)); en ese caso toFixed(nd+1) es exacto y termina en 5.
  if (Number.isInteger(ax * 2 ** (nd + 1))) {
    const longer = ax.toFixed(nd + 1);
    if (longer.endsWith('5')) {
      const truncated = longer.slice(0, -1).replace(/\.$/, '');
      const lastDigit = Number(truncated.replace('.', '').slice(-1));
      if (lastDigit % 2 === 0) s = truncated;
    }
  }
  return neg ? `-${s}` : s;
}

/** `round(x, nd)` de Python para floats. */
export function pyRound(x: number, nd: number): number {
  if (!Number.isFinite(x)) return x;
  return Number(pyFixed(x, nd));
}

/** Python: `v is None or not math.isfinite(v)` invertido. */
export function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}
