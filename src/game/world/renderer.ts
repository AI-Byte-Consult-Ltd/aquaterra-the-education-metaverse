import { KINDS, type Kind, type World } from "./generator";
import { baseColor, daylight, shade, skyColor, treeColor } from "./palette";

export const TW = 32;
export const TH = 16;
const TOWER_HEIGHT = 300;
const MIN_SCALE = 0.05;
const MAX_SCALE = 4;
/** Below this zoom the whole world is drawn from one pre-rendered image. */
const OVERVIEW_SCALE = 0.3;

export interface Camera {
  cx: number;
  cy: number;
  scale: number;
}

export type Pick = { kind: "plot"; plotId: number } | { kind: "tower" } | { kind: "tile"; tile: Kind; x: number; y: number; district: number } | null;

const isoX = (x: number, y: number) => ((x - y) * TW) / 2;
const isoY = (x: number, y: number) => ((x + y) * TH) / 2;

const WATER: Kind[] = ["deep", "ocean", "shallow", "lake", "river"];

/** Isometric renderer for an AquaTerra World on a 2D canvas. */
export class WorldRenderer {
  private ctx: CanvasRenderingContext2D;
  private ground: HTMLCanvasElement;
  private gctx: CanvasRenderingContext2D;
  private groundKey = "";
  private overview: HTMLCanvasElement | null = null;
  private overviewOrigin = { x: 0, y: 0 };
  private kinds: Kind[];
  private elev: Float32Array;
  private top: string[] = [];
  private left: string[] = [];
  private right: string[] = [];
  private tree: string[] = [];
  private day = 1;
  private sky = "";
  private dpr = 1;
  private width = 0;
  private height = 0;
  camera: Camera = { cx: 0, cy: 0, scale: 0.2 };
  selectedPlot: number | null = null;
  hoverPlot: number | null = null;
  towerSelected = false;

