/**
 * The seats of the Commonwealth on the First Light plaza, around the tower.
 * Tapping one on the map opens its chamber, where the open votes are.
 * Positions are world tiles relative to the tower, so they turn with the map.
 */
import { TH, TW } from "./renderer";

export type CivicId = "assembly" | "council" | "directorate" | "mayors" | "bank";

export interface CivicBuilding {
  id: CivicId;
  /** Offset from the tower tile, in world tiles (on the plaza ring). */
  dx: number;
  dy: number;
}

export const CIVIC: CivicBuilding[] = [
  { id: "council", dx: -3, dy: 0 },
  { id: "assembly", dx: 3, dy: 0 },
  { id: "directorate", dx: 0, dy: 3 },
  { id: "mayors", dx: 0, dy: -3 },
  // Bank of First Light: next to the Directorate (decision of 2026-11-24)
  { id: "bank", dx: 3, dy: 3 },
];

/** Footprint in tiles: wider than one tile, it still stays on the plaza. */
const FOOT = 1.7;

const face = (ctx: CanvasRenderingContext2D, pts: [number, number][], fill: string) => {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (const [x, y] of pts.slice(1)) ctx.lineTo(x, y);
  ctx.closePath();
  ctx.fill();
};

/** An isometric block: ground centre (px, py), half sizes a (x) and c (y), height h, lifted by lift. */
const block = (ctx: CanvasRenderingContext2D, px: number, py: number, a: number, c: number, h: number, colors: [string, string, string], lift = 0) => {
  const b = py - lift;
  const t = b - h;
  face(ctx, [[px - a, b], [px, b + c], [px, t + c], [px - a, t]], colors[0]);
  face(ctx, [[px + a, b], [px, b + c], [px, t + c], [px + a, t]], colors[1]);
  face(ctx, [[px - a, t], [px, t - c], [px + a, t], [px, t + c]], colors[2]);
  return t;
};

/** Columns along both visible faces. */
const columns = (ctx: CanvasRenderingContext2D, px: number, py: number, a: number, c: number, h: number, n: number, color: string) => {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  for (let k = 1; k < n; k++) {
    const f = k / n;
    for (const s of [-1, 1]) {
      const x = px + s * a * (1 - f);
      const y = py + c * f;
      ctx.moveTo(x, y);
      ctx.lineTo(x, y - h);
    }
  }
  ctx.stroke();
};

