import { type City, TILE_KINDS, type TileKind } from "./generator";
import { ELEVATION, daylight, paletteFor, skyFor, type TileColors } from "./palette";

export const TW = 32; // tile width on screen at scale 1
export const TH = 16; // tile height on screen at scale 1
const TOWER_HEIGHT = 300;
const MIN_SCALE = 0.04;
const MAX_SCALE = 4;

export interface Camera {
  /** World point (iso pixels at scale 1) shown at the centre of the canvas. */
  cx: number;
  cy: number;
  scale: number;
}

export type Pick = { kind: "plot"; plotId: number } | { kind: "tower" } | { kind: "tile"; tile: TileKind; x: number; y: number } | null;

export const isoX = (x: number, y: number) => ((x - y) * TW) / 2;
export const isoY = (x: number, y: number) => ((x + y) * TH) / 2;

/**
 * Draws the city in isometric projection on a 2D canvas.
 * Ground is drawn once per camera change; the tower, beacon and selection are
 * redrawn every animation frame on top.
 */
export class IsoCityRenderer {
  private ctx: CanvasRenderingContext2D;
  /** Cached ground layer; redrawn only when the camera or the clock changes. */
  private ground: HTMLCanvasElement;
  private gctx: CanvasRenderingContext2D;
  private groundKey = "";
  private kinds: TileKind[];
  private pal: Record<TileKind, TileColors>;
  private sky: string;
  private day: number;
  private dpr = 1;
  private width = 0;
  private height = 0;
  camera: Camera = { cx: 0, cy: 0, scale: 0.2 };
  selectedPlot: number | null = null;
  hoverPlot: number | null = null;
  towerSelected = false;

