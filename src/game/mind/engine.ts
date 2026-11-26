/*
 * Runs a NICS Language release in the browser (or in Node for tests).
 * There is ONE model: it lives and trains in the NICS lab. The game only reads a numbered
 * release of its weights and computes the same maths as the lab's PyTorch code
 * (src/nics/models/text/model.py): decoder-only transformer, token embedding scaled
 * by sqrt(d), RMSNorm, rotary positions, SwiGLU, no biases, output tied to the embedding.
 * No outside model and no outside library: plain Float32Array maths.
 */

export interface ReleaseConfig {
  vocab_size: number;
  d_model: number;
  n_layers: number;
  n_heads: number;
  max_seq_len: number;
  pos_encoding: "rope" | "learned";
}

export interface TensorEntry {
  name: string;
  shape: number[];
  offset: number; // in elements, inside weights.bin
}

/** manifest.json of a release folder, written by server/mind/export_release.py in the lab. */
export interface ReleaseManifest {
  format: "nics-release-v1";
  model_id: string;
  version: number;
  step: number;
  created_at: string;
  config: ReleaseConfig;
  dtype: "f16" | "f32";
  tensors: TensorEntry[];
  weights_file: string;
  weights_sha256: string;
  tokenizer_file: string;
  tokenizer_sha256: string;
  eval?: Record<string, number | string>;
}

export const ffnHidden = (d: number) => Math.floor((d * 4 * 2) / 3); // SwiGLU(dim, 4.0) in the lab

/** Expected tensors of a config, in the order the exporter writes them. */
export function tensorShapes(c: ReleaseConfig): [string, number[]][] {
  const d = c.d_model;
  const h = ffnHidden(d);
  const out: [string, number[]][] = [["tok_emb.weight", [c.vocab_size, d]]];
  if (c.pos_encoding === "learned") out.push(["pos_emb.weight", [c.max_seq_len, d]]);
  for (let i = 0; i < c.n_layers; i++)
    out.push(
      [`blocks.${i}.norm1.weight`, [d]],
      [`blocks.${i}.attn.qkv.weight`, [3 * d, d]],
      [`blocks.${i}.attn.proj.weight`, [d, d]],
      [`blocks.${i}.norm2.weight`, [d]],
      [`blocks.${i}.ffn.w1.weight`, [h, d]],
      [`blocks.${i}.ffn.w2.weight`, [h, d]],
      [`blocks.${i}.ffn.w3.weight`, [d, h]],
    );
  out.push(["norm_f.weight", [d]]);
  return out;
}

export const paramCount = (c: ReleaseConfig) => tensorShapes(c).reduce((s, [, sh]) => s + sh.reduce((a, b) => a * b, 1), 0);

/** IEEE half -> float. */
export function f16ToF32(src: Uint16Array): Float32Array {
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i++) {
    const h = src[i];
    const s = h & 0x8000 ? -1 : 1;
    const e = (h >> 10) & 0x1f;
    const f = h & 0x3ff;
    out[i] = e === 0 ? s * f * 2 ** -24 : e === 31 ? (f ? NaN : s * Infinity) : s * (1 + f / 1024) * 2 ** (e - 15);
  }
  return out;
}

/** Check the manifest against the architecture and cut weights.bin into tensors. */
export function readWeights(m: ReleaseManifest, bin: ArrayBuffer): Map<string, Float32Array> {
  if (m.format !== "nics-release-v1") throw new Error("format");
  const size = m.dtype === "f16" ? 2 : 4;
  const all = m.dtype === "f16" ? f16ToF32(new Uint16Array(bin)) : new Float32Array(bin);
  if (all.length * size !== bin.byteLength) throw new Error("size");
  const byName = new Map(m.tensors.map((t) => [t.name, t]));
  const out = new Map<string, Float32Array>();
  for (const [name, shape] of tensorShapes(m.config)) {
    const t = byName.get(name);
    const n = shape.reduce((a, b) => a * b, 1);
    if (!t || t.shape.join("x") !== shape.join("x") || t.offset + n > all.length) throw new Error("tensor " + name);
    out.set(name, all.subarray(t.offset, t.offset + n));
  }
  return out;
}

