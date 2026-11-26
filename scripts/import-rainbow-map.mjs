// Imports the Tiled map of Rainbowland (assets/rainbowland/*.tmx, made by the founder) into
// public/rainbowland/map.json for the /rainbowland page.
// The map is 640x640 cells from (-128, -128): the same coordinates as the LAND tokens,
// so cell (x, y) of the map is LAND (x, y). Run: node scripts/import-rainbow-map.mjs [file.tmx]
import { readFileSync, writeFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

const src = process.argv[2] ?? "assets/rainbowland/Aquaterra Map V.2.tmx";
const xml = readFileSync(src, "utf8");
const X0 = -128, Y0 = -128, W = 640, H = 640;
const cells = new Uint32Array(W * H);
const layers = [...xml.matchAll(/<layer [^>]*>([\s\S]*?)<\/layer>/g)];
if (layers.length !== 1) throw new Error(`expected one tile layer, got ${layers.length}`);
for (const m of layers[0][1].matchAll(/<chunk x="(-?\d+)" y="(-?\d+)" width="(\d+)" height="(\d+)">\s*([^<]+?)\s*<\/chunk>/g)) {
  const [x, y, w, h] = m.slice(1, 5).map(Number);
  const raw = inflateSync(Buffer.from(m[5], "base64"));
  for (let i = 0; i < w * h; i++) {
    const cx = x + (i % w) - X0, cy = y + Math.floor(i / w) - Y0;
    if (cx < 0 || cy < 0 || cx >= W || cy >= H) continue;
    cells[cy * W + cx] = raw.readUInt32LE(i * 4) & 0x1fffffff;
  }
}
// tile ids -> small palette index; run-length encode as (index, run) byte pairs
const gids = [...new Set(cells)].sort((a, b) => a - b);
if (gids.length > 255) throw new Error("too many tiles");
const idx = new Map(gids.map((g, i) => [g, i]));
const out = [];
for (let i = 0; i < cells.length; ) {
  const v = cells[i];
  let n = 1;
  while (i + n < cells.length && cells[i + n] === v && n < 255) n++;
  out.push(idx.get(v), n);
  i += n;
}
// Zones: the ground tiles of the map, each its own district of Rainbowland. Roads, shores and
// small details take the zone of the nearest ground; open water belongs to no zone.
const ZONES = [
  { gid: 1087, name: "Ember Coast" },
  { gid: 810, name: "Amber Terrace" },
  { gid: 1258, name: "Violet Neon" },
  { gid: 63, name: "Sunfield" },
  { gid: 1152, name: "Amber Dunes" },
  { gid: 1499, name: "Azure Shelf" },
  { gid: 921, name: "Silver Lake" },
  { gid: 1493, name: "Verdant Reach" },
  { gid: 639, name: "Jade Fields" },
  { gid: 745, name: "Southern Wilds" },
];
const WATER = new Set([61, 232]);
const zone = new Uint8Array(W * H); // 0 = open water, i + 1 = ZONES[i]
const queue = [];
ZONES.forEach((z, i) => cells.forEach((g, k) => { if (g === z.gid) { zone[k] = i + 1; queue.push(k); } }));
for (let q = 0; q < queue.length; q++) {
  const k = queue[q], x = k % W, y = (k / W) | 0;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
    const n = ny * W + nx;
    if (zone[n] || WATER.has(cells[n])) continue;
    zone[n] = zone[k];
    queue.push(n);
  }
}
const zrle = [];
for (let i = 0; i < zone.length; ) {
  let n = 1;
  while (i + n < zone.length && zone[i + n] === zone[i] && n < 255) n++;
  zrle.push(zone[i], n);
  i += n;
}
const zones = ZONES.map((z, i) => {
  let sx = 0, sy = 0, n = 0;
  zone.forEach((v, k) => { if (v === i + 1) { sx += k % W; sy += (k / W) | 0; n++; } });
  // the label sits on the zone cell nearest its middle
  const mx = sx / n, my = sy / n;
  let best = 0, bd = Infinity;
  zone.forEach((v, k) => { if (v === i + 1 && cells[k] === z.gid) { const d = (k % W - mx) ** 2 + (((k / W) | 0) - my) ** 2; if (d < bd) { bd = d; best = k; } } });
  return { name: z.name, gid: z.gid, cells: n, c: best % W, r: (best / W) | 0 };
});
const tileset = xml.match(/<tileset [^>]*columns="(\d+)"[^>]*>/);
const json = { x0: X0, y0: Y0, w: W, h: H, tile: 16, spacing: 1, columns: Number(tileset?.[1] ?? 57), gids, rle: Buffer.from(out).toString("base64"), zones, zoneRle: Buffer.from(zrle).toString("base64") };
writeFileSync("public/rainbowland/map.json", JSON.stringify(json));
console.log(`map.json: ${gids.length} tiles, ${out.length / 2} runs, ${JSON.stringify(json).length} bytes`);
