/**
 * Draws Rainbowland: one pixel per LAND on an image of the continent with its sea,
 * then scaled up on screen. Land in the mist is pale, with rare land faintly showing
 * through; land that came home has its zone's ground and its tier's colour.
 */
import { COLS, TOTAL, TIER_COLOR, TIER_OF_CODE, type Tier } from "./grid";
import type { Terrain } from "./terrain";

/**
 * The whole map of Rainbowland, drawn by the founder in Tiled (assets/rainbowland/*.tmx):
 * 640 x 640 cells from (-128, -128), the coordinates of the LAND tokens. Image pixel
 * (c, r) is LAND (c - 128, r - 128); the minted tokens fill the first 87 rows.
 */
export const PAD = 0;
export const IMG_W = 640;
export const IMG_H = 640;

const hash = (x: number, y: number) => {
  let h = (x * 374761393 + y * 668265263) >>> 0;
  h = ((h ^ (h >>> 13)) * 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
};
/** Smooth value noise, 0..1. */
export function noise(x: number, y: number) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const fx = x - xi, fy = y - yi;
  const s = (t: number) => t * t * (3 - 2 * t);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return a + (b - a) * s(fx) + (c - a) * s(fy) + (a - b - c + d) * s(fx) * s(fy);
}
export const mix = (a: number[], b: number[], t: number) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

