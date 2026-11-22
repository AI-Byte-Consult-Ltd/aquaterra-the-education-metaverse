#!/usr/bin/env node
// Converts a Tiled (.tmx) infinite map -- base64+zlib chunks -- into a compact
// binary tile grid the web app can fetch directly, plus a JSON manifest with
// the tileset metadata needed to slice the spritesheet. Re-run this whenever
// map-source/Aquaterra_Map_V.1.tmx is updated in Tiled.
//
// Output packing: one Uint16 per cell (little-endian), grid stored row-major
// from the map's top-left tile. Bits 0-10 = (local tile id + 1) -- 0 is
// reserved to mean "no tile" (raw gid 0), distinct from local tile id 0,
// which is itself a real, drawable tile (gid firstgid) -- bit 11 =
// horizontal flip, bit 12 = vertical flip, bit 13 = diagonal flip (Tiled's
// GID flip flags, shifted down). Local id = gid - firstgid, NOT gid itself:
// getting this wrong silently shifts every lookup to the next tile in the
// sheet, which is easy to miss on uniform terrain but very visible on
// distinctive tiles like coastline corners (they come out rotated/wrong).

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { inflateSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const srcPath = process.argv[2] ?? path.join(repoRoot, "map-source/Aquaterra_Map_V.1.tmx");
const outDir = path.join(repoRoot, "public/tiles");

const xml = readFileSync(srcPath, "utf8");

const tilesetMatch = xml.match(/<tileset[^>]*name="([^"]+)"[^>]*tilewidth="(\d+)"[^>]*tileheight="(\d+)"[^>]*spacing="(\d+)"[^>]*tilecount="(\d+)"[^>]*columns="(\d+)"/);
if (!tilesetMatch) throw new Error("Could not find <tileset> element with the expected attributes");
const [, tilesetName, tileWidthS, tileHeightS, spacingS, tilecountS, columnsS] = tilesetMatch;

const firstgidMatch = xml.match(/<tileset[^>]*firstgid="(\d+)"/);
if (!firstgidMatch) throw new Error("Could not find firstgid on the <tileset> element");
const firstgid = Number(firstgidMatch[1]);

const imageMatch = xml.match(/<image source="([^"]+)" width="(\d+)" height="(\d+)"/);
if (!imageMatch) throw new Error("Could not find tileset <image> element");
const [, imageSource, imageWidthS, imageHeightS] = imageMatch;

const layerMatch = xml.match(/<layer id="(\d+)" name="([^"]+)" width="(\d+)" height="(\d+)">/);
if (!layerMatch) throw new Error("Could not find <layer> element");

const chunkRe = /<chunk x="(-?\d+)" y="(-?\d+)" width="(\d+)" height="(\d+)">\s*([\s\S]*?)\s*<\/chunk>/g;

const FLIP_H = 0x80000000;
const FLIP_V = 0x40000000;
const FLIP_D = 0x20000000;
const ID_MASK = 0x1fffffff;

let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
const chunks = [];
let m;
while ((m = chunkRe.exec(xml))) {
  const [, xs, ys, ws, hs, b64] = m;
  const cx = parseInt(xs, 10), cy = parseInt(ys, 10);
  const cw = parseInt(ws, 10), ch = parseInt(hs, 10);
  minX = Math.min(minX, cx);
  minY = Math.min(minY, cy);
  maxX = Math.max(maxX, cx + cw);
  maxY = Math.max(maxY, cy + ch);
  const buf = inflateSync(Buffer.from(b64.trim(), "base64"));
  if (buf.length !== cw * ch * 4) throw new Error(`Chunk at (${cx},${cy}) decompressed to unexpected size`);
  chunks.push({ cx, cy, cw, ch, buf });
}
if (chunks.length === 0) throw new Error("No chunks found -- is this an infinite Tiled map?");

const gridW = maxX - minX;
const gridH = maxY - minY;
const grid = new Uint16Array(gridW * gridH);

for (const { cx, cy, cw, ch, buf } of chunks) {
  const ox = cx - minX;
  const oy = cy - minY;
  for (let ly = 0; ly < ch; ly++) {
    for (let lx = 0; lx < cw; lx++) {
      const gid = buf.readUInt32LE((ly * cw + lx) * 4);
      let packed = 0; // 0 = no tile
      if (gid !== 0) {
        const localId = (gid & ID_MASK) - firstgid;
        packed = (localId + 1) & 0x7ff; // 11 bits, shifted by 1 so 0 stays reserved for "no tile"
        if (gid & FLIP_H) packed |= 0x800;
        if (gid & FLIP_V) packed |= 0x1000;
        if (gid & FLIP_D) packed |= 0x2000;
      }
      grid[(oy + ly) * gridW + (ox + lx)] = packed;
    }
  }
}

mkdirSync(outDir, { recursive: true });
writeFileSync(path.join(outDir, "aquaterra-grid.bin"), Buffer.from(grid.buffer));

const manifest = {
  grid: { width: gridW, height: gridH, originTileX: minX, originTileY: minY },
  tileset: {
    name: tilesetName,
    tileWidth: Number(tileWidthS),
    tileHeight: Number(tileHeightS),
    spacing: Number(spacingS),
    tileCount: Number(tilecountS),
    columns: Number(columnsS),
    imageWidth: Number(imageWidthS),
    imageHeight: Number(imageHeightS),
    imageSourceHint: imageSource,
    // Where the actual spritesheet PNG must be placed for the renderer to load it.
    webImagePath: "/tiles/roguelike-tileset.png",
  },
};
writeFileSync(path.join(outDir, "aquaterra-grid.json"), JSON.stringify(manifest, null, 2));

console.log(`Grid: ${gridW}x${gridH} tiles, origin (${minX},${minY})`);
console.log(`Wrote ${path.join(outDir, "aquaterra-grid.bin")} (${grid.byteLength} bytes)`);
console.log(`Wrote ${path.join(outDir, "aquaterra-grid.json")}`);
console.log(`Tileset "${tilesetName}": ${tilecountS} tiles, ${columnsS} columns, image ${imageWidthS}x${imageHeightS}`);
console.log(`NOTE: place the actual spritesheet PNG at public/tiles/roguelike-tileset.png`);