/** y = W x for W stored as [out, in] (PyTorch Linear). */
function matvec(W: Float32Array, x: Float32Array, out: Float32Array, rows: number, cols: number) {
  for (let r = 0; r < rows; r++) {
    let s = 0;
    const o = r * cols;
    for (let i = 0; i < cols; i++) s += W[o + i] * x[i];
    out[r] = s;
  }
}

function rms(x: Float32Array, w: Float32Array, out: Float32Array) {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i] * x[i];
  const r = 1 / Math.sqrt(s / x.length + 1e-6);
  for (let i = 0; i < x.length; i++) out[i] = x[i] * r * w[i];
}

export interface Rng {
  next(): number;
}
export function rng(seed: number): Rng {
  let a = seed >>> 0;
  return {
    next() {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}

export class NicsModel {
  readonly cfg: ReleaseConfig;
  private w: Map<string, Float32Array>;
  private cos: Float32Array;
  private sin: Float32Array;

  constructor(cfg: ReleaseConfig, weights: Map<string, Float32Array>) {
    this.cfg = cfg;
    this.w = weights;
    const hd = cfg.d_model / cfg.n_heads;
    const half = hd / 2;
    this.cos = new Float32Array(cfg.max_seq_len * half);
    this.sin = new Float32Array(cfg.max_seq_len * half);
    for (let p = 0; p < cfg.max_seq_len; p++)
      for (let j = 0; j < half; j++) {
        const invFreq = Math.fround(1 / Math.fround(10000 ** Math.fround((2 * j) / hd)));
        const a = Math.fround(p * invFreq);
        this.cos[p * half + j] = Math.cos(a);
        this.sin[p * half + j] = Math.sin(a);
      }
  }

  private t(name: string) {
    const v = this.w.get(name);
    if (!v) throw new Error(name);
    return v;
  }

  newCache() {
    const { n_layers, max_seq_len, d_model } = this.cfg;
    return Array.from({ length: n_layers }, () => ({ k: new Float32Array(max_seq_len * d_model), v: new Float32Array(max_seq_len * d_model), len: 0 }));
  }

  private rope(x: Float32Array, base: number, pos: number) {
    const hd = this.cfg.d_model / this.cfg.n_heads;
    const half = hd / 2;
    for (let h = 0; h < this.cfg.n_heads; h++)
      for (let j = 0; j < half; j++) {
        const i = base + h * hd + 2 * j;
        const c = this.cos[pos * half + j];
        const s = this.sin[pos * half + j];
        const x1 = x[i];
        const x2 = x[i + 1];
        x[i] = x1 * c - x2 * s;
        x[i + 1] = x1 * s + x2 * c;
      }
  }

  /** Logits for the next token after `token` at position `pos`; the cache keeps earlier positions. */
  step(token: number, pos: number, cache: ReturnType<NicsModel["newCache"]>): Float32Array {
    const { d_model: d, n_heads: H, vocab_size: V } = this.cfg;
    if (pos >= this.cfg.max_seq_len) throw new Error("context full");
    const hd = d / H;
    const hid = ffnHidden(d);
    const emb = this.t("tok_emb.weight");
    const x = new Float32Array(d);
    const sc = Math.sqrt(d);
    for (let i = 0; i < d; i++) x[i] = emb[token * d + i] * sc;
    if (this.cfg.pos_encoding === "learned") {
      const pe = this.t("pos_emb.weight");
      for (let i = 0; i < d; i++) x[i] += pe[pos * d + i];
    }
    const h = new Float32Array(d);
    const qkv = new Float32Array(3 * d);
    const att = new Float32Array(d);
    const o = new Float32Array(d);
    const a = new Float32Array(hid);
    const b = new Float32Array(hid);
    const scores = new Float32Array(pos + 1);
    for (let l = 0; l < this.cfg.n_layers; l++) {
      const p = `blocks.${l}.`;
      const c = cache[l];
      rms(x, this.t(p + "norm1.weight"), h);
      matvec(this.t(p + "attn.qkv.weight"), h, qkv, 3 * d, d);
      if (this.cfg.pos_encoding === "rope") {
        this.rope(qkv, 0, pos);
        this.rope(qkv, d, pos);
      }
      c.k.set(qkv.subarray(d, 2 * d), pos * d);
      c.v.set(qkv.subarray(2 * d, 3 * d), pos * d);
      c.len = pos + 1;
      att.fill(0);
      const scale = 1 / Math.sqrt(hd);
      for (let hh = 0; hh < H; hh++) {
        let mx = -Infinity;
        for (let s = 0; s <= pos; s++) {
          let dot = 0;
          for (let j = 0; j < hd; j++) dot += qkv[hh * hd + j] * c.k[s * d + hh * hd + j];
          scores[s] = dot * scale;
          if (scores[s] > mx) mx = scores[s];
        }
        let sum = 0;
        for (let s = 0; s <= pos; s++) sum += scores[s] = Math.exp(scores[s] - mx);
        for (let s = 0; s <= pos; s++) {
          const pr = scores[s] / sum;
          for (let j = 0; j < hd; j++) att[hh * hd + j] += pr * c.v[s * d + hh * hd + j];
        }
      }
      matvec(this.t(p + "attn.proj.weight"), att, o, d, d);
      for (let i = 0; i < d; i++) x[i] += o[i];
      rms(x, this.t(p + "norm2.weight"), h);
      matvec(this.t(p + "ffn.w1.weight"), h, a, hid, d);
      matvec(this.t(p + "ffn.w2.weight"), h, b, hid, d);
      for (let i = 0; i < hid; i++) a[i] = (a[i] / (1 + Math.exp(-a[i]))) * b[i];
      matvec(this.t(p + "ffn.w3.weight"), a, o, d, hid);
      for (let i = 0; i < d; i++) x[i] += o[i];
    }
    rms(x, this.t("norm_f.weight"), h);
    const logits = new Float32Array(V);
    matvec(emb, h, logits, V, d);
    return logits;
  }

  /** Continue `prompt` ids. temperature 0 = most likely token. Stops at `stop` ids. */
  generate(prompt: number[], maxNew: number, opts: { temperature?: number; topK?: number; seed?: number; stop?: number[] } = {}): number[] {
    const { temperature = 0, topK = 40, seed = 1, stop = [] } = opts;
    const r = rng(seed);
    const cache = this.newCache();
    let logits: Float32Array | null = null;
    prompt.forEach((t, i) => (logits = this.step(t, i, cache)));
    const out: number[] = [];
    let pos = prompt.length;
    while (logits && out.length < maxNew && pos < this.cfg.max_seq_len) {
      const next = pick(logits, temperature, topK, r);
      if (stop.includes(next)) break;
      out.push(next);
      logits = this.step(next, pos++, cache);
    }
    return out;
  }
}

export function pick(logits: Float32Array, temperature: number, topK: number, r: Rng): number {
  let best = 0;
  for (let v = 1; v < logits.length; v++) if (logits[v] > logits[best]) best = v;
  if (temperature <= 0) return best;
  const idx = Array.from(logits.keys()).sort((p, q) => logits[q] - logits[p]).slice(0, Math.max(1, topK));
  const ps = idx.map((v) => Math.exp((logits[v] - logits[best]) / temperature));
  let u = r.next() * ps.reduce((s, p) => s + p, 0);
  for (let i = 0; i < idx.length; i++) if ((u -= ps[i]) <= 0) return idx[i];
  return idx[idx.length - 1];
}
