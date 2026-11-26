// Recover the wallet address that signed a message with personal_sign (EIP-191), with no
// libraries: Keccak-256 and secp256k1 public key recovery on BigInt. The same text is pasted
// into the n8n Code node of "[71 PUBLIC] AquaTerra Heritage"; test: node server/heritage/verify-check.cjs
// recoverPersonal(message: string, signature: "0x" + 130 hex) -> "0x..." lower case, or null.

const KECCAK_RC = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];
const KECCAK_ROT = [0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8, 18, 2, 61, 56, 14];
const M64 = (1n << 64n) - 1n;
const rotl = (x, n) => (n === 0 ? x : ((x << BigInt(n)) | (x >> BigInt(64 - n))) & M64);

function keccak256(bytes) {
  const rate = 136;
  const padded = new Uint8Array(Math.ceil((bytes.length + 1) / rate) * rate);
  padded.set(bytes);
  padded[bytes.length] ^= 0x01;
  padded[padded.length - 1] ^= 0x80;
  const s = new Array(25).fill(0n);
  for (let off = 0; off < padded.length; off += rate) {
    for (let i = 0; i < rate / 8; i++) {
      let lane = 0n;
      for (let b = 7; b >= 0; b--) lane = (lane << 8n) | BigInt(padded[off + i * 8 + b]);
      s[i] ^= lane;
    }
    for (let round = 0; round < 24; round++) {
      const c = [0, 1, 2, 3, 4].map((x) => s[x] ^ s[x + 5] ^ s[x + 10] ^ s[x + 15] ^ s[x + 20]);
      for (let x = 0; x < 5; x++) {
        const d = c[(x + 4) % 5] ^ rotl(c[(x + 1) % 5], 1);
        for (let y = 0; y < 25; y += 5) s[x + y] ^= d;
      }
      const b = new Array(25);
      for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) b[y + ((2 * x + 3 * y) % 5) * 5] = rotl(s[x + y * 5], KECCAK_ROT[x + y * 5]);
      for (let x = 0; x < 5; x++) for (let y = 0; y < 25; y += 5) s[x + y] = b[x + y] ^ (~b[((x + 1) % 5) + y] & b[((x + 2) % 5) + y] & M64);
      s[0] ^= KECCAK_RC[round];
    }
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 4; i++) for (let b = 0; b < 8; b++) out[i * 8 + b] = Number((s[i] >> BigInt(8 * b)) & 0xffn);
  return out;
}

const P = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn;
const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const G = [0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n, 0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n];
const mod = (a, m = P) => ((a % m) + m) % m;
function powmod(b, e, m) { let r = 1n; b = mod(b, m); while (e > 0n) { if (e & 1n) r = (r * b) % m; b = (b * b) % m; e >>= 1n; } return r; }
const inv = (a, m = P) => powmod(a, m - 2n, m);
// Jacobian points [X, Y, Z]; Z = 0 is infinity.
function dbl([x, y, z]) {
  if (z === 0n || y === 0n) return [0n, 1n, 0n];
  const s = mod(4n * x * y * y), m = mod(3n * x * x);
  const x3 = mod(m * m - 2n * s);
  return [x3, mod(m * (s - x3) - 8n * y * y * y * y), mod(2n * y * z)];
}
function add(p, q) {
  if (p[2] === 0n) return q;
  if (q[2] === 0n) return p;
  const z1z1 = mod(p[2] * p[2]), z2z2 = mod(q[2] * q[2]);
  const u1 = mod(p[0] * z2z2), u2 = mod(q[0] * z1z1);
  const s1 = mod(p[1] * q[2] * z2z2), s2 = mod(q[1] * p[2] * z1z1);
  if (u1 === u2) return s1 === s2 ? dbl(p) : [0n, 1n, 0n];
  const h = mod(u2 - u1), r = mod(s2 - s1), hh = mod(h * h), hhh = mod(h * hh);
  const x3 = mod(r * r - hhh - 2n * u1 * hh);
  return [x3, mod(r * (u1 * hh - x3) - s1 * hhh), mod(h * p[2] * q[2])];
}
function mul(pt, k) {
  let r = [0n, 1n, 0n], a = [pt[0], pt[1], 1n];
  while (k > 0n) { if (k & 1n) r = add(r, a); a = dbl(a); k >>= 1n; }
  return r;
}
function affine([x, y, z]) { if (z === 0n) return null; const zi = inv(z), zi2 = mod(zi * zi); return [mod(x * zi2), mod(y * zi2 * zi)]; }

const hexToBytes = (h) => Uint8Array.from(h.match(/../g) || [], (b) => parseInt(b, 16));
const bytesToHex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const utf8 = (t) => Uint8Array.from(unescape(encodeURIComponent(t)), (c) => c.charCodeAt(0));
const big = (b) => BigInt('0x' + (bytesToHex(b) || '0'));

function recoverPersonal(message, signature) {
  if (typeof message !== 'string' || typeof signature !== 'string' || !/^0x[0-9a-fA-F]{130}$/.test(signature)) return null;
  const msg = utf8(message);
  const prefix = utf8('\x19Ethereum Signed Message:\n' + msg.length);
  const all = new Uint8Array(prefix.length + msg.length); all.set(prefix); all.set(msg, prefix.length);
  const e = big(keccak256(all));
  const sig = hexToBytes(signature.slice(2));
  const r = big(sig.slice(0, 32)), s = big(sig.slice(32, 64));
  let v = sig[64]; if (v >= 27) v -= 27;
  if (v > 1 || r <= 0n || r >= N || s <= 0n || s >= N) return null;
  const y2 = mod(r * r * r + 7n);
  let y = powmod(y2, (P + 1n) / 4n, P);
  if (mod(y * y) !== y2) return null;
  if ((y & 1n) !== BigInt(v)) y = P - y;
  const ri = inv(r, N);
  const Q = affine(add(mul([r, y], mod(s * ri, N)), mul(G, mod(-e * ri, N))));
  if (!Q) return null;
  const pub = hexToBytes(Q[0].toString(16).padStart(64, '0') + Q[1].toString(16).padStart(64, '0'));
  return '0x' + bytesToHex(keccak256(pub).slice(12));
}

if (typeof module !== 'undefined') module.exports = { recoverPersonal, keccak256 };