/** Draws one seat of government standing on the ground point (px, py). */
export function drawCivic(ctx: CanvasRenderingContext2D, id: CivicId, px: number, py: number, night: boolean, selected: boolean, busy: boolean) {
  const a = (TW / 2) * FOOT;
  const c = (TH / 2) * FOOT;
  const stone: [string, string, string] = night ? ["#5a6488", "#434c6e", "#78829f"] : ["#f1ede4", "#d9d2c2", "#fbf8f1"];
  const glow = night ? "rgba(255,226,150,0.95)" : "rgba(255,255,255,0.0)";
  // plinth
  block(ctx, px, py, a, c, 3, night ? ["#3f4766", "#2f3651", "#59618a"] : ["#d6cfbf", "#bfb7a5", "#e8e2d4"]);
  if (id === "assembly") {
    // a wide hall with columns and a glass dome
    const top = block(ctx, px, py, a * 0.92, c * 0.92, 15, stone, 3);
    columns(ctx, px, py - 3, a * 0.92, c * 0.92, 15, 6, night ? "rgba(255,226,150,0.6)" : "rgba(120,110,90,0.45)");
    const r = a * 0.5;
    const g = ctx.createRadialGradient(px - r * 0.3, top - r * 0.5, 1, px, top, r * 1.2);
    g.addColorStop(0, night ? "#bfefff" : "#e8fbff");
    g.addColorStop(1, night ? "#3d7bb8" : "#5ab6dc");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(px, top, r, r * 0.5, 0, Math.PI, 0);
    ctx.arc(px, top, r, 0, Math.PI, true);
    ctx.fill();
    ctx.fillStyle = night ? "#ffe9a8" : "#d9b45a";
    ctx.fillRect(px - 0.8, top - r - 6, 1.6, 6);
  } else if (id === "council") {
    // a crown-topped spire, gold
    block(ctx, px, py, a * 0.8, c * 0.8, 12, stone, 3);
    columns(ctx, px, py - 3, a * 0.8, c * 0.8, 12, 5, night ? "rgba(255,226,150,0.6)" : "rgba(120,110,90,0.45)");
    const gold: [string, string, string] = night ? ["#b08a2c", "#8a6a1e", "#e3c25c"] : ["#e9c25a", "#c99d33", "#ffe08a"];
    const t2 = block(ctx, px, py - 15, a * 0.42, c * 0.42, 22, gold);
    ctx.fillStyle = gold[2];
    ctx.beginPath();
    ctx.moveTo(px - a * 0.42, t2);
    for (let k = 0; k <= 4; k++) ctx.lineTo(px - a * 0.42 + (k * a * 0.84) / 4, t2 - (k % 2 === 0 ? 7 : 3));
    ctx.lineTo(px + a * 0.42, t2);
    ctx.closePath();
    ctx.fill();
  } else if (id === "directorate") {
    // a glass office block of the government
    const glass: [string, string, string] = night ? ["#2d4f86", "#1f3966", "#4d75b3"] : ["#9cc8ea", "#76a6cf", "#c6e3f7"];
    block(ctx, px, py, a * 0.75, c * 0.75, 30, glass, 3);
    ctx.strokeStyle = night ? "rgba(255,226,150,0.55)" : "rgba(255,255,255,0.6)";
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    for (let f = 1; f < 8; f++) {
      const y = py - 3 - (30 * f) / 8;
      ctx.moveTo(px - a * 0.75, y);
      ctx.lineTo(px, y + c * 0.75);
      ctx.lineTo(px + a * 0.75, y);
    }
    ctx.stroke();
  } else if (id === "bank") {
    // Bank of First Light: a marble temple with columns, a pediment and a gold coin
    const top = block(ctx, px, py, a * 0.82, c * 0.82, 14, stone, 3);
    columns(ctx, px, py - 3, a * 0.82, c * 0.82, 14, 6, night ? "rgba(255,226,150,0.7)" : "rgba(120,110,90,0.5)");
    const roof = night ? "#8a7a52" : "#cdb27a";
    ctx.fillStyle = roof;
    ctx.beginPath();
    ctx.moveTo(px - a * 0.86, top);
    ctx.lineTo(px, top - 9);
    ctx.lineTo(px + a * 0.86, top);
    ctx.lineTo(px, top + c * 0.82);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = night ? "#ffe08a" : "#e9b93a";
    ctx.beginPath();
    ctx.arc(px, top - 4, 2.6, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // the hall of the districts: low with a clock tower
    block(ctx, px, py, a * 0.9, c * 0.6, 10, stone, 3);
    const t2 = block(ctx, px + a * 0.35, py - 1, a * 0.22, c * 0.22, 26, stone, 3);
    ctx.fillStyle = night ? "#ffe9a8" : "#2b3a55";
    ctx.beginPath();
    ctx.arc(px + a * 0.25, t2 + 6, 2.2, 0, Math.PI * 2);
    ctx.fill();
  }
  if (night) {
    ctx.fillStyle = glow;
    ctx.fillRect(px - 1.5, py - 8, 3, 4);
  }
  if (busy) {
    // a light on the roof while there are open votes
    ctx.fillStyle = night ? "rgba(120,255,200,0.95)" : "rgba(20,190,130,0.95)";
    ctx.beginPath();
    ctx.arc(px, py - (id === "directorate" ? 40 : id === "council" ? 48 : 36), 2.4, 0, Math.PI * 2);
    ctx.fill();
  }
  if (selected) {
    ctx.strokeStyle = "rgba(160,250,255,0.95)";
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(px - a - 2, py);
    ctx.lineTo(px, py + c + 1);
    ctx.lineTo(px + a + 2, py);
    ctx.lineTo(px, py - c - 1);
    ctx.closePath();
    ctx.stroke();
  }
}

/** Rough screen box of a civic building around its ground point, at scale 1. */
export const civicHit = (wx: number, wy: number, px: number, py: number) =>
  Math.abs(wx - px) < (TW / 2) * FOOT && wy < py + (TH / 2) * FOOT && wy > py - 50;