  constructor(
    private canvas: HTMLCanvasElement,
    private city: City,
    private labels: { ray: (n: number) => string; tower: string },
  ) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D is not available");
    this.ctx = ctx;
    this.ground = document.createElement("canvas");
    const g = this.ground.getContext("2d");
    if (!g) throw new Error("Canvas 2D is not available");
    this.gctx = g;
    this.kinds = Array.from(city.tiles, (k) => TILE_KINDS[k]);
    this.day = daylight();
    this.pal = paletteFor(this.day);
    this.sky = skyFor(this.day);
  }

  /** Recompute day/night colours from the clock (call every few minutes). */
  refreshDaylight(date = new Date()) {
    this.day = daylight(date);
    this.pal = paletteFor(this.day);
    this.sky = skyFor(this.day);
    this.groundKey = "";
  }

  get isNight() {
    return this.day < 0.5;
  }

  resize(width: number, height: number, dpr: number) {
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.ground.width = this.canvas.width;
    this.ground.height = this.canvas.height;
    this.groundKey = "";
  }

  /** Fit the whole mainland into view. */
  fit() {
    const r = this.city.params.coastRadius + 14;
    const worldW = r * 2 * TW * 0.72;
    const worldH = r * 2 * TH * 0.72 + TOWER_HEIGHT * 0.3;
    const scale = Math.min(this.width / worldW, this.height / worldH);
    this.camera = { cx: isoX(this.city.center, this.city.center), cy: isoY(this.city.center, this.city.center) - 20, scale: clamp(scale, MIN_SCALE, MAX_SCALE) };
  }

  focusTile(x: number, y: number, scale = 1.6) {
    this.camera = { cx: isoX(x + 0.5, y + 0.5), cy: isoY(x + 0.5, y + 0.5), scale: clamp(scale, MIN_SCALE, MAX_SCALE) };
  }

  pan(dx: number, dy: number) {
    this.camera.cx -= dx / this.camera.scale;
    this.camera.cy -= dy / this.camera.scale;
  }

  zoomAt(factor: number, sx: number, sy: number) {
    const before = this.screenToWorld(sx, sy);
    this.camera.scale = clamp(this.camera.scale * factor, MIN_SCALE, MAX_SCALE);
    const after = this.screenToWorld(sx, sy);
    this.camera.cx += before.wx - after.wx;
    this.camera.cy += before.wy - after.wy;
  }

  screenToWorld(sx: number, sy: number) {
    return {
      wx: (sx - this.width / 2) / this.camera.scale + this.camera.cx,
      wy: (sy - this.height / 2) / this.camera.scale + this.camera.cy,
    };
  }

  private worldToTile(wx: number, wy: number) {
    const a = wx / (TW / 2);
    const b = wy / (TH / 2);
    return { x: (a + b) / 2, y: (b - a) / 2 };
  }

  pick(sx: number, sy: number): Pick {
    const { wx, wy } = this.screenToWorld(sx, sy);
    // tower: a tall box over the centre
    const tx = isoX(this.city.center, this.city.center);
    const ty = isoY(this.city.center, this.city.center);
    if (Math.abs(wx - tx) < TW * 2.4 && wy < ty + TH && wy > ty - TOWER_HEIGHT - 40) return { kind: "tower" };
    // try with the typical elevation of land, then sea level
    for (const elev of [6, 4, 0]) {
      const t = this.worldToTile(wx, wy + elev);
      const x = Math.floor(t.x);
      const y = Math.floor(t.y);
      if (x < 0 || y < 0 || x >= this.city.size || y >= this.city.size) continue;
      const i = y * this.city.size + x;
      const kind = this.kinds[i];
      if (ELEVATION[kind] !== elev && elev !== 0) continue;
      const plot = this.city.plotOf[i];
      if (plot >= 0) return { kind: "plot", plotId: plot };
      if (kind === "tower" || kind === "plaza") return { kind: "tower" };
      return { kind: "tile", tile: kind, x, y };
    }
    return null;
  }

  /** Draw everything. `time` is ms for animation. */
  draw(time: number) {
    const { ctx, camera } = this;
    const s = camera.scale;
    const world = [this.dpr * s, 0, 0, this.dpr * s, this.dpr * (this.width / 2 - camera.cx * s), this.dpr * (this.height / 2 - camera.cy * s)] as const;

    const key = `${camera.cx}|${camera.cy}|${s}|${this.width}|${this.height}|${this.dpr}`;
    if (key !== this.groundKey) {
      const g = this.gctx;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.fillStyle = this.sky;
      g.fillRect(0, 0, this.ground.width, this.ground.height);
      g.setTransform(...world);
      this.drawGround(g);
      this.groundKey = key;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.ground, 0, 0);
    ctx.setTransform(...world);
    this.drawPlotHighlight(this.hoverPlot, "rgba(255,255,255,0.22)", null);
    this.drawPlotHighlight(this.selectedPlot, "rgba(120,240,255,0.45)", "rgba(160,250,255,0.95)");
    this.drawTower(time);
    this.drawLabels();
  }

  private visibleRange() {
    const pad = 3;
    const corners = [
      this.screenToWorld(0, 0),
      this.screenToWorld(this.width, 0),
      this.screenToWorld(0, this.height + 40 * this.camera.scale),
      this.screenToWorld(this.width, this.height + 40 * this.camera.scale),
    ].map((p) => this.worldToTile(p.wx, p.wy + 8));
    const xs = corners.map((c) => c.x);
    const ys = corners.map((c) => c.y);
    const n = this.city.size;
    return {
      x0: clamp(Math.floor(Math.min(...xs)) - pad, 0, n - 1),
      x1: clamp(Math.ceil(Math.max(...xs)) + pad, 0, n - 1),
      y0: clamp(Math.floor(Math.min(...ys)) - pad, 0, n - 1),
      y1: clamp(Math.ceil(Math.max(...ys)) + pad, 0, n - 1),
    };
  }

  private drawGround(ctx: CanvasRenderingContext2D) {
    const { kinds, pal } = this;
    const n = this.city.size;
    const { x0, x1, y0, y1 } = this.visibleRange();
    const detailed = this.camera.scale > 0.35;
    const hw = TW / 2;
    const hh = TH / 2;
    // Rows y, then columns x: every tile is drawn after the tiles behind it.
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = y * n + x;
        const kind = kinds[i];
        const e = ELEVATION[kind];
        const px = ((x - y) * TW) / 2;
        const py = ((x + y) * TH) / 2 - e;
        const c = pal[kind];
        // top face
        ctx.fillStyle = c.top;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px + hw, py + hh);
        ctx.lineTo(px, py + TH);
        ctx.lineTo(px - hw, py + hh);
        ctx.closePath();
        ctx.fill();
        if (e > 0 && detailed) {
          // side faces down to the neighbour's height
          const below = (nx: number, ny: number) => (nx < n && ny < n ? ELEVATION[kinds[ny * n + nx]] : 0);
          const dl = e - below(x, y + 1);
          if (dl > 0) {
            ctx.fillStyle = c.left;
            ctx.beginPath();
            ctx.moveTo(px - hw, py + hh);
            ctx.lineTo(px, py + TH);
            ctx.lineTo(px, py + TH + dl);
            ctx.lineTo(px - hw, py + hh + dl);
            ctx.closePath();
            ctx.fill();
          }
          const dr = e - below(x + 1, y);
          if (dr > 0) {
            ctx.fillStyle = c.right;
            ctx.beginPath();
            ctx.moveTo(px + hw, py + hh);
            ctx.lineTo(px, py + TH);
            ctx.lineTo(px, py + TH + dr);
            ctx.lineTo(px + hw, py + hh + dr);
            ctx.closePath();
            ctx.fill();
          }
        }
        // plot borders: darker edge where the neighbour belongs to another plot
        if (kind === "plot" && detailed) {
          const id = this.city.plotOf[i];
          ctx.strokeStyle = "rgba(0,0,0,0.28)";
          ctx.lineWidth = 0.8;
          ctx.beginPath();
          if (x + 1 >= n || this.city.plotOf[i + 1] !== id) {
            ctx.moveTo(px + hw, py + hh);
            ctx.lineTo(px, py + TH);
          }
          if (y + 1 >= n || this.city.plotOf[i + n] !== id) {
            ctx.moveTo(px, py + TH);
            ctx.lineTo(px - hw, py + hh);
          }
          if (x === 0 || this.city.plotOf[i - 1] !== id) {
            ctx.moveTo(px - hw, py + hh);
            ctx.lineTo(px, py);
          }
          if (y === 0 || this.city.plotOf[i - n] !== id) {
            ctx.moveTo(px, py);
            ctx.lineTo(px + hw, py + hh);
          }
          ctx.stroke();
        }
        // street lights at night
        if ((kind === "street" || kind === "bridge") && this.isNight && (x + y) % 4 === 0) {
          ctx.fillStyle = "rgba(255,214,140,0.75)";
          ctx.fillRect(px - 1.2, py + hh - 1.2, 2.4, 2.4);
        }
      }
    }
  }

  private drawPlotHighlight(id: number | null, fill: string, stroke: string | null) {
    if (id === null) return;
    const plot = this.city.plots[id];
    if (!plot) return;
    const { ctx } = this;
    const n = this.city.size;
    const e = ELEVATION.plot;
    ctx.fillStyle = fill;
    for (const t of plot.tiles) {
      const x = t % n;
      const y = (t - x) / n;
      const px = ((x - y) * TW) / 2;
      const py = ((x + y) * TH) / 2 - e;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px + TW / 2, py + TH / 2);
      ctx.lineTo(px, py + TH);
      ctx.lineTo(px - TW / 2, py + TH / 2);
      ctx.closePath();
      ctx.fill();
    }
    if (stroke) {
      // marker pin above the plot
      const px = isoX(plot.anchor.x + 0.5, plot.anchor.y + 0.5);
      const py = isoY(plot.anchor.x + 0.5, plot.anchor.y + 0.5) - e;
      const k = 1 / Math.max(this.camera.scale, 0.25);
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 2 * k;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px, py - 26 * k);
      ctx.stroke();
      ctx.fillStyle = stroke;
      ctx.beginPath();
      ctx.arc(px, py - 30 * k, 6 * k, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawTower(time: number) {
    const { ctx } = this;
    const c = this.city.center;
    const bx = isoX(c, c);
    const by = isoY(c, c) - ELEVATION.tower;
    const r = 2.4; // footprint half-size in tiles
    const hw = r * (TW / 2);
    const hh = r * (TH / 2);
    const H = TOWER_HEIGHT;
    const taper = 0.55; // top is narrower than the base

    const night = this.isNight;
    // left face
    const gl = ctx.createLinearGradient(bx - hw, 0, bx, 0);
    gl.addColorStop(0, night ? "#2a3566" : "#9fb4d8");
    gl.addColorStop(1, night ? "#3c4c8a" : "#c9d7ee");
    ctx.fillStyle = gl;
    ctx.beginPath();
    ctx.moveTo(bx - hw, by);
    ctx.lineTo(bx, by + hh);
    ctx.lineTo(bx, by + hh * taper - H);
    ctx.lineTo(bx - hw * taper, by - H);
    ctx.closePath();
    ctx.fill();
    // right face
    const gr = ctx.createLinearGradient(bx, 0, bx + hw, 0);
    gr.addColorStop(0, night ? "#222b55" : "#7f96c0");
    gr.addColorStop(1, night ? "#161d3d" : "#6a80aa");
    ctx.fillStyle = gr;
    ctx.beginPath();
    ctx.moveTo(bx + hw, by);
    ctx.lineTo(bx, by + hh);
    ctx.lineTo(bx, by + hh * taper - H);
    ctx.lineTo(bx + hw * taper, by - H);
    ctx.closePath();
    ctx.fill();
    // floor lines (every ~9 floors of 108)
    ctx.strokeStyle = night ? "rgba(140,220,255,0.35)" : "rgba(255,255,255,0.35)";
    ctx.lineWidth = 0.8;
    for (let f = 1; f < 12; f++) {
      const t = f / 12;
      const w = hw * (1 - (1 - taper) * t);
      const h2 = hh * (1 - (1 - taper) * t);
      const y = by - H * t;
      ctx.beginPath();
      ctx.moveTo(bx - w, y);
      ctx.lineTo(bx, y + h2);
      ctx.lineTo(bx + w, y);
      ctx.stroke();
    }
    // top cap
    const tw = hw * taper;
    const th = hh * taper;
    ctx.fillStyle = night ? "#5d6fb8" : "#e8eefb";
    ctx.beginPath();
    ctx.moveTo(bx, by - H - th);
    ctx.lineTo(bx + tw, by - H);
    ctx.lineTo(bx, by - H + th);
    ctx.lineTo(bx - tw, by - H);
    ctx.closePath();
    ctx.fill();
    // spire
    ctx.strokeStyle = night ? "#a8c4ff" : "#ffffff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(bx, by - H);
    ctx.lineTo(bx, by - H - 46);
    ctx.stroke();
    // beacon: steady pulse, stronger at night
    const pulse = 0.65 + 0.35 * Math.sin(time / 700);
    const glowR = (night ? 90 : 46) * (0.8 + 0.2 * pulse);
    const g = ctx.createRadialGradient(bx, by - H - 50, 0, bx, by - H - 50, glowR);
    g.addColorStop(0, `rgba(170,250,255,${0.95 * pulse})`);
    g.addColorStop(0.25, `rgba(90,210,255,${0.45 * pulse})`);
    g.addColorStop(1, "rgba(90,210,255,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(bx, by - H - 50, glowR, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#e9ffff";
    ctx.beginPath();
    ctx.arc(bx, by - H - 50, 4, 0, Math.PI * 2);
    ctx.fill();
    if (this.towerSelected) {
      ctx.strokeStyle = "rgba(160,250,255,0.95)";
      ctx.lineWidth = 2 / Math.max(this.camera.scale, 0.25);
      ctx.beginPath();
      ctx.moveTo(bx - hw - 4, by);
      ctx.lineTo(bx, by + hh + 3);
      ctx.lineTo(bx + hw + 4, by);
      ctx.stroke();
    }
  }

  private drawLabels() {
    const { ctx } = this;
    const s = this.camera.scale;
    const k = 1 / s; // keep text size constant on screen
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const font = (px: number, weight = 600) => `${weight} ${px * k}px Inter, system-ui, sans-serif`;
    const c = this.city.center;

    // ray badges near the plaza / start of each ray, and at the coast
    if (s > 0.09) {
      for (const ray of this.city.rays) {
        // zoomed out: one badge per ray at the waterfront; zoomed in: also near the ray's start
        const radii = s > 0.25 ? [ray.startRadius + 4, this.city.params.coastRadius - 6] : [this.city.params.coastRadius - 6];
        for (const rad of radii) {
          const x = c + Math.cos(ray.angle) * rad;
          const y = c + Math.sin(ray.angle) * rad;
          const px = isoX(x, y);
          const py = isoY(x, y) - 8;
          const label = String(ray.number);
          ctx.font = font(11, 700);
          const w = Math.max(18, ctx.measureText(label).width / k + 10) * k;
          ctx.fillStyle = "rgba(8,16,40,0.82)";
          roundRect(ctx, px - w / 2, py - 9 * k, w, 18 * k, 9 * k);
          ctx.fill();
          ctx.fillStyle = "#9fefff";
          ctx.fillText(label, px, py + 0.5 * k);
        }
      }
    }

    // tower name
    if (s > 0.06) {
      const px = isoX(c, c);
      const py = isoY(c, c) - TOWER_HEIGHT - 100;
      ctx.font = font(13, 700);
      ctx.fillStyle = this.isNight ? "#dffbff" : "#0b1a3a";
      ctx.fillText(this.labels.tower, px, py);
    }

    // house numbers when zoomed in
    if (s > 1.1) {
      const { x0, x1, y0, y1 } = this.visibleRange();
      ctx.font = font(10, 600);
      ctx.fillStyle = "rgba(10,20,30,0.75)";
      for (const plot of this.city.plots) {
        const { x, y } = plot.anchor;
        if (x < x0 || x > x1 || y < y0 || y > y1) continue;
        ctx.fillText(String(plot.house), isoX(x + 0.5, y + 0.5), isoY(x + 0.5, y + 0.5) - ELEVATION.plot);
      }
    }
  }
}

function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
