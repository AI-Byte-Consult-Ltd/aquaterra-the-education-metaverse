/**
 * Farms on the world map: what grows on each plot, drawn on its tiles.
 * Land fields show tilled rows that sprout, grow, ripen in the crop's colour and wilt;
 * sea farms show net pens on buoys, with fish or shells showing as they grow.
 */

/** One field on the map: crop, planted and ripe times (unix seconds). */
export interface MapField {
  crop: string;
  planted: number;
  ready: number;
}

export type FieldStage = "sprout" | "growing" | "ripe" | "wilted";

/** Growth 0..1 and the stage of a field at `now` (unix seconds). */
export function fieldStage(f: MapField, now: number, wiltHours: number): { grow: number; stage: FieldStage } {
  const span = Math.max(1, f.ready - f.planted);
  const grow = Math.min(1, Math.max(0, (now - f.planted) / span));
  if (now >= f.ready + wiltHours * 3600) return { grow: 1, stage: "wilted" };
  if (now >= f.ready) return { grow: 1, stage: "ripe" };
  return { grow, stage: grow < 0.25 ? "sprout" : "growing" };
}

/** Colour of the ripe crop: flowers, fruit, berries, grain, leaves. */
const RIPE: Record<string, string> = {
  rose: "#e0284a",
  tulip: "#ff6fa8",
  sunflower: "#ffcc1f",
  lavender: "#a07be6",
  strawberry: "#ff3b3b",
  grape: "#7b3fa8",
  apple: "#e8402c",
  orange: "#ff9a1f",
  carrot: "#ff8a24",
  potato: "#c9a66b",
  tomato: "#f0412e",
  pumpkin: "#ff8f1a",
  wheat: "#e9c25a",
  tea: "#2f8f4a",
  coffee: "#b3262e",
  mussel: "#3a3f66",
  shrimp: "#ff8a7a",
  fish: "#c8d8e6",
};

/** Crops that grow as bushes or small trees rather than low rows. */
const BUSH = new Set(["apple", "orange", "grape", "tea", "coffee"]);

const SOIL = "rgba(108,72,44,0.78)";
const FURROW = "rgba(70,44,26,0.55)";
const LEAF = ["#6fbf4a", "#4fa83c", "#3d8f34"];
const DRY = "#9c8a5a";

/**
 * Draw the field on one tile. (px, py) is the top corner of the tile's diamond,
 * tw and th its width and height, i the world tile (for a steady jitter).
 */
export function drawFieldTile(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  tw: number,
  th: number,
  i: number,
  f: MapField,
  stage: { grow: number; stage: FieldStage },
  water: boolean,
  night: boolean,
  time: number,
) {
  const hw = tw / 2;
  const hh = th / 2;
  // a point inside the diamond at (u, v) in 0..1
  const P = (u: number, v: number) => ({ x: px + (u - v) * hw, y: py + (u + v) * hh });
  const dim = night ? 0.65 : 1;
  ctx.save();
  ctx.globalAlpha = dim;
  if (water) drawPen(ctx, P, i, f, stage, time);
  else drawRows(ctx, P, i, f, stage);
  ctx.restore();
}

