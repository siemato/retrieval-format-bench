export function mean(values: number[]): number {
  if (values.length === 0) return NaN;
  let s = 0;
  for (const v of values) s += v;
  return s / values.length;
}

export function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const xs = [...values].sort((a, b) => a - b);
  const mid = Math.floor(xs.length / 2);
  if (xs.length % 2 === 0) return (xs[mid - 1] + xs[mid]) / 2;
  return xs[mid];
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return NaN;
  if (p <= 0) return Math.min(...values);
  if (p >= 100) return Math.max(...values);
  const xs = [...values].sort((a, b) => a - b);
  const idx = (p / 100) * (xs.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return xs[lo];
  const w = idx - lo;
  return xs[lo] * (1 - w) + xs[hi] * w;
}
