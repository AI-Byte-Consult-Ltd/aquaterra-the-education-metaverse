/**
 * Residents' avatars: small original characters of light drawn on the canvas,
 * in the resident's own colour. "drop" is the classic glowing drop of water.
 * Heads are a pale tint of the resident's colour (beings of light), so no one
 * is asked to pick a skin.
 */
import { drawDrop } from "../travel/drop";

export const AVATAR_STYLES = ["drop", "explorer", "builder", "sailor", "scholar", "pilot", "diver", "robot", "astronaut", "wisp"] as const;
export type AvatarStyle = (typeof AVATAR_STYLES)[number];

/** Colours on offer: away from the reds of other owners' land and the amber of one's own. */
export const AVATAR_HUES = [175, 190, 205, 220, 260, 285, 310, 140, 160, 95, 330, 20] as const;

export interface Avatar {
  style: AvatarStyle;
  hue: number;
}

export const isStyle = (s: unknown): s is AvatarStyle => typeof s === "string" && (AVATAR_STYLES as readonly string[]).includes(s);

export interface AvatarDrawOptions {
  label?: string;
  /** 0..1: raised into the air (a flight). */
  lift?: number;
  /** Seen in the last minutes: a soft pulse at the feet. */
  online?: boolean;
  /** Away (not online): drawn quieter. */
  dim?: boolean;
  /** 0..1 size against one's own avatar. */
  size?: number;
  /** Phase of the idle animation, so a crowd does not move in step. */
  phase?: number;
}

const rr = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
};

/**
 * Draw an avatar standing on screen point (px, py) of a canvas in world transform
 * with zoom `scale`. It keeps about the same size on screen at any zoom.
 */