function drawRows(ctx: CanvasRenderingContext2D, P: (u: number, v: number) => { x: number; y: number }, i: number, f: MapField, s: { grow: number; stage: FieldStage }) {
  // tilled soil, inset a little so the plot border still shows
  const a = P(0.06, 0.06), b = P(0.94, 0.06), c = P(0.94, 0.94), d = P(0.06, 0.94);
  ctx.fillStyle = SOIL;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.lineTo(c.x, c.y);
  ctx.lineTo(d.x, d.y);
  ctx.closePath();
  ctx.fill();
  // furrows along u
  ctx.strokeStyle = FURROW;
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  for (const v of [0.25, 0.5, 0.75]) {
    const p0 = P(0.1, v), p1 = P(0.9, v);
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
  }
  ctx.stroke();
  const ripe = RIPE[f.crop] ?? "#e0c050";
  const bush = BUSH.has(f.crop);
  const wheat = f.crop === "wheat";
  const h = (bush ? 7 : wheat ? 5 : 3.6) * (0.25 + 0.75 * s.grow);
  const jit = ((i * 2654435761) >>> 0) % 5;
  const rows = bush ? [0.3, 0.7] : [0.25, 0.5, 0.75];
  const cols = bush ? [0.3, 0.7] : [0.18, 0.42, 0.66, 0.88];
  for (let r = 0; r < rows.length; r++) {
    for (let k = 0; k < cols.length; k++) {
      const q = P(cols[k] + ((jit + k) % 3) * 0.015, rows[r]);
      const leaf = s.stage === "wilted" ? DRY : LEAF[(jit + r + k) % LEAF.length];
      if (s.stage === "sprout") {
        ctx.fillStyle = leaf;
        ctx.fillRect(q.x - 0.6, q.y - 1.6, 1.2, 1.6);
        continue;
      }
      if (wheat) {
        // stalks that turn golden
        ctx.strokeStyle = s.stage === "ripe" ? ripe : s.stage === "wilted" ? DRY : leaf;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (const dx of [-1.2, 0, 1.2]) {
          ctx.moveTo(q.x + dx, q.y);
          ctx.lineTo(q.x + dx * 1.3, q.y - h);
        }
        ctx.stroke();
        continue;
      }
      // a stem and a leafy crown
      ctx.strokeStyle = leaf;
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(q.x, q.y);
      ctx.lineTo(q.x, q.y - h * 0.6);
      ctx.stroke();
      ctx.fillStyle = leaf;
      ctx.beginPath();
      ctx.ellipse(q.x, q.y - h * 0.7, (bush ? 3.2 : 1.8) * (0.4 + 0.6 * s.grow), (bush ? 2.6 : 1.3) * (0.4 + 0.6 * s.grow), 0, 0, Math.PI * 2);
      ctx.fill();
      // flowers and fruit show their colour as they ripen
      if (s.stage === "ripe" || (s.stage === "growing" && s.grow > 0.7)) {
        ctx.fillStyle = s.stage === "ripe" ? ripe : shadeHex(ripe, 0.55);
        const dots = bush ? 3 : 1;
        for (let t = 0; t < dots; t++) {
          const ox = bush ? [-1.6, 1.4, 0][t] : 0;
          const oy = bush ? [0, 0.4, -1.4][t] : 0;
          ctx.beginPath();
          ctx.arc(q.x + ox, q.y - h * 0.8 + oy, bush ? 0.9 : 1.2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }
}

function drawPen(ctx: CanvasRenderingContext2D, P: (u: number, v: number) => { x: number; y: number }, i: number, f: MapField, s: { grow: number; stage: FieldStage }, time: number) {
  const jit = ((i * 2654435761) >>> 0) % 7;
  // a round net pen in the middle of the tile, with a floating ring
  const c = P(0.5, 0.5);
  const rx = P(0.85, 0.5).x - c.x;
  const ry = P(0.5, 0.85).y - c.y;
  ctx.fillStyle = "rgba(20,60,90,0.35)";
  ctx.beginPath();
  ctx.ellipse(c.x, c.y, rx, ry * 0.9, 0, 0, Math.PI * 2);
  ctx.fill();
  // net mesh
  ctx.strokeStyle = "rgba(230,240,250,0.35)";
  ctx.lineWidth = 0.4;
  ctx.beginPath();
  for (const t of [-0.5, 0, 0.5]) {
    ctx.moveTo(c.x + t * rx, c.y - ry * 0.85 * Math.sqrt(1 - t * t));
    ctx.lineTo(c.x + t * rx, c.y + ry * 0.85 * Math.sqrt(1 - t * t));
  }
  ctx.stroke();
  ctx.strokeStyle = "rgba(240,240,235,0.9)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.ellipse(c.x, c.y, rx, ry * 0.9, 0, 0, Math.PI * 2);
  ctx.stroke();
  // what grows inside
  const col = s.stage === "wilted" ? "#7a7a6a" : RIPE[f.crop] ?? "#c8d8e6";
  const count = s.stage === "sprout" ? 2 : 2 + Math.round(s.grow * 4);
  const size = 0.5 + 0.9 * s.grow;
  for (let k = 0; k < count; k++) {
    const ang = (k / count) * Math.PI * 2 + (f.crop === "fish" ? time / 1600 : 0) + jit;
    const x = c.x + Math.cos(ang) * rx * 0.5;
    const y = c.y + Math.sin(ang) * ry * 0.45;
    ctx.fillStyle = col;
    ctx.beginPath();
    if (f.crop === "mussel") ctx.ellipse(x, y, 1.2 * size, 0.7 * size, 0.6, 0, Math.PI * 2);
    else if (f.crop === "shrimp") ctx.arc(x, y, 0.9 * size, Math.PI * 0.2, Math.PI * 1.6);
    else ctx.ellipse(x, y, 1.5 * size, 0.6 * size, ang + Math.PI / 2, 0, Math.PI * 2);
    ctx.fill();
  }
  // buoys: orange when growing, green when ripe, grey when wilting
  const buoy = s.stage === "ripe" ? "#3ee07a" : s.stage === "wilted" ? "#9a9a9a" : "#ff8a1f";
  ctx.fillStyle = buoy;
  for (const [u, v] of [[0.15, 0.5], [0.85, 0.5], [0.5, 0.15], [0.5, 0.85]]) {
    const b = P(u, v);
    ctx.beginPath();
    ctx.arc(b.x, b.y - 0.8, 1.1, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Flat colour of a field seen from afar. */
export function fieldTint(crop: string, stage: FieldStage, water: boolean): string {
  if (water) return stage === "ripe" ? "rgba(62,224,122,0.35)" : "rgba(255,138,31,0.3)";
  if (stage === "sprout") return "rgba(108,72,44,0.6)";
  if (stage === "wilted") return "rgba(156,138,90,0.6)";
  if (stage === "ripe") return hexA(RIPE[crop] ?? "#e0c050", 0.6);
  return "rgba(79,168,60,0.6)";
}

function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function shadeHex(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * k + 80 * (1 - k));
  const g = Math.round(((n >> 8) & 255) * k + 140 * (1 - k));
  const b = Math.round((n & 255) * k + 60 * (1 - k));
  return `rgb(${r},${g},${b})`;
}