  constructor(
    private canvas: HTMLCanvasElement,
    private world: World,
    private labels: { tower: string },
  ) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D is not available");
    this.ctx = ctx;
    this.ground = document.createElement("canvas");
    this.gctx = this.ground.getContext("2d")!;
    const n = world.size * world.size;
    this.kinds = Array.from(world.kind, (k) => KINDS[k]);
    this.elev = new Float32Array(n);
    for (let i = 0; i < n; i++) this.elev[i] = this.elevationOf(i);
    this.refreshDaylight();
  }

  private elevationOf(i: number): number {
    const k = this.kinds[i];
    const raw = Math.max(0, this.world.height[i]);
    // mountains rise steeply above the hills
    const h = raw + (raw > 0.4 ? (raw - 0.4) * 1.6 : 0);
    switch (k) {
      case "deep":
      case "ocean":
      case "shallow":
        return 0;
      case "lake":
      case "river":
        return Math.max(1, Math.round(h * 70) - 2);
      case "bridge":
      case "railbridge": {
        // bridges sit at the height of the banks
        return Math.max(7, Math.round(h * 70) + 4);
      }
      case "pier":
        return 4;
      case "terminal":
        return Math.round(4 + h * 70) + 14;
      case "tower":
      case "plaza":
        return Math.round(4 + h * 70);
      default:
        return Math.round(4 + h * 70);
    }
  }

  refreshDaylight(date = new Date()) {
    this.day = daylight(date);
    this.sky = skyColor(this.day);
    const w = this.world;
    const n = w.size * w.size;
    this.top = new Array(n);
    this.left = new Array(n);
    this.right = new Array(n);
    this.tree = new Array(n);
    for (let i = 0; i < n; i++) {
      const k = this.kinds[i];
      const d = w.district[i];
      const biome = d >= 0 ? w.districts[d].biome : "temperate";
      // every district has its own slight tint so neighbours of one climate stay distinct
      const tint = d >= 0 && !WATER.includes(k) ? 0.92 + ((d * 37) % 13) / 100 : 1;
      const c = baseColor(k, biome);
      this.top[i] = shade(c, this.day, tint);
      this.left[i] = shade(c, this.day, tint * 0.74);
      this.right[i] = shade(c, this.day, tint * 0.6);
      if (k === "forest") this.tree[i] = shade(treeColor(biome), this.day);
    }
    this.groundKey = "";
    this.overview = null;
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

  fit() {
    const s = this.world.size;
    // fit the land, not the whole ocean square; on a narrow phone screen crop the sides a little
    const worldW = s * TW * (this.width < this.height ? 0.55 : 0.78);
    const worldH = s * TH * 0.82;
    const scale = Math.min(this.width / worldW, this.height / worldH);
    const c = s / 2;
    this.camera = { cx: isoX(c, c), cy: isoY(c, c) - 30, scale: clamp(scale, MIN_SCALE, MAX_SCALE) };
  }

  focusTile(x: number, y: number, scale = 1.4) {
    this.camera = { cx: isoX(x + 0.5, y + 0.5), cy: isoY(x + 0.5, y + 0.5) - this.elev[y * this.world.size + x], scale: clamp(scale, MIN_SCALE, MAX_SCALE) };
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
    return { wx: (sx - this.width / 2) / this.camera.scale + this.camera.cx, wy: (sy - this.height / 2) / this.camera.scale + this.camera.cy };
  }

  private worldToTile(wx: number, wy: number) {
    const a = wx / (TW / 2);
    const b = wy / (TH / 2);
    return { x: (a + b) / 2, y: (b - a) / 2 };
  }

  pick(sx: number, sy: number): Pick {
    const { wx, wy } = this.screenToWorld(sx, sy);
    const w = this.world;
    const n = w.size;
    const c = w.center;
    const tx = isoX(c + 0.5, c + 0.5);
    const ty = isoY(c + 0.5, c + 0.5) - this.elev[c * n + c];
    if (Math.abs(wx - tx) < TW * 1.6 && wy < ty + TH && wy > ty - TOWER_HEIGHT - 60) return { kind: "tower" };
    // Walk from the front tile at sea level backwards; the first tile whose raised top contains the point wins.
    const t0 = this.worldToTile(wx, wy);
    const bx = Math.floor(t0.x);
    const by = Math.floor(t0.y);
    for (let k = -1; k <= 12; k++) {
      for (const [ox, oy] of [[0, 0], [1, 0], [0, 1]]) {
        const x = bx + k + ox;
        const y = by + k + oy;
        if (x < 0 || y < 0 || x >= n || y >= n) continue;
        const i = y * n + x;
        const t = this.worldToTile(wx, wy + this.elev[i]);
        if (Math.floor(t.x) !== x || Math.floor(t.y) !== y) continue;
        const plot = w.plotOf[i];
        if (plot >= 0) return { kind: "plot", plotId: plot };
        const kind = this.kinds[i];
        if (kind === "tower" || (kind === "plaza" && Math.hypot(x - c, y - c) < 7)) return { kind: "tower" };
        return { kind: "tile", tile: kind, x, y, district: w.district[i] };
      }
    }
    return null;
  }

  draw(time: number) {
    const { ctx, camera } = this;
    const s = camera.scale;
    const world = [this.dpr * s, 0, 0, this.dpr * s, this.dpr * (this.width / 2 - camera.cx * s), this.dpr * (this.height / 2 - camera.cy * s)] as const;
    const key = `${camera.cx}|${camera.cy}|${s}|${this.width}|${this.height}|${this.dpr}|${this.day}`;
    if (key !== this.groundKey) {
      const g = this.gctx;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.fillStyle = this.sky;
      g.fillRect(0, 0, this.ground.width, this.ground.height);
      if (s <= OVERVIEW_SCALE) {
        const ov = this.getOverview();
        g.setTransform(...world);
        g.imageSmoothingEnabled = true;
        g.drawImage(ov, this.overviewOrigin.x, this.overviewOrigin.y, ov.width / OVERVIEW_SCALE, ov.height / OVERVIEW_SCALE);
      } else {
        g.setTransform(...world);
        this.drawTiles(g, this.visibleRange(), s > 0.55);
      }
      this.groundKey = key;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.ground, 0, 0);
    ctx.setTransform(...world);
    this.highlight(this.hoverPlot, "rgba(255,255,255,0.28)", null);
    this.highlight(this.selectedPlot, "rgba(120,240,255,0.5)", "rgba(160,250,255,0.95)");
    this.drawTower(time);
    this.drawLabels();
  }

  /** The whole world rendered once at a small scale. */
  private getOverview(): HTMLCanvasElement {
    if (this.overview) return this.overview;
    const n = this.world.size;
    const s = OVERVIEW_SCALE;
    const minX = isoX(0, n);
    const maxX = isoX(n, 0);
    const minY = -90;
    const maxY = isoY(n, n) + TH;
    const c = document.createElement("canvas");
    c.width = Math.ceil((maxX - minX) * s);
    c.height = Math.ceil((maxY - minY) * s);
    const g = c.getContext("2d")!;
    g.fillStyle = this.sky;
    g.fillRect(0, 0, c.width, c.height);
    g.setTransform(s, 0, 0, s, -minX * s, -minY * s);
    this.drawTiles(g, { x0: 0, x1: n - 1, y0: 0, y1: n - 1 }, false);
    this.overview = c;
    this.overviewOrigin = { x: minX, y: minY };
    return c;
  }

  private visibleRange() {
    const pad = 6;
    const pts = [
      this.screenToWorld(0, 0),
      this.screenToWorld(this.width, 0),
      this.screenToWorld(0, this.height),
      this.screenToWorld(this.width, this.height),
    ];
    const tiles = pts.flatMap((p) => [this.worldToTile(p.wx, p.wy), this.worldToTile(p.wx, p.wy + 90)]);
    const n = this.world.size;
    return {
      x0: clamp(Math.floor(Math.min(...tiles.map((t) => t.x))) - pad, 0, n - 1),
      x1: clamp(Math.ceil(Math.max(...tiles.map((t) => t.x))) + pad, 0, n - 1),
      y0: clamp(Math.floor(Math.min(...tiles.map((t) => t.y))) - pad, 0, n - 1),
      y1: clamp(Math.ceil(Math.max(...tiles.map((t) => t.y))) + pad, 0, n - 1),
    };
  }

  private drawTiles(ctx: CanvasRenderingContext2D, r: { x0: number; x1: number; y0: number; y1: number }, detailed: boolean) {
    const { kinds, elev, top, left, right } = this;
    const w = this.world;
    const n = w.size;
    const hw = TW / 2;
    const hh = TH / 2;
    const night = this.isNight;
    for (let y = r.y0; y <= r.y1; y++) {
      for (let x = r.x0; x <= r.x1; x++) {
        const i = y * n + x;
        const e = elev[i];
        const px = ((x - y) * TW) / 2;
        const py = ((x + y) * TH) / 2 - e;
        // side faces down to the front neighbours
        const eL = y + 1 < n ? elev[i + n] : 0;
        const eR = x + 1 < n ? elev[i + 1] : 0;
        if (e > eL) {
          ctx.fillStyle = left[i];
          ctx.beginPath();
          ctx.moveTo(px - hw, py + hh);
          ctx.lineTo(px, py + TH);
          ctx.lineTo(px, py + TH + e - eL);
          ctx.lineTo(px - hw, py + hh + e - eL);
          ctx.closePath();
          ctx.fill();
        }
        if (e > eR) {
          ctx.fillStyle = right[i];
          ctx.beginPath();
          ctx.moveTo(px + hw, py + hh);
          ctx.lineTo(px, py + TH);
          ctx.lineTo(px, py + TH + e - eR);
          ctx.lineTo(px + hw, py + hh + e - eR);
          ctx.closePath();
          ctx.fill();
        }
        ctx.fillStyle = top[i];
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px + hw, py + hh);
        ctx.lineTo(px, py + TH);
        ctx.lineTo(px - hw, py + hh);
        ctx.closePath();
        ctx.fill();

        if (!detailed) continue;
        const k = kinds[i];
        // plot borders
        const pid = w.plotOf[i];
        if (pid >= 0) {
          ctx.strokeStyle = "rgba(20,24,30,0.35)";
          ctx.lineWidth = 0.9;
          ctx.beginPath();
          if (x + 1 >= n || w.plotOf[i + 1] !== pid) {
            ctx.moveTo(px + hw, py + hh);
            ctx.lineTo(px, py + TH);
          }
          if (y + 1 >= n || w.plotOf[i + n] !== pid) {
            ctx.moveTo(px, py + TH);
            ctx.lineTo(px - hw, py + hh);
          }
          if (x === 0 || w.plotOf[i - 1] !== pid) {
            ctx.moveTo(px - hw, py + hh);
            ctx.lineTo(px, py);
          }
          if (y === 0 || w.plotOf[i - n] !== pid) {
            ctx.moveTo(px, py);
            ctx.lineTo(px + hw, py + hh);
          }
          ctx.stroke();
        }
        if (k === "forest") this.drawTree(ctx, px, py + hh, i);
        else if (k === "rail" || k === "railbridge" || k === "station") this.drawRail(ctx, px, py, x, y);
        else if (k === "runway") this.drawRunway(ctx, px, py, x, y);
        else if ((k === "road" || k === "bridge") && night && (x + y) % 3 === 0) {
          ctx.fillStyle = "rgba(255,214,140,0.85)";
          ctx.fillRect(px - 1.3, py + hh - 1.3, 2.6, 2.6);
        } else if (k === "terminal") {
          ctx.fillStyle = night ? "rgba(255,230,160,0.9)" : "rgba(255,255,255,0.7)";
          ctx.fillRect(px - 5, py + hh - 1, 10, 2);
        }
      }
    }
  }

  private drawTree(ctx: CanvasRenderingContext2D, px: number, py: number, i: number) {
    const w = this.world;
    const d = w.district[i];
    const biome = d >= 0 ? w.districts[d].biome : "temperate";
    const jitter = ((i * 2654435761) >>> 0) % 7;
    const x = px + jitter - 3;
    ctx.fillStyle = this.tree[i];
    if (biome === "tundra" || biome === "volcanic") {
      ctx.beginPath();
      ctx.moveTo(x, py - 14);
      ctx.lineTo(x + 5, py + 1);
      ctx.lineTo(x - 5, py + 1);
      ctx.closePath();
      ctx.fill();
    } else if (biome === "desert" || biome === "savanna") {
      ctx.fillRect(x - 0.8, py - 8, 1.6, 9);
      ctx.beginPath();
      ctx.ellipse(x, py - 9, 5, 2.4, 0, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.arc(x, py - 6, 5.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(0,0,0,0.18)";
      ctx.beginPath();
      ctx.arc(x + 1.5, py - 4.5, 3.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private axis(x: number, y: number, kinds: Kind[]): "x" | "y" {
    const n = this.world.size;
    const at = (xx: number, yy: number) => xx >= 0 && yy >= 0 && xx < n && yy < n && kinds.includes(this.kinds[yy * n + xx]);
    const horiz = (at(x - 1, y) ? 1 : 0) + (at(x + 1, y) ? 1 : 0);
    const vert = (at(x, y - 1) ? 1 : 0) + (at(x, y + 1) ? 1 : 0);
    return horiz >= vert ? "x" : "y";
  }

  private drawRail(ctx: CanvasRenderingContext2D, px: number, py: number, x: number, y: number) {
    const ax = this.axis(x, y, ["rail", "railbridge", "station"]);
    // unit vectors of the tile's x and y axes on screen
    const ux = ax === "x" ? [TW / 2, TH / 2] : [-TW / 2, TH / 2];
    const vx = ax === "x" ? [-TW / 2, TH / 2] : [TW / 2, TH / 2];
    const cx = px;
    const cy = py + TH / 2;
    ctx.strokeStyle = "rgba(40,30,26,0.75)";
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    for (const off of [-0.18, 0.18]) {
      ctx.moveTo(cx - ux[0] / 2 + vx[0] * off, cy - ux[1] / 2 + vx[1] * off);
      ctx.lineTo(cx + ux[0] / 2 + vx[0] * off, cy + ux[1] / 2 + vx[1] * off);
    }
    ctx.stroke();
    ctx.strokeStyle = "rgba(60,44,36,0.5)";
    ctx.beginPath();
    for (const t of [-0.3, 0, 0.3]) {
      ctx.moveTo(cx + ux[0] * t - vx[0] * 0.28, cy + ux[1] * t - vx[1] * 0.28);
      ctx.lineTo(cx + ux[0] * t + vx[0] * 0.28, cy + ux[1] * t + vx[1] * 0.28);
    }
    ctx.stroke();
  }

  private drawRunway(ctx: CanvasRenderingContext2D, px: number, py: number, x: number, y: number) {
    const ax = this.axis(x, y, ["runway"]);
    if ((ax === "x" ? x : y) % 2) return;
    const u = ax === "x" ? [TW / 2, TH / 2] : [-TW / 2, TH / 2];
    ctx.strokeStyle = "rgba(255,255,255,0.8)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(px - u[0] * 0.3, py + TH / 2 - u[1] * 0.3);
    ctx.lineTo(px + u[0] * 0.3, py + TH / 2 + u[1] * 0.3);
    ctx.stroke();
  }

  private highlight(id: number | null, fill: string, stroke: string | null) {
    if (id === null) return;
    const plot = this.world.plots[id];
    if (!plot) return;
    const { ctx } = this;
    const n = this.world.size;
    ctx.fillStyle = fill;
    for (const t of plot.tiles) {
      const x = t % n;
      const y = (t - x) / n;
      const px = ((x - y) * TW) / 2;
      const py = ((x + y) * TH) / 2 - this.elev[t];
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px + TW / 2, py + TH / 2);
      ctx.lineTo(px, py + TH);
      ctx.lineTo(px - TW / 2, py + TH / 2);
      ctx.closePath();
      ctx.fill();
    }
    if (stroke) {
      const { x, y } = plot.anchor;
      const px = isoX(x + 0.5, y + 0.5);
      const py = isoY(x + 0.5, y + 0.5) - this.elev[y * n + x];
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
    const n = this.world.size;
    const c = this.world.center;
    const bx = isoX(c + 0.5, c + 0.5);
    const by = isoY(c + 0.5, c + 0.5) - this.elev[c * n + c] + TH / 2;
    const hw = 1.6 * (TW / 2);
    const hh = 1.6 * (TH / 2);
    const H = TOWER_HEIGHT;
    const taper = 0.55;
    const night = this.isNight;
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
    ctx.strokeStyle = night ? "rgba(140,220,255,0.4)" : "rgba(255,255,255,0.35)";
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
    ctx.fillStyle = night ? "#5d6fb8" : "#e8eefb";
    ctx.beginPath();
    ctx.moveTo(bx, by - H - hh * taper);
    ctx.lineTo(bx + hw * taper, by - H);
    ctx.lineTo(bx, by - H + hh * taper);
    ctx.lineTo(bx - hw * taper, by - H);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = night ? "#a8c4ff" : "#ffffff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(bx, by - H);
    ctx.lineTo(bx, by - H - 46);
    ctx.stroke();
    const pulse = 0.65 + 0.35 * Math.sin(time / 700);
    const glowR = (night ? 110 : 56) * (0.8 + 0.2 * pulse);
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
    const w = this.world;
    const n = w.size;
    const s = this.camera.scale;
    const k = 1 / s;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const font = (px: number, weight = 600) => `${weight} ${px * k}px Inter, system-ui, sans-serif`;
    const pill = (text: string, x: number, y: number, size: number, fg: string, bg: string) => {
      ctx.font = font(size, 700);
      const tw = ctx.measureText(text).width + 12 * k;
      ctx.fillStyle = bg;
      roundRect(ctx, x - tw / 2, y - (size * 0.85 + 2) * k, tw, (size * 1.7 + 4) * k, (size * 0.85 + 2) * k);
      ctx.fill();
      ctx.fillStyle = fg;
      ctx.fillText(text, x, y + 0.5 * k);
    };
    const at = (x: number, y: number) => ({ px: isoX(x + 0.5, y + 0.5), py: isoY(x + 0.5, y + 0.5) - this.elev[y * n + x] });

    // district names
    if (s < 1.2) {
      const taken: { x: number; y: number }[] = [];
      for (const d of w.districts) {
        if (d.capital) continue;
        const { px, py } = at(d.x, d.y);
        if (taken.some((q) => Math.abs(q.x - px) * s < 120 && Math.abs(q.y - py) * s < 24)) continue;
        taken.push({ x: px, y: py });
        pill(d.name, px, py - 14 * k, s > 0.3 ? 12 : 11, "#ffffff", "rgba(10,18,40,0.72)");
      }
    }
    // airports and stations
    if (s > 0.12) {
      for (const a of w.airports) {
        const { px, py } = at(a.x, a.y);
        pill(`✈ ${a.name}`, px, py - 26 * k, 11, "#0b1a3a", "rgba(255,255,255,0.88)");
      }
    }
    if (s > 0.35) {
      for (const st of w.stations) {
        const { px, py } = at(st.x, st.y);
        pill("🚉", px, py - 12 * k, 11, "#ffffff", "rgba(180,50,40,0.85)");
      }
    }
    // tower name
    {
      const { px, py } = at(w.center, w.center);
      ctx.font = font(13, 700);
      ctx.fillStyle = this.isNight ? "#dffbff" : "#0b1a3a";
      ctx.fillText(this.labels.tower, px, py - TOWER_HEIGHT - 110);
    }
    // street names and house numbers when zoomed in
    if (s > 0.9) {
      const r = this.visibleRange();
      // skip labels that would overlap one already drawn
      const placed: { x: number; y: number }[] = [];
      for (const road of w.roads) {
        const { x, y } = road.mid;
        if (x < r.x0 || x > r.x1 || y < r.y0 || y > r.y1) continue;
        const { px, py } = at(x, y);
        if (placed.some((q) => Math.abs(q.x - px) * s < 130 && Math.abs(q.y - py) * s < 26)) continue;
        placed.push({ x: px, y: py });
        pill(road.name, px, py, 10, "#ffffff", "rgba(40,44,60,0.85)");
      }
      ctx.font = font(10, 600);
      ctx.fillStyle = "rgba(10,20,30,0.8)";
      for (const p of w.plots) {
        const { x, y } = p.anchor;
        if (x < r.x0 || x > r.x1 || y < r.y0 || y > r.y1) continue;
        const { px, py } = at(x, y);
        ctx.fillText(String(p.number), px, py + TH / 2);
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