/** The whole continent, one pixel per cell, from the map tiles; LAND that came home takes its tier colour. */
export function drawBase(terrain: Terrain, tiles: string, claimed: Set<number>, mine: Set<number>): HTMLCanvasElement {
  const cv = document.createElement("canvas");
  cv.width = IMG_W;
  cv.height = IMG_H;
  const ctx = cv.getContext("2d")!;
  const img = ctx.createImageData(IMG_W, IMG_H);
  const px = img.data;
  for (let i = 0; i < IMG_W * IMG_H; i++) {
    let rgb: number[] = terrain.colors[terrain.cells[i]];
    const c = i % IMG_W, r = (i / IMG_W) | 0;
    const t = r * COLS + c;
    if (c < COLS && t < TOTAL) {
      const tier: Tier = TIER_OF_CODE[tiles[t]] ?? "common";
      if (claimed.has(t)) {
        rgb = tier === "common" ? mix(rgb, [255, 255, 255], 0.35) : mix(rgb, TIER_COLOR[tier], tier === "cyber" ? 0.85 : 0.6);
        if (mine.has(t)) rgb = mix(rgb, [255, 255, 255], 0.25);
      } else if (tier !== "common") rgb = mix(rgb, TIER_COLOR[tier], tier === "cyber" ? 0.22 : 0.12);
    }
    const o = i * 4;
    px[o] = rgb[0];
    px[o + 1] = rgb[1];
    px[o + 2] = rgb[2];
    px[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}

export interface View {
  /** Screen pixels per cell. */
  scale: number;
  /** Image point at the top-left corner of the screen. */
  ox: number;
  oy: number;
}

export const toImage = (v: View, sx: number, sy: number) => ({ x: v.ox + sx / v.scale, y: v.oy + sy / v.scale });
/** Map cell under an image point, or null off the map. */
export const cellAtImage = (x: number, y: number) => {
  const c = Math.floor(x), r = Math.floor(y);
  return c >= 0 && r >= 0 && c < IMG_W && r < IMG_H ? { c, r } : null;
};
export const tokenAtImage = (x: number, y: number): number | null => {
  const c = Math.floor(x) - PAD, r = Math.floor(y) - PAD;
  if (c < 0 || c >= COLS || r < 0) return null;
  const t = r * COLS + c;
  return t < TOTAL ? t : null;
};

/** The bridge reaches the west coast at the middle of the LAND rows; the harbour and station sit beside it. */
export const BRIDGE_ROW = 43;
/** The bridge runs over the western sea of the map onto the coast. */
export const LANDFALL = 8;
export const HARBOUR = { c: 1, r: BRIDGE_ROW + 6 };
export const STATION = { c: 9, r: BRIDGE_ROW - 6 };

export function drawScene(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  base: HTMLCanvasElement,
  v: View,
  opts: { terrain: Terrain; claimed: Set<number>; tiles: string; selected: { c: number; r: number } | null; time: number; labels: { bridge: string; harbour: string; station: string; zones: { name: string; c: number; r: number; color: [number, number, number] }[] } },
) {
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = "#12406e";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(base, -v.ox * v.scale, -v.oy * v.scale, IMG_W * v.scale, IMG_H * v.scale);
  const at = (c: number, r: number) => ({ x: (c + PAD - v.ox) * v.scale, y: (r + PAD - v.oy) * v.scale });
  // the real tiles of the map when zoomed in, with the colour of LAND that came home on top
  if (v.scale >= 6 && opts.terrain.sheet) {
    drawTiles(ctx, w, h, v, opts.terrain);
    for (const t of opts.claimed) {
      const p = at(t % COLS, Math.floor(t / COLS));
      if (p.x < -v.scale || p.y < -v.scale || p.x > w || p.y > h) continue;
      const tier: Tier = TIER_OF_CODE[opts.tiles[t]] ?? "common";
      const [cr, cg, cb] = tier === "common" ? [255, 255, 255] : TIER_COLOR[tier];
      ctx.fillStyle = `rgba(${cr},${cg},${cb},${tier === "common" ? 0.3 : 0.45})`;
      ctx.fillRect(p.x, p.y, v.scale, v.scale);
    }
  }

  // Rainbow Bridge: from the west coast out to sea, towards First Light City
  const b0 = at(0, BRIDGE_ROW + 0.5);
  const bw = Math.max(2, v.scale * 0.9);
  const bands = ["#ff4d4d", "#ff9f40", "#ffe14d", "#4ddc6a", "#4db8ff", "#6a6aff", "#b36bff"];
  bands.forEach((col, i) => {
    ctx.fillStyle = col;
    ctx.fillRect(Math.min(0, b0.x) - 40, b0.y - bw / 2 + (i - 3) * (bw / 7), Math.max(0, b0.x - Math.min(0, b0.x)) + 40 + LANDFALL * v.scale, bw / 7 + 0.5);
  });
  // neon glow of Cyber land that came home, when zoomed in enough to see a cell
  if (v.scale >= 3) {
    const pulse = 0.55 + 0.45 * Math.sin(opts.time / 400);
    ctx.save();
    ctx.shadowColor = `rgba(255,46,214,${pulse})`;
    ctx.shadowBlur = Math.min(18, v.scale * 1.5);
    ctx.fillStyle = `rgba(255,120,236,${0.35 + 0.4 * pulse})`;
    for (const t of opts.claimed) {
      if (opts.tiles[t] !== "x") continue;
      const p = at(t % COLS, Math.floor(t / COLS));
      if (p.x < -v.scale || p.y < -v.scale || p.x > w || p.y > h) continue;
      ctx.fillRect(p.x, p.y, v.scale, v.scale);
    }
    ctx.restore();
  }
  // grid lines when cells are large
  if (v.scale >= 9) {
    ctx.strokeStyle = "rgba(20,30,50,0.18)";
    ctx.lineWidth = 1;
    const c0 = Math.max(0, Math.floor(v.ox - PAD)), c1 = Math.min(COLS, Math.ceil(v.ox - PAD + w / v.scale));
    const r0 = Math.max(0, Math.floor(v.oy - PAD)), r1 = Math.min(Math.ceil(TOTAL / COLS), Math.ceil(v.oy - PAD + h / v.scale));
    ctx.beginPath();
    for (let c = c0; c <= c1; c++) {
      const p = at(c, r0), q = at(c, r1);
      ctx.moveTo(Math.round(p.x) + 0.5, p.y);
      ctx.lineTo(Math.round(q.x) + 0.5, q.y);
    }
    for (let r = r0; r <= r1; r++) {
      const p = at(c0, r), q = at(c1, r);
      ctx.moveTo(p.x, Math.round(p.y) + 0.5);
      ctx.lineTo(q.x, Math.round(p.y) + 0.5);
    }
    ctx.stroke();
    // a little house on each plot that came home
    if (v.scale >= 14) {
      for (const t of opts.claimed) {
        const p = at(t % COLS, Math.floor(t / COLS));
        if (p.x < -v.scale || p.y < -v.scale || p.x > w || p.y > h) continue;
        const s = v.scale;
        ctx.fillStyle = "rgba(255,255,255,0.92)";
        ctx.beginPath();
        ctx.moveTo(p.x + s * 0.5, p.y + s * 0.18);
        ctx.lineTo(p.x + s * 0.84, p.y + s * 0.48);
        ctx.lineTo(p.x + s * 0.16, p.y + s * 0.48);
        ctx.closePath();
        ctx.fill();
        ctx.fillRect(p.x + s * 0.26, p.y + s * 0.48, s * 0.48, s * 0.34);
      }
    }
  }
  // harbour and station markers
  const mark = (c: number, r: number, colour: string, label: string, glyph: string) => {
    const p = at(c + 0.5, r + 0.5);
    const rad = Math.max(7, Math.min(14, v.scale * 1.4));
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.arc(p.x, p.y, rad, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.font = `700 ${Math.round(rad * 1.1)}px Inter, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(glyph, p.x, p.y + 1);
    if (v.scale >= 2) {
      ctx.font = "700 12px Inter, system-ui, sans-serif";
      const half = ctx.measureText(label).width / 2 + 6;
      label3(ctx, label, Math.max(half, p.x), p.y - rad - 8, 12);
    }
  };
  mark(HARBOUR.c, HARBOUR.r, "#0e7490", opts.labels.harbour, "⚓");
  mark(STATION.c, STATION.r, "#7c3aed", opts.labels.station, "🚆");
  if (b0.x > -20) {
    ctx.font = "700 12px Inter, system-ui, sans-serif";
    const half = ctx.measureText(opts.labels.bridge).width / 2 + 8;
    label3(ctx, opts.labels.bridge, Math.max(half, b0.x - half + 8), b0.y - bw - 10, 12);
  }

  // zone names on the map
  ctx.textAlign = "center";
  for (const z of opts.labels.zones) {
    const p = at(z.c + 0.5, z.r + 0.5);
    if (p.x < -200 || p.x > w + 200 || p.y < -40 || p.y > h + 40) continue;
    label3(ctx, z.name, p.x, p.y, Math.max(11, Math.min(18, v.scale * 3)), `rgb(${z.color.map((x) => Math.min(255, x + 70)).join(",")})`);
  }

  // selected cell
  if (opts.selected != null) {
    const p = at(opts.selected.c, opts.selected.r);
    const s = Math.max(v.scale, 6);
    const off = (s - v.scale) / 2;
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;
    ctx.strokeRect(p.x - off - 1, p.y - off - 1, s + 2, s + 2);
    ctx.strokeStyle = "#111";
    ctx.lineWidth = 1;
    ctx.strokeRect(p.x - off - 3, p.y - off - 3, s + 6, s + 6);
  }
}

export function label3(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, fill = "#fff") {
  ctx.font = `700 ${Math.round(size)}px Inter, system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(10,20,40,0.75)";
  ctx.strokeText(text, x, y);
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
}

/** Tiles of the map are drawn into cached chunks of 32 x 32 cells at full sprite size. */
const CHUNK = 32;
const chunks = new Map<string, HTMLCanvasElement>();
function chunk(terrain: Terrain, cx: number, cy: number) {
  const key = `${cx},${cy}`;
  let cv = chunks.get(key);
  if (cv) return cv;
  const T = terrain.tile;
  cv = document.createElement("canvas");
  cv.width = CHUNK * T;
  cv.height = CHUNK * T;
  const g = cv.getContext("2d")!;
  g.imageSmoothingEnabled = false;
  for (let r = 0; r < CHUNK; r++)
    for (let c = 0; c < CHUNK; c++) {
      const x = cx * CHUNK + c, y = cy * CHUNK + r;
      if (x >= IMG_W || y >= IMG_H) continue;
      const gid = terrain.gids[terrain.cells[y * IMG_W + x]];
      if (!gid) continue;
      const k = gid - 1;
      const sx = (k % terrain.columns) * (T + terrain.spacing), sy = Math.floor(k / terrain.columns) * (T + terrain.spacing);
      g.drawImage(terrain.sheet!, sx, sy, T, T, c * T, r * T, T, T);
    }
  if (chunks.size > 96) chunks.delete(chunks.keys().next().value as string);
  chunks.set(key, cv);
  return cv;
}
function drawTiles(ctx: CanvasRenderingContext2D, w: number, h: number, v: View, terrain: Terrain) {
  const c0 = Math.max(0, Math.floor(v.ox / CHUNK)), c1 = Math.min(IMG_W / CHUNK - 1, Math.floor((v.ox + w / v.scale) / CHUNK));
  const r0 = Math.max(0, Math.floor(v.oy / CHUNK)), r1 = Math.min(IMG_H / CHUNK - 1, Math.floor((v.oy + h / v.scale) / CHUNK));
  const size = CHUNK * v.scale;
  for (let cy = r0; cy <= r1; cy++)
    for (let cx = c0; cx <= c1; cx++) ctx.drawImage(chunk(terrain, cx, cy), (cx * CHUNK - v.ox) * v.scale, (cy * CHUNK - v.oy) * v.scale, size + 0.5, size + 0.5);
}
