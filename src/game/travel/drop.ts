/**
 * The resident's marker on the map: a glowing drop of water and light in the
 * resident's own colour, and the animation of a trip along its route.
 */
import type { Mode } from "./network";

export interface Point {
  x: number;
  y: number;
}

export interface TripSegment {
  mode: Mode;
  /** World tile coordinates (centres of tiles are x + 0.5). */
  pts: Point[];
  seconds: number;
}

/** A colour of its own for each resident, from the email: hue 0..360. */
export function dropHue(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  // keep away from the reds of other owners' land and the amber of one's own
  const hues = [175, 190, 205, 220, 260, 285, 310, 140, 160];
  return hues[(h >>> 0) % hues.length];
}

/** Position along a polyline at share t (0..1) of its length. */
export function along(pts: Point[], t: number): Point {
  if (pts.length === 1) return pts[0];
  let total = 0;
  const seg: number[] = [];
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    seg.push(d);
    total += d;
  }
  if (total === 0) return pts[pts.length - 1];
  let left = Math.max(0, Math.min(1, t)) * total;
  for (let i = 0; i < seg.length; i++) {
    if (left <= seg[i] || i === seg.length - 1) {
      const k = seg[i] ? Math.min(1, left / seg[i]) : 1;
      return { x: pts[i].x + (pts[i + 1].x - pts[i].x) * k, y: pts[i].y + (pts[i + 1].y - pts[i].y) * k };
    }
    left -= seg[i];
  }
  return pts[pts.length - 1];
}

/** Tile indices of a path to points, thinned so the line stays smooth. */
export function pathPoints(tiles: number[], n: number, step = 2): Point[] {
  const out: Point[] = [];
  for (let k = 0; k < tiles.length; k++) {
    if (k % step && k !== tiles.length - 1) continue;
    const i = tiles[k];
    out.push({ x: i % n, y: Math.floor(i / n) });
  }
  return out;
}

const ease = (p: number) => (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2);

/** Plays a trip: where the drop is at a moment, how high it flies, the line still ahead. */
export class TripPlayer {
  private start = -1;
  private total: number;
  done = false;

  constructor(
    private segments: TripSegment[],
    private onDone: () => void,
  ) {
    this.total = segments.reduce((s, g) => s + g.seconds, 0) * 1000;
  }

  /** State at time (ms, performance clock). */
  at(time: number): { pos: Point; lift: number; mode: Mode; ahead: Point[] } {
    if (this.start < 0) this.start = time;
    let left = time - this.start;
    for (let k = 0; k < this.segments.length; k++) {
      const g = this.segments[k];
      const ms = g.seconds * 1000;
      if (left <= ms || k === this.segments.length - 1) {
        const p = Math.min(1, ms ? left / ms : 1);
        const e = g.mode === "walk" ? p : ease(p);
        const pos = along(g.pts, e);
        const lift = g.mode === "plane" ? Math.sin(Math.PI * e) : 0;
        if (k === this.segments.length - 1 && p >= 1 && !this.done) {
          this.done = true;
          queueMicrotask(this.onDone);
        }
        const ahead = [pos, ...this.rest(g.pts, e), ...this.segments.slice(k + 1).flatMap((s) => s.pts)];
        return { pos, lift, mode: g.mode, ahead };
      }
      left -= ms;
    }
    const last = this.segments[this.segments.length - 1];
    return { pos: last.pts[last.pts.length - 1], lift: 0, mode: last.mode, ahead: [] };
  }

  get seconds() {
    return this.total / 1000;
  }

  private rest(pts: Point[], t: number): Point[] {
    // the points of a segment still ahead of share t
    let total = 0;
    const cum = [0];
    for (let i = 1; i < pts.length; i++) {
      total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      cum.push(total);
    }
    return pts.filter((_, i) => cum[i] > t * total);
  }
}

/**
 * Draw the drop standing on screen point (px, py) of a canvas in world
 * transform with zoom `scale`. It keeps about the same size on screen at any
 * zoom. `lift` 0..1 raises it into the air (a flight).
 */
