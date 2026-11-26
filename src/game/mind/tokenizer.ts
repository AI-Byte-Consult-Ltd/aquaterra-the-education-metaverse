/*
 * The NICS Language tokenizer ("nics-bpe-v1"), read in the browser.
 * A line-by-line port of src/nics/text/tokenizer.py of the NICS lab (byte-level BPE,
 * written from scratch there): same id layout, same pieces, same merge order, so the
 * game turns text into exactly the token ids the lab's model was trained on.
 *
 * Id layout: 0..255 special tokens, 256..511 the byte values, 512.. learned merges.
 */
export const FORMAT = "nics-bpe-v1";
export const RESERVED = 256;
export const BYTE_OFFSET = RESERVED;
export const MERGE_OFFSET = RESERVED + 256;

// Python: r" ?[^\W\d_]+|\d| ?[^\s\w]+|\s+|_"  (\w = letters + numbers + "_", \d = decimal digits)
const PIECE_RE = / ?[\p{L}\p{Nl}\p{No}]+|\p{Nd}| ?[^\s\p{L}\p{N}_]+|\s+|_/gu;

export const splitPieces = (text: string): string[] => text.match(PIECE_RE) ?? [];

export interface TokenizerFile {
  format: string;
  reserved: number;
  specials: string[];
  merges: [number, number][];
}

const enc = new TextEncoder();
const dec = new TextDecoder();

export class NicsTokenizer {
  readonly specials: string[];
  private rank = new Map<number, number>(); // pair key a*2^20+b -> merge index
  private bytes: Uint8Array[] = [];
  private specialId = new Map<string, number>();
  private specialRe: RegExp | null;
  private cache = new Map<string, number[]>();

  constructor(file: TokenizerFile) {
    if (file.format !== FORMAT || file.reserved !== RESERVED) throw new Error("not a nics-bpe-v1 tokenizer");
    this.specials = file.specials;
    file.specials.forEach((s, i) => this.specialId.set(s, i));
    for (let b = 0; b < 256; b++) this.bytes.push(Uint8Array.of(b));
    file.merges.forEach(([a, b], i) => {
      this.rank.set(a * 1048576 + b, i);
      const x = this.bytes[a - BYTE_OFFSET];
      const y = this.bytes[b - BYTE_OFFSET];
      const m = new Uint8Array(x.length + y.length);
      m.set(x);
      m.set(y, x.length);
      this.bytes.push(m);
    });
    const esc = [...file.specials].sort((p, q) => q.length - p.length).map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    this.specialRe = esc.length ? new RegExp("(" + esc.join("|") + ")") : null;
  }

  get vocabSize() {
    return MERGE_OFFSET + this.rank.size;
  }

  id(special: string): number {
    const v = this.specialId.get(special);
    if (v === undefined) throw new Error("unknown special token " + special);
    return v;
  }

  private piece(p: string): number[] {
    const hit = this.cache.get(p);
    if (hit) return hit;
    let ids = Array.from(enc.encode(p), (b) => BYTE_OFFSET + b);
    while (ids.length > 1) {
      let best = -1;
      for (let i = 0; i + 1 < ids.length; i++) {
        const r = this.rank.get(ids[i] * 1048576 + ids[i + 1]);
        if (r !== undefined && (best < 0 || r < best)) best = r;
      }
      if (best < 0) break;
      const [ma, mb] = this.pairOf(best);
      const merged: number[] = [];
      for (let i = 0; i < ids.length; ) {
        if (i + 1 < ids.length && ids[i] === ma && ids[i + 1] === mb) {
          merged.push(MERGE_OFFSET + best);
          i += 2;
        } else merged.push(ids[i++]);
      }
      ids = merged;
    }
    if (this.cache.size > 200000) this.cache.clear();
    this.cache.set(p, ids);
    return ids;
  }

  private pairs: [number, number][] | null = null;
  private pairOf(r: number): [number, number] {
    if (!this.pairs) {
      this.pairs = [];
      for (const [k, i] of this.rank) this.pairs[i] = [Math.floor(k / 1048576), k % 1048576];
    }
    return this.pairs[r];
  }

  /** Text from a resident is always encoded with allowSpecial = false: typed "<|end|>" stays plain bytes. */
  encode(text: string, allowSpecial = false): number[] {
    const out: number[] = [];
    const plain = (t: string) => {
      for (const p of splitPieces(t)) out.push(...this.piece(p));
    };
    if (allowSpecial && this.specialRe) {
      for (const part of text.split(this.specialRe)) {
        if (!part) continue;
        const sid = this.specialId.get(part);
        if (sid !== undefined) out.push(sid);
        else plain(part);
      }
    } else plain(text);
    return out;
  }

  /** Special tokens are left out of the text, like the lab's decode(skip_special=True). */
  decode(ids: number[]): string {
    const parts: Uint8Array[] = [];
    let n = 0;
    for (const id of ids) {
      if (id < BYTE_OFFSET) continue;
      const b = this.bytes[id - BYTE_OFFSET];
      if (!b) continue;
      parts.push(b);
      n += b.length;
    }
    const all = new Uint8Array(n);
    let o = 0;
    for (const b of parts) {
      all.set(b, o);
      o += b.length;
    }
    return dec.decode(all);
  }
}
