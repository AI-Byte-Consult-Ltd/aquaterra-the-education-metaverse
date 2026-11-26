/*
 * Fetch a release folder, check both files against the sha256 in its manifest, and keep
 * them in the browser cache so a resident downloads a version once.
 */
import type { ReleaseManifest } from "./engine";

const CACHE = "nics-releases-v1";

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(h), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function getFile(url: string, onBytes?: (n: number) => void): Promise<ArrayBuffer> {
  let cache: Cache | null = null;
  try {
    cache = await caches.open(CACHE);
    const hit = await cache.match(url);
    if (hit) return hit.arrayBuffer();
  } catch {
    cache = null;
  }
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error("download");
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    n += value.length;
    onBytes?.(n);
  }
  const all = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    all.set(p, o);
    o += p.length;
  }
  try {
    await cache?.put(url, new Response(all.slice().buffer));
  } catch {
    /* no room in the cache: fine, it downloads again next time */
  }
  return all.buffer;
}

export async function loadRelease(baseUrl: string, onBytes?: (n: number) => void) {
  const manifest = (await (await fetch(`${baseUrl}/manifest.json`, { cache: "no-cache" })).json()) as ReleaseManifest;
  const [weights, tokenizer] = await Promise.all([
    getFile(`${baseUrl}/${manifest.weights_file}?sha=${manifest.weights_sha256}`, onBytes),
    getFile(`${baseUrl}/${manifest.tokenizer_file}?sha=${manifest.tokenizer_sha256}`),
  ]);
  if ((await sha256Hex(weights)) !== manifest.weights_sha256 || (await sha256Hex(tokenizer)) !== manifest.tokenizer_sha256) {
    try {
      await caches.delete(CACHE);
    } catch {
      /* ignore */
    }
    throw new Error("checksum");
  }
  return { manifest, weights, tokenizer: JSON.parse(new TextDecoder().decode(tokenizer)) };
}