export function drawDrop(ctx: CanvasRenderingContext2D, px: number, py: number, scale: number, hue: number, time: number, lift = 0, label?: string) {
  const k = 1 / scale;
  const size = Math.max(14, Math.min(26, 12 + 7 * scale)) * k;
  const r = size * 0.62;
  const float = (Math.sin(time / 520) * 0.12 + 0.12) * size + lift * 70 * k;
  const cx = px;
  const cy = py - r - size * 0.35 - float;
  // ground: soft shadow and a ring that spreads like a ripple
  ctx.save();
  ctx.fillStyle = `rgba(0,0,0,${0.28 - lift * 0.15})`;
  ctx.beginPath();
  ctx.ellipse(px, py, r * (1 - lift * 0.3), r * 0.42 * (1 - lift * 0.3), 0, 0, Math.PI * 2);
  ctx.fill();
  const ripple = (time % 2200) / 2200;
  ctx.strokeStyle = `hsla(${hue},95%,70%,${(1 - ripple) * 0.8})`;
  ctx.lineWidth = 2 * k;
  ctx.beginPath();
  ctx.ellipse(px, py, r * (0.8 + ripple * 2.4), r * 0.45 * (0.8 + ripple * 2.4), 0, 0, Math.PI * 2);
  ctx.stroke();
  // glow
  const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, size * 2.6);
  glow.addColorStop(0, `hsla(${hue},100%,75%,0.55)`);
  glow.addColorStop(1, `hsla(${hue},100%,60%,0)`);
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(cx, cy, size * 2.6, 0, Math.PI * 2);
  ctx.fill();
  // the drop: round below, pointed above
  const tip = cy - r * 2.05;
  ctx.beginPath();
  ctx.moveTo(cx, tip);
  ctx.bezierCurveTo(cx + r * 0.35, cy - r * 1.35, cx + r, cy - r * 0.75, cx + r, cy);
  ctx.arc(cx, cy, r, 0, Math.PI);
  ctx.bezierCurveTo(cx - r, cy - r * 0.75, cx - r * 0.35, cy - r * 1.35, cx, tip);
  ctx.closePath();
  const body = ctx.createLinearGradient(cx - r, tip, cx + r, cy + r);
  body.addColorStop(0, `hsl(${hue},100%,88%)`);
  body.addColorStop(0.45, `hsl(${hue},95%,62%)`);
  body.addColorStop(1, `hsl(${hue},90%,38%)`);
  ctx.fillStyle = body;
  ctx.shadowColor = `hsla(${hue},100%,70%,0.9)`;
  ctx.shadowBlur = 14 * k * scale;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "rgba(255,255,255,0.85)";
  ctx.lineWidth = 1.2 * k;
  ctx.stroke();
  // light inside: a bright core and a highlight
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.beginPath();
  ctx.ellipse(cx - r * 0.38, cy - r * 0.45, r * 0.18, r * 0.32, -0.5, 0, Math.PI * 2);
  ctx.fill();
  const core = ctx.createRadialGradient(cx, cy + r * 0.1, 0, cx, cy + r * 0.1, r * 0.7);
  core.addColorStop(0, "rgba(255,255,255,0.95)");
  core.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(cx, cy + r * 0.1, r * 0.7, 0, Math.PI * 2);
  ctx.fill();
  if (label) {
    ctx.font = `700 ${11 * k}px Inter, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const w = ctx.measureText(label).width + 10 * k;
    const ly = tip - 11 * k;
    ctx.fillStyle = "rgba(8,16,36,0.82)";
    ctx.beginPath();
    ctx.roundRect(cx - w / 2, ly - 8 * k, w, 16 * k, 8 * k);
    ctx.fill();
    ctx.fillStyle = `hsl(${hue},100%,85%)`;
    ctx.fillText(label, cx, ly + 0.5 * k);
  }
  ctx.restore();
}

/** The route still ahead: a glowing dashed line in the resident's colour. */
export function drawTrail(ctx: CanvasRenderingContext2D, pts: { px: number; py: number }[], scale: number, hue: number, time: number) {
  if (pts.length < 2) return;
  const k = 1 / scale;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = `hsla(${hue},100%,70%,0.25)`;
  ctx.lineWidth = 7 * k;
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p.px, p.py) : ctx.moveTo(p.px, p.py)));
  ctx.stroke();
  ctx.strokeStyle = `hsla(${hue},100%,85%,0.95)`;
  ctx.lineWidth = 2.2 * k;
  ctx.setLineDash([6 * k, 6 * k]);
  ctx.lineDashOffset = (-time / 40) * k;
  ctx.stroke();
  ctx.restore();
}
