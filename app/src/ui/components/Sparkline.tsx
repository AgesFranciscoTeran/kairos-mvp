import { useEffect, useRef } from 'react';

export interface SparkProps {
  values: (number | null)[];
  /** ventanas bloqueadas: se sombrean */
  gated?: boolean[];
  /** líneas horizontales de referencia (umbrales) */
  thresholds?: { value: number; color: string }[];
  min?: number;
  max?: number;
  color?: string;
  big?: boolean;
  label: string;
}

/** Gráfico mínimo en canvas: sin dependencias, nítido en pantallas de alta densidad. */
export function Sparkline({ values, gated, thresholds = [], min, max, color = '#d9b45b', big, label }: SparkProps) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const dpr = globalThis.devicePixelRatio || 1;
    const w = cv.clientWidth || 300;
    const h = cv.clientHeight || 64;
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const finite = values.filter((v): v is number => v !== null && Number.isFinite(v));
    const extra = thresholds.map((t) => t.value);
    let lo = min ?? Math.min(...finite, ...extra);
    let hi = max ?? Math.max(...finite, ...extra);
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return;
    if (hi - lo < 1e-9) {
      hi += 1;
      lo -= 1;
    }
    const n = Math.max(values.length, 2);
    const x = (i: number) => (i / (n - 1)) * (w - 4) + 2;
    const y = (v: number) => h - 4 - ((Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * (h - 8);

    if (gated) {
      ctx.fillStyle = 'rgba(160,140,94,.18)';
      gated.forEach((g, i) => {
        if (g) ctx.fillRect(x(i) - w / n / 2, 0, w / n, h);
      });
    }
    for (const t of thresholds) {
      ctx.strokeStyle = t.color;
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, y(t.value));
      ctx.lineTo(w, y(t.value));
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    let pen = false;
    values.forEach((v, i) => {
      if (v === null || !Number.isFinite(v)) {
        pen = false;
        return;
      }
      if (pen) ctx.lineTo(x(i), y(v));
      else ctx.moveTo(x(i), y(v));
      pen = true;
    });
    ctx.stroke();
  }, [values, gated, thresholds, min, max, color]);

  return <canvas ref={ref} className={big ? 'spark spark-big' : 'spark'} role="img" aria-label={label} />;
}
