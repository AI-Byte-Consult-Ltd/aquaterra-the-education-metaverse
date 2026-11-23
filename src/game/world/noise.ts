/** Small deterministic noise toolkit for world generation (no dependencies). */

/** mulberry32 — fast seeded PRNG returning [0, 1). */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(seed: number, x: number, y: number) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const smooth = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

/** Value noise in [-1, 1]. */
export function valueNoise(seed: number) {
  return (x: number, y: number) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const tx = smooth(x - xi);
    const ty = smooth(y - yi);
    const a = hash2(seed, xi, yi);
    const b = hash2(seed, xi + 1, yi);
    const c = hash2(seed, xi, yi + 1);
    const d = hash2(seed, xi + 1, yi + 1);
    const top = a + (b - a) * tx;
    const bottom = c + (d - c) * tx;
    return (top + (bottom - top) * ty) * 2 - 1;
  };
}

/** Fractal Brownian motion over value noise, roughly in [-1, 1]. */
export function fbm(seed: number, octaves = 5, lacunarity = 2, gain = 0.5) {
  const layers = Array.from({ length: octaves }, (_, i) => valueNoise(seed + i * 1013));
  let norm = 0;
  for (let i = 0, amp = 1; i < octaves; i++, amp *= gain) norm += amp;
  return (x: number, y: number) => {
    let sum = 0;
    let amp = 1;
    let freq = 1;
    for (const n of layers) {
      sum += amp * n(x * freq, y * freq);
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  };
}

/** Ridged noise in [0, 1]: sharp crests, good for mountain chains. */
export function ridged(seed: number, octaves = 4) {
  const f = fbm(seed, octaves);
  return (x: number, y: number) => 1 - Math.abs(f(x, y));
}

/** Binary min-heap keyed by number, used by Dijkstra / A*. */
export class MinHeap {
  private keys: number[] = [];
  private vals: number[] = [];
  get size() {
    return this.keys.length;
  }
  push(key: number, val: number) {
    const k = this.keys;
    const v = this.vals;
    let i = k.length;
    k.push(key);
    v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p];
      v[i] = v[p];
      i = p;
    }
    k[i] = key;
    v[i] = val;
  }
  /** Returns the value with the smallest key. */
  pop(): number {
    const k = this.keys;
    const v = this.vals;
    const top = v[0];
    const lastK = k.pop()!;
    const lastV = v.pop()!;
    const n = k.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= n) break;
        const r = l + 1;
        const c = r < n && k[r] < k[l] ? r : l;
        if (k[c] >= lastK) break;
        k[i] = k[c];
        v[i] = v[c];
        i = c;
      }
      k[i] = lastK;
      v[i] = lastV;
    }
    return top;
  }
  peekKey() {
    return this.keys[0];
  }
}
