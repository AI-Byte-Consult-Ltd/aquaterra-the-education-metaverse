/**
 * Draws Prism Hills: one pixel per parcel, rolling hills with contour lines, a ragged
 * coast and a deep harbour bay on the west, towards Rainbowland. No houses: plots that
 * came home take the colour of their size.
 */
import { PRISM_COLS as COLS, PRISM_ROWS as ROWS, prismAt, prismSize, prismX, prismY } from "./prism";
import { label3, mix, noise, type View } from "./render";

export const PPAD = 64;
export const PIMG_W = COLS + PPAD * 2;
export const PIMG_H = ROWS + PPAD * 2;
/** The harbour bay cuts into the west coast at this row. */
export const BAY_ROW = 150;

export const SIZE_COLOR: Record<1 | 2 | 3, [number, number, number]> = {
  1: [40, 196, 160],
  2: [146, 100, 240],
  3: [250, 184, 50],
};

/** Smooth height of the hills, 0..1, and a little grain on top. */
const hills = (c: number, r: number) => noise(c / 42, r / 42) * 0.65 + noise(c / 14 + 40, r / 14) * 0.35;
const grain = (c: number, r: number) => noise(c / 2.5, r / 2.5 + 9);

/** How far land reaches past the parcels here, in cells: ragged, with bays and the deep harbour bay on the west. */
function coastReach(c: number, r: number) {
  let reach = 6 + noise(c / 26 + 3, r / 26) * 46 + noise(c / 8, r / 8) * 8 + noise(c / 2.5, r / 2.5) * 2;
  // the harbour: a long ragged inlet reaching the parcels on the west
  if (c < 0 && Math.abs(r - BAY_ROW) < 10 + noise(c / 5, 7) * 8) reach = 0.4;
  return reach;
}

export function drawPrismBase(claimed: Set<number>, mine: Set<number>): HTMLCanvasElement {
  const cv = document.createElement("canvas");
  cv.width = PIMG_W;
  cv.height = PIMG_H;
  const ctx = cv.getContext("2d")!;
  const img = ctx.createImageData(PIMG_W, PIMG_H);
  const px = img.data;
  const low: number[] = [140, 180, 104], high: number[] = [214, 204, 150];
  for (let iy = 0; iy < PIMG_H; iy++)
    for (let ix = 0; ix < PIMG_W; ix++) {
      const o = (iy * PIMG_W + ix) * 4;
      const c = ix - PPAD, r = iy - PPAD;
      const t = prismAt(c, r);
      const dx = c < 0 ? -c : c >= COLS ? c - COLS + 1 : 0;
      const dy = r < 0 ? -r : r >= ROWS ? r - ROWS + 1 : 0;
      const d = Math.hypot(dx, dy);
      const reach = t != null ? Infinity : coastReach(c, r);
      let rgb: number[];
      if (d <= reach) {
        const hgt = hills(c, r);
        // light from the north-west, contour lines between height bands
        const shade = (hills(c - 1, r - 1) - hills(c + 1, r + 1)) * 9;
        const level = Math.floor(hgt * 12);
        const contour = level !== Math.floor(hills(c + 1, r) * 12) || level !== Math.floor(hills(c, r + 1) * 12);
        rgb = mix(low, high, Math.min(1, Math.max(0, hgt * 1.25 - 0.1)));
        rgb = shade > 0 ? mix(rgb, [255, 250, 230], Math.min(0.35, shade)) : mix(rgb, [40, 60, 40], Math.min(0.3, -shade));
        rgb = mix(rgb, [255, 255, 255], grain(c, r) * 0.06);
        if (t != null && claimed.has(t)) {
          rgb = mix(rgb, SIZE_COLOR[prismSize(t)], 0.75);
          if (mine.has(t)) rgb = mix(rgb, [255, 255, 255], 0.3);
        } else if (contour) rgb = mix(rgb, [70, 84, 56], 0.3);
        if (t == null && d > reach - 1.6) rgb = [234, 220, 172]; // beach
      } else {
        const deep = Math.min(1, (d - reach) / 16);
        rgb = mix([90, 200, 210], [20, 70, 124], deep);
        rgb = mix(rgb, [255, 255, 255], noise(ix / 4, iy / 4) * 0.06);
      }
      px[o] = rgb[0];
      px[o + 1] = rgb[1];
      px[o + 2] = rgb[2];
      px[o + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  return cv;
}

export const prismAtImage = (x: number, y: number) => prismAt(Math.floor(x) - PPAD, Math.floor(y) - PPAD);
export const PRISM_HARBOUR = { c: -3, r: BAY_ROW };
export const PRISM_STATION = { c: 3, r: BAY_ROW - 30 };

export function drawPrismScene(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  base: HTMLCanvasElement,
  v: View,
  opts: { selected: number | null; labels: { harbour: string; station: string; causeway: string } },
) {
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = "#14466f";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(base, -v.ox * v.scale, -v.oy * v.scale, PIMG_W * v.scale, PIMG_H * v.scale);
  const at = (c: number, r: number) => ({ x: (c + PPAD - v.ox) * v.scale, y: (r + PPAD - v.oy) * v.scale });

  // the causeway west to Rainbowland, from the station row
  const s0 = at(-PPAD, PRISM_STATION.r + 0.5), s1 = at(PRISM_STATION.c, PRISM_STATION.r + 0.5);
  ctx.strokeStyle = "rgba(255,255,255,0.85)";
  ctx.lineWidth = Math.max(2, v.scale * 0.8);
  ctx.setLineDash([Math.max(4, v.scale * 2), Math.max(3, v.scale)]);
  ctx.beginPath();
  ctx.moveTo(s0.x - 40, s0.y);
  ctx.lineTo(s1.x, s1.y);
  ctx.stroke();
  ctx.setLineDash([]);

  if (v.scale >= 9) {
    ctx.strokeStyle = "rgba(20,40,30,0.16)";
    ctx.lineWidth = 1;
    const c0 = Math.max(0, Math.floor(v.ox - PPAD)), c1 = Math.min(COLS, Math.ceil(v.ox - PPAD + w / v.scale));
    const r0 = Math.max(0, Math.floor(v.oy - PPAD)), r1 = Math.min(ROWS, Math.ceil(v.oy - PPAD + h / v.scale));
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
  }

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
    if (v.scale >= 1.5) label3(ctx, label, p.x, p.y - rad - 8, 12);
  };
  mark(PRISM_HARBOUR.c, PRISM_HARBOUR.r, "#0e7490", opts.labels.harbour, "⚓");
  mark(PRISM_STATION.c, PRISM_STATION.r, "#7c3aed", opts.labels.station, "🚆");
  if (s0.x > -200) {
    ctx.font = "700 12px Inter, system-ui, sans-serif";
    const half = ctx.measureText(opts.labels.causeway).width / 2 + 8;
    label3(ctx, opts.labels.causeway, Math.max(half, s0.x + (s1.x - s0.x) * 0.3), s0.y - 14, 12);
  }

  if (opts.selected != null) {
    const p = at(prismX(opts.selected), prismY(opts.selected));
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