export function drawAvatar(ctx: CanvasRenderingContext2D, px: number, py: number, scale: number, av: Avatar, time: number, o: AvatarDrawOptions = {}) {
  const lift = o.lift ?? 0;
  const k = 1 / scale;
  const sizeK = o.size ?? 1;
  if (av.style === "drop" || !isStyle(av.style)) {
    if (o.dim) ctx.globalAlpha = 0.6;
    drawDropSized(ctx, px, py, scale, av.hue, time + (o.phase ?? 0) * 1000, lift, o.label, sizeK);
    ctx.globalAlpha = 1;
    return;
  }
  const hue = av.hue;
  const t = time + (o.phase ?? 0) * 1000;
  // one unit: a figure is about 30 units tall, ~ as tall as the drop on screen
  const u = (Math.max(14, Math.min(26, 12 + 7 * scale)) * k * sizeK) / 15;
  const bob = Math.abs(Math.sin(t / 380)) * 1.2 * u;
  const float = lift * 70 * k;
  ctx.save();
  if (o.dim) ctx.globalAlpha = 0.62;
  // ground: shadow, and a ripple when online
  ctx.fillStyle = `rgba(0,0,0,${0.3 - lift * 0.15})`;
  ctx.beginPath();
  ctx.ellipse(px, py, 7 * u, 2.8 * u, 0, 0, Math.PI * 2);
  ctx.fill();
  if (o.online || o.label) {
    const ripple = (t % 2200) / 2200;
    ctx.strokeStyle = `hsla(${hue},95%,70%,${(1 - ripple) * 0.75})`;
    ctx.lineWidth = 1.6 * k;
    ctx.beginPath();
    ctx.ellipse(px, py, (6 + ripple * 12) * u, (2.4 + ripple * 5) * u, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  const base = py - float;
  const x = px;
  const glow = ctx.createRadialGradient(x, base - 14 * u, 0, x, base - 14 * u, 22 * u);
  glow.addColorStop(0, `hsla(${hue},100%,70%,0.4)`);
  glow.addColorStop(1, `hsla(${hue},100%,60%,0)`);
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(x, base - 14 * u, 22 * u, 0, Math.PI * 2);
  ctx.fill();

  const suit = av.style === "astronaut" ? "#eef2f7" : av.style === "robot" ? `hsl(${hue},18%,62%)` : `hsl(${hue},80%,52%)`;
  const suitDark = av.style === "astronaut" ? "#b8c2cf" : av.style === "robot" ? `hsl(${hue},18%,40%)` : `hsl(${hue},80%,34%)`;
  const head = `hsl(${hue},45%,88%)`;
  const ink = "rgba(10,18,36,0.9)";
  const outline = () => {
    ctx.strokeStyle = "rgba(255,255,255,0.75)";
    ctx.lineWidth = 0.9 * k;
    ctx.stroke();
  };

  if (av.style === "wisp") {
    // a spirit of light: a flame that floats, with two eyes
    const fy = base - 6 * u - Math.sin(t / 500) * 2 * u;
    const flick = Math.sin(t / 140) * 1.2 * u;
    ctx.beginPath();
    ctx.moveTo(x + flick, fy - 26 * u);
    ctx.bezierCurveTo(x + 9 * u, fy - 16 * u, x + 10 * u, fy - 4 * u, x, fy);
    ctx.bezierCurveTo(x - 10 * u, fy - 4 * u, x - 9 * u, fy - 16 * u, x + flick, fy - 26 * u);
    const g = ctx.createLinearGradient(x, fy - 26 * u, x, fy);
    g.addColorStop(0, `hsla(${hue},100%,85%,0.95)`);
    g.addColorStop(1, `hsl(${hue},95%,50%)`);
    ctx.fillStyle = g;
    ctx.shadowColor = `hsla(${hue},100%,70%,0.9)`;
    ctx.shadowBlur = 12 * k * scale;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.beginPath();
    ctx.arc(x, fy - 6 * u, 4.2 * u, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = ink;
    ctx.beginPath();
    ctx.arc(x - 2.4 * u, fy - 9 * u, 1.1 * u, 0, Math.PI * 2);
    ctx.arc(x + 2.4 * u, fy - 9 * u, 1.1 * u, 0, Math.PI * 2);
    ctx.fill();
    label(ctx, x, fy - 30 * u, k, hue, o.label);
    ctx.restore();
    return;
  }

  // back gear: drawn behind the body
  const by = base - bob;
  if (av.style === "explorer") {
    ctx.fillStyle = "#7a5230";
    rr(ctx, x - 6.5 * u, by - 17 * u, 13 * u, 10 * u, 2.5 * u);
    ctx.fill();
  } else if (av.style === "diver" || av.style === "astronaut") {
    ctx.fillStyle = av.style === "diver" ? "#e7b416" : "#c9d2de";
    rr(ctx, x - 6 * u, by - 18 * u, 12 * u, 11 * u, 3 * u);
    ctx.fill();
  }
  // legs: a little step in place
  const step = Math.sin(t / 190) * 1.1 * u;
  ctx.fillStyle = suitDark;
  rr(ctx, x - 3.6 * u, base - 6 * u + Math.max(0, step), 3 * u, 6 * u - Math.max(0, step), 1.4 * u);
  ctx.fill();
  rr(ctx, x + 0.6 * u, base - 6 * u + Math.max(0, -step), 3 * u, 6 * u - Math.max(0, -step), 1.4 * u);
  ctx.fill();
  // body
  const body = ctx.createLinearGradient(x - 5 * u, by - 16 * u, x + 5 * u, by - 5 * u);
  body.addColorStop(0, suit);
  body.addColorStop(1, suitDark);
  ctx.fillStyle = body;
  rr(ctx, x - 5 * u, by - 16 * u, 10 * u, 11 * u, 3.5 * u);
  ctx.fill();
  outline();
  if (av.style === "builder") {
    ctx.fillStyle = "#ff8a1f";
    ctx.fillRect(x - 5 * u, by - 11.5 * u, 10 * u, 1.6 * u);
    ctx.fillStyle = "#f4f7fb";
    ctx.fillRect(x - 5 * u, by - 9.6 * u, 10 * u, 0.8 * u);
  } else if (av.style === "sailor") {
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    for (let i = 0; i < 3; i++) ctx.fillRect(x - 5 * u, by - (14 - i * 3) * u, 10 * u, 0.9 * u);
  } else if (av.style === "explorer") {
    ctx.fillStyle = "#d94f3d";
    rr(ctx, x - 4.5 * u, by - 16.5 * u, 9 * u, 2.2 * u, 1 * u);
    ctx.fill();
  } else if (av.style === "robot") {
    ctx.fillStyle = `hsl(${hue},100%,65%)`;
    ctx.beginPath();
    ctx.arc(x, by - 11 * u, 1.6 * u, 0, Math.PI * 2);
    ctx.fill();
  } else if (av.style === "astronaut") {
    ctx.fillStyle = `hsl(${hue},85%,55%)`;
    ctx.fillRect(x - 3 * u, by - 12 * u, 6 * u, 1.6 * u);
  }
  // head
  const hy = by - 21 * u;
  if (av.style === "robot") {
    ctx.strokeStyle = suitDark;
    ctx.lineWidth = 0.9 * u;
    ctx.beginPath();
    ctx.moveTo(x, hy - 5 * u);
    ctx.lineTo(x, hy - 8.5 * u);
    ctx.stroke();
    ctx.fillStyle = `hsl(${hue},100%,${60 + 20 * Math.abs(Math.sin(t / 300))}%)`;
    ctx.beginPath();
    ctx.arc(x, hy - 9 * u, 1.4 * u, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = `hsl(${hue},14%,80%)`;
    rr(ctx, x - 5.5 * u, hy - 5 * u, 11 * u, 9.5 * u, 2.2 * u);
    ctx.fill();
    outline();
    ctx.fillStyle = "rgba(10,18,36,0.92)";
    rr(ctx, x - 4 * u, hy - 2.5 * u, 8 * u, 4 * u, 1.5 * u);
    ctx.fill();
    ctx.fillStyle = `hsl(${hue},100%,70%)`;
    ctx.fillRect(x - 3 * u, hy - 1.2 * u, 2 * u, 1.4 * u);
    ctx.fillRect(x + 1 * u, hy - 1.2 * u, 2 * u, 1.4 * u);
  } else {
    ctx.fillStyle = head;
    ctx.beginPath();
    ctx.arc(x, hy, 5.2 * u, 0, Math.PI * 2);
    ctx.fill();
    outline();
    if (av.style === "astronaut") {
      ctx.fillStyle = "#eef2f7";
      ctx.beginPath();
      ctx.arc(x, hy, 6.6 * u, 0, Math.PI * 2);
      ctx.fill();
      outline();
      const vis = ctx.createLinearGradient(x - 4 * u, hy - 3 * u, x + 4 * u, hy + 3 * u);
      vis.addColorStop(0, `hsl(${hue},90%,70%)`);
      vis.addColorStop(1, `hsl(${hue},90%,30%)`);
      ctx.fillStyle = vis;
      rr(ctx, x - 4.6 * u, hy - 3.2 * u, 9.2 * u, 6 * u, 3 * u);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.8)";
      ctx.fillRect(x - 3.2 * u, hy - 2.2 * u, 2 * u, 1 * u);
    } else {
      // eyes
      ctx.fillStyle = ink;
      ctx.beginPath();
      ctx.arc(x - 1.9 * u, hy + 0.4 * u, 0.8 * u, 0, Math.PI * 2);
      ctx.arc(x + 1.9 * u, hy + 0.4 * u, 0.8 * u, 0, Math.PI * 2);
      ctx.fill();
    }
    if (av.style === "explorer") {
      ctx.fillStyle = "#b98a4e";
      ctx.beginPath();
      ctx.ellipse(x, hy - 3.2 * u, 8.2 * u, 2 * u, 0, 0, Math.PI * 2);
      ctx.fill();
      rr(ctx, x - 4 * u, hy - 7.5 * u, 8 * u, 4.6 * u, 2 * u);
      ctx.fill();
      ctx.fillStyle = "#6b4a24";
      ctx.fillRect(x - 4 * u, hy - 4.2 * u, 8 * u, 1 * u);
    } else if (av.style === "builder") {
      ctx.fillStyle = "#ffc928";
      ctx.beginPath();
      ctx.arc(x, hy - 2 * u, 5.4 * u, Math.PI, 0);
      ctx.fill();
      ctx.fillRect(x - 7 * u, hy - 2.2 * u, 14 * u, 1.4 * u);
      ctx.fillStyle = "#e0a800";
      ctx.fillRect(x - 0.7 * u, hy - 7.4 * u, 1.4 * u, 5.2 * u);
    } else if (av.style === "sailor") {
      ctx.fillStyle = "#f4f7fb";
      rr(ctx, x - 5.2 * u, hy - 6.6 * u, 10.4 * u, 4 * u, 1.8 * u);
      ctx.fill();
      ctx.fillStyle = "#13294b";
      rr(ctx, x - 5.6 * u, hy - 3.2 * u, 11.2 * u, 1.5 * u, 0.7 * u);
      ctx.fill();
      ctx.fillStyle = `hsl(${hue},90%,55%)`;
      ctx.beginPath();
      ctx.arc(x, hy - 4.8 * u, 1 * u, 0, Math.PI * 2);
      ctx.fill();
    } else if (av.style === "scholar") {
      ctx.strokeStyle = ink;
      ctx.lineWidth = 0.6 * u;
      ctx.beginPath();
      ctx.arc(x - 1.9 * u, hy + 0.4 * u, 1.6 * u, 0, Math.PI * 2);
      ctx.moveTo(x + 3.5 * u, hy + 0.4 * u);
      ctx.arc(x + 1.9 * u, hy + 0.4 * u, 1.6 * u, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "#1c2233";
      ctx.beginPath();
      ctx.moveTo(x - 7.5 * u, hy - 5.5 * u);
      ctx.lineTo(x, hy - 8.5 * u);
      ctx.lineTo(x + 7.5 * u, hy - 5.5 * u);
      ctx.lineTo(x, hy - 2.8 * u);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = `hsl(${hue},95%,62%)`;
      ctx.lineWidth = 0.7 * u;
      ctx.beginPath();
      ctx.moveTo(x, hy - 5.6 * u);
      ctx.lineTo(x + 5.5 * u, hy - 4.5 * u);
      ctx.lineTo(x + 5.5 * u, hy - 1 * u);
      ctx.stroke();
    } else if (av.style === "pilot") {
      ctx.fillStyle = "#6e4527";
      ctx.beginPath();
      ctx.arc(x, hy - 0.6 * u, 5.6 * u, Math.PI * 1.02, Math.PI * 1.98);
      ctx.fill();
      ctx.fillRect(x - 5.6 * u, hy - 1.4 * u, 1.6 * u, 4.6 * u);
      ctx.fillRect(x + 4 * u, hy - 1.4 * u, 1.6 * u, 4.6 * u);
      ctx.fillStyle = `hsla(${hue},90%,70%,0.95)`;
      ctx.strokeStyle = "#3a2414";
      ctx.lineWidth = 0.6 * u;
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(x + s * 2.2 * u, hy - 3.6 * u, 1.6 * u, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    } else if (av.style === "diver") {
      ctx.fillStyle = `hsla(${hue},80%,85%,0.28)`;
      ctx.beginPath();
      ctx.arc(x, hy, 7.2 * u, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.85)";
      ctx.lineWidth = 0.8 * u;
      ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.75)";
      ctx.beginPath();
      ctx.ellipse(x - 3.6 * u, hy - 3.6 * u, 1 * u, 2 * u, -0.7, 0, Math.PI * 2);
      ctx.fill();
      // bubbles rising
      const b = (t % 1800) / 1800;
      ctx.beginPath();
      ctx.arc(x + 5 * u, hy - 8 * u - b * 8 * u, 0.9 * u, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  label(ctx, x, hy - 11 * u, k, hue, o.label);
  ctx.restore();
}

function label(ctx: CanvasRenderingContext2D, cx: number, y: number, k: number, hue: number, text?: string) {
  if (!text) return;
  ctx.font = `700 ${11 * k}px Inter, system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const w = ctx.measureText(text).width + 10 * k;
  const ly = y - 5 * k;
  ctx.fillStyle = "rgba(8,16,36,0.82)";
  ctx.beginPath();
  ctx.roundRect(cx - w / 2, ly - 8 * k, w, 16 * k, 8 * k);
  ctx.fill();
  ctx.fillStyle = `hsl(${hue},100%,85%)`;
  ctx.fillText(text, cx, ly + 0.5 * k);
}

/** The classic drop, scaled for a crowd (size < 1 for other residents). */
function drawDropSized(ctx: CanvasRenderingContext2D, px: number, py: number, scale: number, hue: number, time: number, lift: number, text: string | undefined, size: number) {
  if (size === 1) return drawDrop(ctx, px, py, scale, hue, time, lift, text);
  // drawing at a larger zoom makes the drop smaller on screen
  ctx.save();
  ctx.translate(px, py);
  ctx.scale(size, size);
  drawDrop(ctx, 0, 0, scale * size, hue, time, lift, undefined);
  ctx.restore();
  if (text) label(ctx, px, py - 46 * size / scale, 1 / scale, hue, text);
}

/** Small stable number 0..1 from a key: the phase of a resident's idle animation and their place in a crowd. */
export function seed(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10000) / 10000;
}

/**
 * Residents who stand on the same tile are set side by side in a small ring
 * around it (in tiles), so a crowd at a town centre reads as a crowd.
 */
export function spread<T extends { key: string; x: number; y: number }>(list: T[]): (T & { fx: number; fy: number })[] {
  const groups = new Map<string, T[]>();
  for (const r of list) {
    const g = `${r.x},${r.y}`;
    const arr = groups.get(g);
    if (arr) arr.push(r);
    else groups.set(g, [r]);
  }
  const out: (T & { fx: number; fy: number })[] = [];
  for (const arr of groups.values()) {
    arr.sort((a, b) => (a.key < b.key ? -1 : 1));
    arr.forEach((r, i) => {
      if (i === 0 && arr.length === 1) return out.push({ ...r, fx: r.x + 0.5, fy: r.y + 0.5 });
      // rings of 6, 12, 18 ... around the tile (golden angle keeps it even)
      const ring = Math.floor(Math.sqrt(i / 3)) + 1;
      const a = i * 2.39996 + seed(r.key);
      const d = 0.9 * ring;
      out.push({ ...r, fx: r.x + 0.5 + Math.cos(a) * d, fy: r.y + 0.5 + Math.sin(a) * d });
    });
  }
  return out;
}
