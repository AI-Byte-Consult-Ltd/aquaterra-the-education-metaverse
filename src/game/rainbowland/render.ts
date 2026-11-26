/**
 * Draws Rainbowland: one pixel per LAND on an image of the continent with its sea,
 * then scaled up on screen. Land in the mist is pale, with rare land faintly showing
 * through; land that came home has its zone's ground and its tier's colour.
 */
import { COLS, ROWS, TOTAL, TIER_COLOR, TIER_OF_CODE, zoneOfColumn, type Tier } from "./grid";

/** Sea around the continent, in cells. */
export const PAD = 28;
export const IMG_W = COLS + PAD * 2;
export const IMG_H = ROWS + PAD * 2;

const hash = (x: number, y: number) => {
  let h = (x * 374761393 + y * 668265263) >>> 0;
  h = ((h ^ (h >>> 13)) * 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
};
/** Smooth value noise, 0..1. */
function noise(x: number, y: number) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const fx = x - xi, fy = y - yi;
  const s = (t: number) => t * t * (3 - 2 * t);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return a + (b - a) * s(fx) + (c - a) * s(fy) + (a - b - c + d) * s(fx) * s(fy);
}
const mix = (a: number[], b: number[], t: number) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

/** Distance in cells from the grid to a point of the image, for the coast. */
function gridDistance(ix: number, iy: number) {
  const c = ix - PAD, r = iy - PAD;
  const lastRowCols = TOTAL - (ROWS - 1) * COLS;
  const maxR = c < lastRowCols ? ROWS - 1 : ROWS - 2;
  const dx = c < 0 ? -c : c >= COLS ? c - COLS + 1 : 0;
  const dy = r < 0 ? -r : r > maxR ? r - maxR : 0;
  return Math.hypot(dx, dy);
}

/** The whole continent. tiles: one tier letter per token; claimed: token ids that came home. */
export function drawBase(tiles: string, claimed: Set<number>, mine: Set<number>): HTMLCanvasElement {
  const cv = document.createElement("canvas");
  cv.width = IMG_W;
  cv.height = IMG_H;
  const ctx = cv.getContext("2d")!;
  const img = ctx.createImageData(IMG_W, IMG_H);
  const px = img.data;
  for (let iy = 0; iy < IMG_H; iy++)
    for (let ix = 0; ix < IMG_W; ix++) {
      const o = (iy * IMG_W + ix) * 4;
      const c = ix - PAD, r = iy - PAD;
      const t = r * COLS + c;
      const onGrid = c >= 0 && c < COLS && r >= 0 && t >= 0 && t < TOTAL;
      let rgb: number[];
      if (onGrid) {
        const zone = zoneOfColumn(c);
        const tier: Tier = TIER_OF_CODE[tiles[t]] ?? "common";
        const grain = noise(c / 6, r / 6) * 0.5 + noise(c / 1.7, r / 1.7) * 0.5;
        if (claimed.has(t)) {
          const g = mix(zone.ground, [255, 255, 255], grain * 0.12);
          rgb = tier === "common" ? g : mix(g, TIER_COLOR[tier], tier === "cyber" ? 0.85 : 0.6);
          if (mine.has(t)) rgb = mix(rgb, [255, 255, 255], 0.25);
        } else {
          // mist: pale ground of the zone, rare land showing through a little
          const fog = mix(zone.ground, [232, 236, 244], 0.7 + grain * 0.12);
          rgb = tier === "common" ? fog : mix(fog, TIER_COLOR[tier], tier === "cyber" ? 0.32 : 0.2);
        }
      } else {
        const d = gridDistance(ix, iy);
        const coast = 1.2 + noise(ix / 9, iy / 9) * 4.5 + noise(ix / 3, iy / 3) * 1.5;
        if (d <= coast) rgb = d <= coast - 1.5 ? [196, 214, 170] : [236, 222, 176]; // grass rim and beach
        else {
          const deep = Math.min(1, (d - coast) / 18);
          rgb = mix([84, 198, 214], [18, 64, 120], deep);
          rgb = mix(rgb, [255, 255, 255], noise(ix / 4, iy / 4) * 0.06);
        }
      }
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
export const tokenAtImage = (x: number, y: number): number | null => {
  const c = Math.floor(x) - PAD, r = Math.floor(y) - PAD;
  if (c < 0 || c >= COLS || r < 0) return null;
  const t = r * COLS + c;
  return t < TOTAL ? t : null;
};

/** The bridge leaves the west coast at the middle row; the harbour and station sit beside it. */
export const BRIDGE_ROW = Math.floor(ROWS / 2);
export const HARBOUR = { c: 2, r: BRIDGE_ROW + 6 };
export const STATION = { c: 6, r: BRIDGE_ROW - 6 };

export function drawScene(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  base: HTMLCanvasElement,
  v: View,
  opts: { claimed: Set<number>; tiles: string; selected: number | null; time: number; labels: { bridge: string; harbour: string; station: string; zones: { name: string; from: number; to: number; hue: number }[] } },
) {
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = "#12406e";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(base, -v.ox * v.scale, -v.oy * v.scale, IMG_W * v.scale, IMG_H * v.scale);
  const at = (c: number, r: number) => ({ x: (c + PAD - v.ox) * v.scale, y: (r + PAD - v.oy) * v.scale });

  // Rainbow Bridge: from the west coast out to sea, towards First Light City
  const b0 = at(-1, BRIDGE_ROW + 0.5);
  const bw = Math.max(2, v.scale * 0.9);
  const bands = ["#ff4d4d", "#ff9f40", "#ffe14d", "#4ddc6a", "#4db8ff", "#6a6aff", "#b36bff"];
  bands.forEach((col, i) => {
    ctx.fillStyle = col;
    ctx.fillRect(b0.x - PAD * v.scale - 40, b0.y - bw / 2 + (i - 3) * (bw / 7), PAD * v.scale + 40, bw / 7 + 0.5);
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
    const r0 = Math.max(0, Math.floor(v.oy - PAD)), r1 = Math.min(ROWS, Math.ceil(v.oy - PAD + h / v.scale));
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
    if (v.scale >= 2) label3(ctx, label, p.x, p.y - rad - 8, 12);
  };
  mark(HARBOUR.c, HARBOUR.r, "#0e7490", opts.labels.harbour, "⚓");
  mark(STATION.c, STATION.r, "#7c3aed", opts.labels.station, "🚆");
  if (b0.x > 30) {
    ctx.font = "700 12px Inter, system-ui, sans-serif";
    const half = ctx.measureText(opts.labels.bridge).width / 2 + 8;
    label3(ctx, opts.labels.bridge, Math.max(half, Math.min(b0.x - half, b0.x - PAD * v.scale * 0.5)), b0.y - bw - 10, 12);
  }

  // zone names along the top of the continent
  ctx.textAlign = "center";
  for (const z of opts.labels.zones) {
    const p = at((z.from + z.to + 1) / 2, -2.2);
    if (p.x < -200 || p.x > w + 200) continue;
    label3(ctx, z.name, p.x, p.y, Math.max(11, Math.min(18, v.scale * 4)), `hsl(${z.hue} 90% 78%)`);
  }

  // selected cell
  if (opts.selected != null) {
    const p = at(opts.selected % COLS, Math.floor(opts.selected / COLS));
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

function label3(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, fill = "#fff") {
  ctx.font = `700 ${Math.round(size)}px Inter, system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(10,20,40,0.75)";
  ctx.strokeText(text, x, y);
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
}
