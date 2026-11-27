import { KINDS, type Kind, type Plot, type World } from "./generator";
import { landmarkFor, SECOND_TOWER } from "./landmarks";
import { builtBuilding, buildingsFor, type Building, type BuildingStyle, type Built, type Tower } from "./buildings";
import { cottagePalette, drawCottage, type CottagePalette } from "./cottages";
import { LAGOON, baseColor, daylight, shade, skyColor, treeColor, type RGB } from "./palette";
import { groundTurnMatrix, toViewPoint, turn, viewMaps, type Rotation } from "./view";
import { CIVIC, civicHit, drawCivic, type CivicId } from "./civic";
import { drawTrail, type Point, type TripPlayer } from "../travel/drop";
import { drawFieldTile, fieldStage, fieldTint, type FieldStage, type MapField } from "../farm/map";
import { drawAvatar, drawCompanion, seed, type AvatarStyle } from "../residents/avatars";

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

export type Pick = { kind: "plot"; plotId: number } | { kind: "tower"; id?: "second-light" } | { kind: "civic"; id: CivicId } | { kind: "tile"; tile: Kind; x: number; y: number; district: number } | null;

const isoX = (x: number, y: number) => ((x - y) * TW) / 2;
const isoY = (x: number, y: number) => ((x + y) * TH) / 2;

/** Height of one floor of a house in screen pixels at scale 1. */
const FLOOR_PX = 5;
/** Skyscrapers use the First Light Tower's scale: 108 floors = TOWER_HEIGHT. */
const TOWER_FLOOR_PX = TOWER_HEIGHT / 108;
/** The Second Light Tower on the same scale of floors. */
const SECOND_HEIGHT = TOWER_FLOOR_PX * SECOND_TOWER.floors;
/** Gap left on the outer edges of a skyscraper, as a share of a tile (sidewalk). */
const TOWER_INSET = 0.14;

const WATER: Kind[] = ["deep", "ocean", "shallow", "lake", "river"];
/** Length of the animated 90° turn of the map, ms. */
const TURN_MS = 420;
/** How high the selected plot rises, in world pixels, and how long it takes. */
const LIFT_PX = 14;
const LIFT_MS = 320;

/** Isometric renderer for an AquaTerra World on a 2D canvas. */
export class WorldRenderer {
  private ctx: CanvasRenderingContext2D;
  private ground: HTMLCanvasElement;
  private gctx: CanvasRenderingContext2D;
  private groundKey = "";
  private overview: HTMLCanvasElement | null = null;
  /** Overview of the previous rotation, so turning back is instant. */
  private prevOverview: { rot: Rotation; img: HTMLCanvasElement } | null = null;
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
  /** The selected plot rises out of the map like a tile (off in close-up views such as the plot window). */
  liftSelected = true;
  private lift = { id: null as number | null, start: 0 };
  hoverPlot: number | null = null;
  /** Plots with an owner: true for the signed-in resident's own land. */
  owned: Map<number, boolean> = new Map();
  towerSelected = false;
  /** The Second Light Tower is selected. */
  secondSelected = false;
  /** Seat of government picked on the map, and seats with open votes (a light on the roof). */
  selectedCivic: CivicId | null = null;
  busyCivic: Set<CivicId> = new Set();
  /** Plots with an open arcade attraction: a pulsing sign over the plot (NICS AI's in cyan). */
  attractions: Map<number, { ai: boolean; glyph: string }> = new Map();
  /** Names shown over the seats of government when zoomed in. */
  civicLabels: Partial<Record<CivicId, string>> = {};
  /** The signed-in resident's drop: where it stands (world tiles), its colour and label. */
  player: { x: number; y: number; hue: number; label: string; style?: AvatarStyle } | null = null;
  /** Other residents (real ones, from the server), already spread around shared spots: world tiles, fractional. */
  residents: { key: string; fx: number; fy: number; style: AvatarStyle; hue: number; name: string; handle?: string | null; online: boolean; companion?: string | null }[] = [];
  /** My AI companion (NICS AI Agent), floating beside me. */
  myCompanion: string | null = null;
  showResidents = true;
  /** A trip being played: the drop moves along it, the camera follows while `follow` is on. */
  trip: TripPlayer | null = null;
  follow = false;
  /** Harbours, marked on the shore when zoomed in. */
  ports: Point[] = [];
  /** Draw a preview house on every plot. */
  private showBuildings = true;
  private buildings: (Building | null)[];
  private second: Plot | null = null;
  /** Plots whose building a resident changed (built, raised, cleared). */
  private builtIds = new Set<number>();
  /** Farms: what grows on each plot and how far it has grown. */
  private fields = new Map<number, { f: MapField; s: { grow: number; stage: FieldStage } }>();
  private fieldsKey = "";
  /** Plot whose house stands on this tile, or -1. */
  private houseAt: Int32Array;
  /** Skyscraper column on this tile: building index and its height in floors. */
  private towerAt: Int32Array;
  private towerFloors: Int16Array;
  /** Colours of each building at the current daylight, by plot id. */
  private cottageColors: (CottagePalette | null)[] = [];
  private houseColors: ({ wl: string; wr: string; roof: string; roofDark: string; win: string; post: string; trim: string } | null)[] = [];
  /** Which side the map is seen from, in 90° steps. Plots and addresses never change. */
  private rot: Rotation = 0;
  /** View tile index → world tile index, and back, for the current rotation. */
  private vmap: Int32Array;
  private wmap: Int32Array;
  /** The running turn animation: the last frame of the old view and the direction. */
  private turning: { from: HTMLCanvasElement; dir: 1 | -1; start: number } | null = null;
  private frame: HTMLCanvasElement | null = null;

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
    this.buildings = buildingsFor(world).slice();
    // the Second Light Tower is drawn on its own, over the map, like the First Light Tower
    this.second = landmarkFor(world, SECOND_TOWER.plotId) ? world.plots[SECOND_TOWER.plotId] : null;
    if (this.second) this.buildings[SECOND_TOWER.plotId] = null;
    ({ toWorld: this.vmap, toView: this.wmap } = viewMaps(world.size, 0));
    this.houseAt = new Int32Array(n).fill(-1);
    this.towerAt = new Int32Array(n).fill(-1);
    this.towerFloors = new Int16Array(n);
    for (const p of world.plots) this.place(p.id);
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
    const lagoon = new Set([1, ...w.expansions.filter((e) => e.lagoon).map((e) => e.zone)]);
    for (let i = 0; i < n; i++) {
      const k = this.kinds[i];
      const d = w.district[i];
      const biome = d >= 0 ? w.districts[d].biome : "temperate";
      // every district has its own slight tint so neighbours of one climate stay distinct
      const tint = d >= 0 && !WATER.includes(k) ? 0.92 + ((d * 37) % 13) / 100 : 1;
      const c = lagoon.has(w.zone[i]) && (k === "shallow" || k === "ocean") ? (k === "shallow" ? LAGOON : ([40, 150, 190] as RGB)) : baseColor(k, biome);
      this.top[i] = shade(c, this.day, tint);
      this.left[i] = shade(c, this.day, tint * 0.74);
      this.right[i] = shade(c, this.day, tint * 0.6);
      if (k === "forest") this.tree[i] = shade(treeColor(biome), this.day);
    }
    const night = this.day < 0.5;
    this.houseColors = this.buildings.map((b) => {
      if (!b) return null;
      const st = b.style;
      const win: RGB = night ? st.window : [60, 80, 104];
      return {
        wl: shade(b.wall, this.day, 0.92),
        wr: shade(b.wall, this.day, 0.72),
        roof: shade(b.roofColor, this.day, 1),
        roofDark: shade(b.roofColor, this.day, 0.78),
        win: night ? `rgb(${win.join(",")})` : shade(win, this.day, 1),
        post: shade([90, 70, 54], this.day),
        trim: shade([212, 172, 76], this.day, 1.05),
      };
    });
    this.cottageColors = this.buildings.map((b) => (b?.cottage ? cottagePalette(b.cottage, this.day) : null));
    this.groundKey = "";
    this.overview = null;
    this.prevOverview = null;
  }

  /** Put a plot's building on its tiles (or clear them). */
  private place(id: number) {
    const p = this.world.plots[id];
    for (const tile of p.tiles) {
      if (this.towerAt[tile] === id) this.towerAt[tile] = -1;
      if (this.houseAt[tile] === id) this.houseAt[tile] = -1;
    }
    const b = this.buildings[id];
    if (!b) return;
    const t = b.tower;
    if (t)
      t.tiles.forEach((tile, k) => {
        this.towerAt[tile] = id;
        this.towerFloors[tile] = t.heights[k];
      });
    else this.houseAt[p.anchor.y * this.world.size + p.anchor.x] = id;
  }

  /** View tile (x, y) of plot `pid` that its house or tower stands on, or the yard just in front of a house. */
  private yard(pid: number, x: number, y: number): boolean {
    if (!this.showBuildings || !this.buildings[pid]) return false;
    const n = this.world.size;
    const i = this.vmap[y * n + x];
    if (this.towerAt[i] === pid) return true;
    const a = this.world.plots[pid].anchor;
    if (this.houseAt[a.y * n + a.x] !== pid) return false;
    const v = this.wmap[a.y * n + a.x];
    const ax = v % n;
    const ay = (v - ax) / n;
    return x - ax >= 0 && x - ax <= 1 && y - ay >= 0 && y - ay <= 1;
  }

  /** What residents built, from the server. Plots not listed show their starter building again. */
  setBuilt(built: Map<number, Built>, now = Date.now() / 1000) {
    const start = buildingsFor(this.world);
    const ids = new Set([...this.builtIds, ...built.keys()]);
    for (const id of ids) {
      const p = this.world.plots[id];
      if (!p) continue;
      const b = built.get(id);
      this.buildings[id] = this.second?.id === id ? null : b ? builtBuilding(this.world, p, b, now) : start[id];
      this.place(id);
    }
    this.builtIds = new Set(built.keys());
    this.refreshDaylight();
  }

  get buildingsVisible() {
    return this.showBuildings;
  }

  /** Farms from the server: plot id to crop and times. The ground redraws only when a stage changes. */
  setFields(fields: Map<number, MapField>, wiltHours: number, now = Date.now() / 1000) {
    const next = new Map<number, { f: MapField; s: { grow: number; stage: FieldStage } }>();
    const key: string[] = [];
    for (const [id, f] of fields) {
      const st = fieldStage(f, now, wiltHours);
      next.set(id, { f, s: st });
      key.push(`${id}:${f.crop}:${st.stage}:${Math.round(st.grow * 8)}`);
    }
    this.fields = next;
    const k = key.join(",");
    if (k !== this.fieldsKey) {
      this.fieldsKey = k;
      this.groundKey = "";
    }
  }

  setBuildingsVisible(on: boolean) {
    this.showBuildings = on;
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
    const { px, py } = this.at(x, y);
    this.camera = { cx: px, cy: py, scale: clamp(scale, MIN_SCALE, MAX_SCALE) };
  }

  /** Centre on the First Light Tower, a little above it so the whole tower shows from any side. */
  focusTower(scale = 0.6) {
    const c = this.world.center;
    const { px, py } = this.at(c, c);
    this.camera = { cx: px, cy: py - 8 * TH, scale: clamp(scale, MIN_SCALE, MAX_SCALE) };
  }

  /** Show the whole Second Light Tower, from its foot to the beacon. */
  focusSecond() {
    if (!this.second) return;
    const { px, py } = this.at(this.second.anchor.x, this.second.anchor.y);
    const scale = clamp((this.height * 0.8) / (SECOND_HEIGHT + 120), MIN_SCALE, MAX_SCALE);
    this.camera = { cx: px, cy: py - (SECOND_HEIGHT + 60) / 2, scale };
  }

  /** Screen position (at scale 1) of the centre of world tile (x, y), standing on its ground. */
  private at(x: number, y: number) {
    const n = this.world.size;
    const [vx, vy] = toViewPoint(x + 0.5, y + 0.5, n, this.rot);
    return { px: isoX(vx, vy), py: isoY(vx, vy) - this.elev[y * n + x] };
  }

  /** Screen position (at scale 1) of a point of the world plane in tile units, e.g. a drop between two tiles. */
  private atPoint(fx: number, fy: number) {
    const n = this.world.size;
    const [vx, vy] = toViewPoint(fx + 0.5, fy + 0.5, n, this.rot);
    const tx = clamp(Math.round(fx), 0, n - 1);
    const ty = clamp(Math.round(fy), 0, n - 1);
    return { px: isoX(vx, vy), py: isoY(vx, vy) - this.elev[ty * n + tx] };
  }

  /** Centre the camera on a point of the world (tile units). */
  focusPoint(x: number, y: number, scale = this.camera.scale) {
    const { px, py } = this.atPoint(x, y);
    this.camera = { cx: px, cy: py, scale: clamp(scale, MIN_SCALE, MAX_SCALE) };
  }

  /** View tile of a world tile. */
  private viewTile(x: number, y: number) {
    const n = this.world.size;
    const v = this.wmap[y * n + x];
    return { x: v % n, y: (v / n) | 0 };
  }

  get rotation(): Rotation {
    return this.rot;
  }

  get isTurning() {
    return this.turning !== null;
  }

  /**
   * Turn the map 90° around the point in the middle of the screen; +1 clockwise.
   * The turn is animated; the plots, districts and addresses stay where they are.
   */
  rotate(dir: 1 | -1) {
    if (this.width === 0) return;
    const n = this.world.size;
    // keep the same spot of land in the middle of the screen
    let e = 0;
    let t = this.worldToTile(this.camera.cx, this.camera.cy);
    for (let k = 0; k < 2; k++) {
      const vx = clamp(Math.floor(t.x), 0, n - 1);
      const vy = clamp(Math.floor(t.y), 0, n - 1);
      e = this.elev[this.vmap[vy * n + vx]];
      t = this.worldToTile(this.camera.cx, this.camera.cy + e);
    }
    const [nx, ny] = toViewPoint(t.x, t.y, n, dir > 0 ? 1 : 3);
    // the last frame of the old view slides into the new one
    const from = document.createElement("canvas");
    from.width = this.canvas.width;
    from.height = this.canvas.height;
    from.getContext("2d")!.drawImage(this.turning ? this.frameOrCanvas() : this.canvas, 0, 0);
    this.rot = turn(this.rot, dir);
    ({ toWorld: this.vmap, toView: this.wmap } = viewMaps(n, this.rot));
    this.camera.cx = isoX(nx, ny);
    this.camera.cy = isoY(nx, ny) - e;
    this.groundKey = "";
    const prev = this.prevOverview;
    this.prevOverview = this.overview ? { rot: turn(this.rot, dir === 1 ? -1 : 1), img: this.overview } : null;
    this.overview = prev?.rot === this.rot ? prev.img : null;
    this.hoverPlot = null;
    // the clock starts on the first frame of the new view, which can take a moment to draw
    this.turning = { from, dir, start: -1 };
  }

  private frameOrCanvas() {
    return this.frame ?? this.canvas;
  }

  pan(dx: number, dy: number) {
    this.follow = false;
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
    for (const b of CIVIC) {
      const { px, py } = this.at(c + b.dx, c + b.dy);
      if (civicHit(wx, wy, px, py)) return { kind: "civic", id: b.id };
    }
    const { px: tx, py: ty } = this.at(c, c);
    if (Math.abs(wx - tx) < TW * 1.6 && wy < ty + TH && wy > ty - TOWER_HEIGHT - 60) return { kind: "tower" };
    if (this.second) {
      const { px: sx2, py: sy2 } = this.at(this.second.anchor.x, this.second.anchor.y);
      if (Math.abs(wx - sx2) < TW * 1.2 && wy < sy2 + TH && wy > sy2 - SECOND_HEIGHT - 60) return { kind: "tower", id: "second-light" };
    }
    // Walk from the front tile at sea level backwards; the first tile whose raised top contains the point wins.
    const t0 = this.worldToTile(wx, wy);
    const bx = Math.floor(t0.x);
    const by = Math.floor(t0.y);
    for (let k = -1; k <= 12; k++) {
      for (const [ox, oy] of [[0, 0], [1, 0], [0, 1]]) {
        const vx = bx + k + ox;
        const vy = by + k + oy;
        if (vx < 0 || vy < 0 || vx >= n || vy >= n) continue;
        const i = this.vmap[vy * n + vx];
        const t = this.worldToTile(wx, wy + this.elev[i]);
        if (Math.floor(t.x) !== vx || Math.floor(t.y) !== vy) continue;
        const x = i % n;
        const y = (i - x) / n;
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
    const key = `${camera.cx}|${camera.cy}|${s}|${this.width}|${this.height}|${this.dpr}|${this.day}|${this.showBuildings}|${this.selectedCivic}|${[...this.busyCivic].join()}`;
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
        this.drawCivicBuildings(g);
      }
      this.groundKey = key;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.ground, 0, 0);
    ctx.setTransform(...world);
    for (const [id, mine] of this.owned) this.highlight(id, mine ? "rgba(255,196,60,0.42)" : "rgba(255,110,90,0.24)", null);
    this.highlight(this.hoverPlot, "rgba(255,255,255,0.28)", null);
    if (this.liftSelected && this.selectedPlot !== null && s > 0.3) this.drawLifted(time);
    else this.highlight(this.selectedPlot, "rgba(120,240,255,0.5)", "rgba(160,250,255,0.95)");
    this.drawTower(time);
    this.drawLabels();
    this.drawTraveller(time);
    this.drawAttractions(time);
    if (this.turning) this.drawTurn(time);
  }

  /**
   * The selected plot lifted above the map like a tile, with what stands on it,
   * while the rest of the map dims a little.
   */
  private drawLifted(time: number) {
    const id = this.selectedPlot!;
    const plot = this.world.plots[id];
    if (!plot) return;
    if (this.lift.id !== id) this.lift = { id, start: time };
    const p = clamp((time - this.lift.start) / LIFT_MS, 0, 1);
    const e = 1 - Math.pow(1 - p, 3);
    const h = LIFT_PX * e;
    const { ctx } = this;
    const n = this.world.size;
    const hw = TW / 2;
    const hh = TH / 2;
    // dim the map around it
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = `rgba(4,8,16,${0.38 * e})`;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.restore();
    const only = new Set(plot.tiles);
    let x0 = n, x1 = 0, y0 = n, y1 = 0;
    const inPlot = (x: number, y: number) => x >= 0 && y >= 0 && x < n && y < n && only.has(this.vmap[y * n + x]);
    // soft shadow on the ground, then the slab's sides
    ctx.fillStyle = `rgba(0,0,0,${0.35 * e})`;
    for (const t of plot.tiles) {
      const v = this.wmap[t];
      const x = v % n;
      const y = (v - x) / n;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      const px = ((x - y) * TW) / 2;
      const py = ((x + y) * TH) / 2 - this.elev[t] + h * 0.25;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px + hw, py + hh);
      ctx.lineTo(px, py + TH);
      ctx.lineTo(px - hw, py + hh);
      ctx.closePath();
      ctx.fill();
    }
    for (const t of plot.tiles) {
      const v = this.wmap[t];
      const x = v % n;
      const y = (v - x) / n;
      const px = ((x - y) * TW) / 2;
      const py = ((x + y) * TH) / 2 - this.elev[t] - h;
      if (!inPlot(x, y + 1)) {
        ctx.fillStyle = this.left[t];
        ctx.beginPath();
        ctx.moveTo(px - hw, py + hh);
        ctx.lineTo(px, py + TH);
        ctx.lineTo(px, py + TH + h);
        ctx.lineTo(px - hw, py + hh + h);
        ctx.closePath();
        ctx.fill();
      }
      if (!inPlot(x + 1, y)) {
        ctx.fillStyle = this.right[t];
        ctx.beginPath();
        ctx.moveTo(px + hw, py + hh);
        ctx.lineTo(px, py + TH);
        ctx.lineTo(px, py + TH + h);
        ctx.lineTo(px + hw, py + hh + h);
        ctx.closePath();
        ctx.fill();
      }
    }
    // the plot itself, raised, with its house
    ctx.save();
    ctx.translate(0, -h);
    this.drawTiles(ctx, { x0: Math.max(0, x0 - 1), x1: Math.min(n - 1, x1 + 1), y0: Math.max(0, y0 - 1), y1: Math.min(n - 1, y1 + 1) }, this.camera.scale > 0.55, only);
    // glowing rim
    const k = 1 / Math.max(this.camera.scale, 0.25);
    ctx.strokeStyle = "rgba(160,250,255,0.95)";
    ctx.lineWidth = 1.6 * k;
    ctx.shadowColor = "rgba(120,240,255,0.9)";
    ctx.shadowBlur = 10;
    ctx.beginPath();
    for (const t of plot.tiles) {
      const v = this.wmap[t];
      const x = v % n;
      const y = (v - x) / n;
      const px = ((x - y) * TW) / 2;
      const py = ((x + y) * TH) / 2 - this.elev[t];
      if (!inPlot(x + 1, y)) { ctx.moveTo(px + hw, py + hh); ctx.lineTo(px, py + TH); }
      if (!inPlot(x, y + 1)) { ctx.moveTo(px, py + TH); ctx.lineTo(px - hw, py + hh); }
      if (!inPlot(x - 1, y)) { ctx.moveTo(px - hw, py + hh); ctx.lineTo(px, py); }
      if (!inPlot(x, y - 1)) { ctx.moveTo(px, py); ctx.lineTo(px + hw, py + hh); }
    }
    ctx.stroke();
    ctx.restore();
  }

  /** Harbour marks, the route ahead and the resident's drop, on top of everything. */
  private drawTraveller(time: number) {
    const { ctx } = this;
    const s = this.camera.scale;
    const k = 1 / s;
    if (s > 0.35) {
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (const p of this.ports) {
        const { px, py } = this.atPoint(p.x, p.y);
        ctx.fillStyle = "rgba(20,90,160,0.88)";
        ctx.beginPath();
        ctx.arc(px, py - 10 * k, 8 * k, 0, Math.PI * 2);
        ctx.fill();
        ctx.font = `700 ${10 * k}px Inter, system-ui, sans-serif`;
        ctx.fillStyle = "#ffffff";
        ctx.fillText("⚓", px, py - 9.5 * k);
      }
    }
    if (this.showResidents && this.residents.length) this.drawResidents(time);
    const me = this.player;
    if (!me) return;
    let lift = 0;
    let afloat = false;
    if (this.trip) {
      const st = this.trip.at(time);
      me.x = st.pos.x;
      me.y = st.pos.y;
      lift = st.lift;
      afloat = st.mode === "boat" || st.mode === "ferry";
      drawTrail(ctx, st.ahead.map((q) => this.atPoint(q.x, q.y)), s, me.hue, time);
      if (this.trip.done) this.trip = null;
    }
    const { px, py } = this.atPoint(me.x, me.y);
    if (this.follow && !this.turning) {
      this.camera.cx += (px - this.camera.cx) * 0.12;
      this.camera.cy += (py - this.camera.cy) * 0.12;
    }
    if (afloat) drawHull(ctx, px, py, s, time);
    drawAvatar(ctx, px, py, s, { style: me.style ?? "drop", hue: me.hue }, time, { lift, label: me.label, online: true });
    if (this.myCompanion) drawCompanion(ctx, px, py - lift * 70 / s, s, this.myCompanion, time, { label: s >= 0.9 });
  }

  /** Other residents where they stand: names when close enough, quieter when away. */
  private drawResidents(time: number) {
    const s = this.camera.scale;
    const { ctx } = this;
    const w = this.width / s;
    const h = this.height / s;
    const cx = this.camera.cx;
    const cy = this.camera.cy;
    const named = s >= 0.9;
    // far back to front, so nearer figures stand in front
    const list = this.residents
      .map((r) => ({ r, p: this.atPoint(r.fx - 0.5, r.fy - 0.5) }))
      .filter(({ p }) => Math.abs(p.px - cx) < w && Math.abs(p.py - cy) < h)
      .sort((a, b) => a.p.py - b.p.py);
    for (const { r, p } of list) {
      drawAvatar(ctx, p.px, p.py, s, { style: r.style, hue: r.hue }, time, {
        size: 0.82,
        online: r.online,
        dim: !r.online,
        phase: seed(r.key) * 7,
        label: named && (r.online || s >= 1.6) ? (r.handle ? `${r.name} @${r.handle}` : r.name) : undefined,
      });
      if (r.companion) drawCompanion(ctx, p.px, p.py, s, r.companion, time, { dim: !r.online, phase: seed(r.key) * 5, label: named && s >= 1.6 });
    }
  }

  /** Blend the old view into the new one while the ground swings round by 90°. */
  private drawTurn(time: number) {
    const tr = this.turning!;
    // the first frame of a new view can be slow (the overview is redrawn), so start the clock after it
    if (tr.start < 0) tr.start = performance.now();
    time = Math.max(time, tr.start);
    const p = clamp((time - tr.start) / TURN_MS, 0, 1);
    if (p >= 1) {
      this.turning = null;
      return;
    }
    const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
    const { ctx, canvas } = this;
    if (!this.frame || this.frame.width !== canvas.width || this.frame.height !== canvas.height) {
      this.frame = document.createElement("canvas");
      this.frame.width = canvas.width;
      this.frame.height = canvas.height;
    }
    const f = this.frame.getContext("2d")!;
    f.setTransform(1, 0, 0, 1, 0, 0);
    f.clearRect(0, 0, canvas.width, canvas.height);
    f.drawImage(canvas, 0, 0);
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const phi = tr.dir * (Math.PI / 2) * e;
    const put = (img: HTMLCanvasElement, angle: number, alpha: number) => {
      const [a, b, c, d] = groundTurnMatrix(angle, TW, TH);
      ctx.setTransform(a, b, c, d, cx - a * cx - c * cy, cy - b * cx - d * cy);
      ctx.globalAlpha = alpha;
      ctx.drawImage(img, 0, 0);
    };
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = this.sky;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    put(tr.from, phi, 1);
    put(this.frame, phi - tr.dir * (Math.PI / 2), clamp((e - 0.2) / 0.6, 0, 1));
    ctx.globalAlpha = 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
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

  /** The seats of the Commonwealth on the tower plaza, back to front for the current view. */
  private drawCivicBuildings(ctx: CanvasRenderingContext2D) {
    const c = this.world.center;
    const night = this.isNight;
    const spots = CIVIC.map((b) => ({ b, ...this.at(c + b.dx, c + b.dy) })).sort((p, q) => p.py - q.py);
    for (const { b, px, py } of spots) drawCivic(ctx, b.id, px, py, night, this.selectedCivic === b.id, this.busyCivic.has(b.id));
  }

  private visibleRange() {
    // generous margin so tall houses just below the screen still show their tops
    const pad = 14;
    // skyscrapers below the screen can reach high into it
    const front = this.showBuildings ? 40 : pad;
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
      x1: clamp(Math.ceil(Math.max(...tiles.map((t) => t.x))) + front, 0, n - 1),
      y0: clamp(Math.floor(Math.min(...tiles.map((t) => t.y))) - pad, 0, n - 1),
      y1: clamp(Math.ceil(Math.max(...tiles.map((t) => t.y))) + front, 0, n - 1),
    };
  }

  private drawTiles(ctx: CanvasRenderingContext2D, r: { x0: number; x1: number; y0: number; y1: number }, detailed: boolean, only?: Set<number>) {
    const { kinds, elev, top, left, right } = this;
    const w = this.world;
    const n = w.size;
    const hw = TW / 2;
    const hh = TH / 2;
    const night = this.isNight;
    const vmap = this.vmap;
    // x and y below are view tiles; i is the world tile drawn there
    for (let y = r.y0; y <= r.y1; y++) {
      for (let x = r.x0; x <= r.x1; x++) {
        const v = y * n + x;
        const i = vmap[v];
        if (only && !only.has(i)) continue;
        const e = elev[i];
        const px = ((x - y) * TW) / 2;
        const py = ((x + y) * TH) / 2 - e;
        // side faces down to the front neighbours
        const eL = y + 1 < n ? elev[vmap[v + n]] : 0;
        const eR = x + 1 < n ? elev[vmap[v + 1]] : 0;
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

        const pid = w.plotOf[i];
        const field = pid >= 0 ? this.fields.get(pid) : undefined;
        if (!detailed) {
          // from afar a farm is a patch of its colour
          if (field) {
            ctx.fillStyle = fieldTint(field.f.crop, field.s.stage, w.plots[pid].water);
            ctx.fill();
          }
          continue;
        }
        const k = kinds[i];
        // plot borders
        if (pid >= 0) {
          ctx.strokeStyle = w.plots[pid].water ? "rgba(255,255,255,0.22)" : "rgba(20,24,30,0.35)";
          ctx.lineWidth = 0.9;
          ctx.beginPath();
          if (x + 1 >= n || w.plotOf[vmap[v + 1]] !== pid) {
            ctx.moveTo(px + hw, py + hh);
            ctx.lineTo(px, py + TH);
          }
          if (y + 1 >= n || w.plotOf[vmap[v + n]] !== pid) {
            ctx.moveTo(px, py + TH);
            ctx.lineTo(px - hw, py + hh);
          }
          if (x === 0 || w.plotOf[vmap[v - 1]] !== pid) {
            ctx.moveTo(px - hw, py + hh);
            ctx.lineTo(px, py);
          }
          if (y === 0 || w.plotOf[vmap[v - n]] !== pid) {
            ctx.moveTo(px, py);
            ctx.lineTo(px + hw, py + hh);
          }
          ctx.stroke();
        }
        // world tile, for details that depend on where the tile is, not where it is drawn
        const wx = i % n;
        const wy = (i - wx) / n;
        if (k === "forest") this.drawTree(ctx, px, py + hh, i);
        else if (k === "rail" || k === "railbridge" || k === "station") this.drawRail(ctx, px, py, wx, wy);
        else if (k === "runway") {
          this.drawRunway(ctx, px, py, wx, wy);
          if ((wx * 31 + wy * 17) % 41 === 0) this.drawPlane(ctx, px, py + hh, this.viewAxis(this.axis(wx, wy, ["runway"])), 1.25);
        } else if (k === "apron" && (wx * 7 + wy * 13) % 6 === 0) this.drawPlane(ctx, px, py + hh, (wx + wy) % 2 ? "x" : "y", 1);
        else if ((k === "road" || k === "bridge") && night && (wx + wy) % 3 === 0) {
          ctx.fillStyle = "rgba(255,214,140,0.85)";
          ctx.fillRect(px - 1.3, py + hh - 1.3, 2.6, 2.6);
        } else if (k === "terminal") {
          ctx.fillStyle = night ? "rgba(255,230,160,0.9)" : "rgba(255,255,255,0.7)";
          ctx.fillRect(px - 5, py + hh - 1, 10, 2);
        }
        if (field && !this.yard(pid, x, y)) {
          // a farm covers the plot's free tiles; a house keeps its own tile and a small yard
          drawFieldTile(ctx, px, py, TW, TH, i, field.f, field.s, w.plots[pid].water, night, performance.now());
          continue;
        }
        if (this.showBuildings && this.houseAt[i] >= 0) this.drawBuilding(ctx, px, py + hh, this.houseAt[i]);
        else if (this.showBuildings && this.towerAt[i] >= 0) this.drawTowerColumn(ctx, px, py, x, y, this.buildings[this.towerAt[i]]!.tower!);
      }
    }
  }

  /**
   * One tile-sized column of a skyscraper. Columns of the same tower join without gaps,
   * so the tower follows its plot's shape; outer edges step in to leave a sidewalk.
   * (px, py) is the top corner of the tile.
   */
  private drawTowerColumn(ctx: CanvasRenderingContext2D, px: number, py: number, x: number, y: number, t: Tower) {
    const w = this.world;
    const n = w.size;
    // x, y are view tiles: the neighbours that matter are the ones next to it on screen
    const i = this.vmap[y * n + x];
    const id = this.towerAt[i];
    const same = (xx: number, yy: number) => xx >= 0 && yy >= 0 && xx < n && yy < n && this.towerAt[this.vmap[yy * n + xx]] === id;
    const floorsAt = (xx: number, yy: number) => (same(xx, yy) ? this.towerFloors[this.vmap[yy * n + xx]] : 0);
    const u0 = same(x - 1, y) ? 0 : TOWER_INSET;
    const u1 = same(x + 1, y) ? 1 : 1 - TOWER_INSET;
    const v0 = same(x, y - 1) ? 0 : TOWER_INSET;
    const v1 = same(x, y + 1) ? 1 : 1 - TOWER_INSET;
    const hw = TW / 2;
    const hh = TH / 2;
    const P = (u: number, v: number, z: number) => ({ x: px + (u - v) * hw, y: py + (u + v) * hh - z });
    const floors = this.towerFloors[i];
    const H = floors * TOWER_FLOOR_PX;
    const night = this.isNight;
    const glass = t.glass;
    const seed = (i * 2654435761) >>> 0;
    const face = (ua: number, va: number, ub: number, vb: number, zFrom: number, k: number) => {
      if (zFrom >= H) return;
      const a0 = P(ua, va, zFrom);
      const b0 = P(ub, vb, zFrom);
      const a1 = P(ua, va, H);
      const b1 = P(ub, vb, H);
      ctx.fillStyle = shade(glass, this.day, k);
      ctx.beginPath();
      ctx.moveTo(a0.x, a0.y);
      ctx.lineTo(b0.x, b0.y);
      ctx.lineTo(b1.x, b1.y);
      ctx.lineTo(a1.x, a1.y);
      ctx.closePath();
      ctx.fill();
      const at = (s: number, z: number) => ({ x: a0.x + (b0.x - a0.x) * s, y: a0.y + (b0.y - a0.y) * s - (z - zFrom) });
      const frame = shade(t.frame, this.day, k);
      const lit = night ? "rgba(255,226,150,0.95)" : shade([238, 246, 255], this.day, k * 0.95);
      switch (t.facade) {
        case "grid": {
          const step = TOWER_FLOOR_PX * 2;
          ctx.fillStyle = lit;
          for (let z = zFrom + step * 0.6, r = 0; z < H - 1; z += step, r++)
            for (let c = 0; c < 3; c++) {
              if (night && ((seed >>> ((r + c) % 24)) & 3) === 0) continue;
              const q = at((c + 0.55) / 3.1, z);
              ctx.fillRect(q.x - 0.9, q.y - 0.9, 1.8, 1.8);
            }
          break;
        }
        case "bands": {
          ctx.strokeStyle = frame;
          ctx.lineWidth = 1.1;
          ctx.beginPath();
          for (let z = zFrom + TOWER_FLOOR_PX * 3; z < H; z += TOWER_FLOOR_PX * 3) {
            const q0 = at(0, z);
            const q1 = at(1, z);
            ctx.moveTo(q0.x, q0.y);
            ctx.lineTo(q1.x, q1.y);
          }
          ctx.stroke();
          if (night) {
            ctx.fillStyle = lit;
            for (let z = zFrom + TOWER_FLOOR_PX * 1.5, r = 0; z < H; z += TOWER_FLOOR_PX * 3, r++) {
              if (((seed >>> (r % 28)) & 1) === 0) continue;
              const q = at(((r * 37) % 10) / 12 + 0.05, z);
              ctx.fillRect(q.x - 2, q.y - 0.6, 4, 1.2);
            }
          }
          break;
        }
        case "fins": {
          ctx.strokeStyle = frame;
          ctx.lineWidth = 0.9;
          ctx.beginPath();
          for (let c = 1; c < 5; c++) {
            const q0 = at(c / 5, zFrom);
            const q1 = at(c / 5, H);
            ctx.moveTo(q0.x, q0.y);
            ctx.lineTo(q1.x, q1.y);
          }
          ctx.stroke();
          if (night) {
            ctx.fillStyle = lit;
            for (let z = zFrom + 2, r = 0; z < H - 1; z += TOWER_FLOOR_PX * 2, r++) {
              const c = (seed >>> (r % 26)) % 5;
              const q = at((c + 0.5) / 5, z);
              ctx.fillRect(q.x - 0.8, q.y - 0.8, 1.6, 1.6);
            }
          }
          break;
        }
        case "curtain": {
          // a sky reflection sweeping across the glass
          const r0 = at(0.25, zFrom);
          const r1 = at(0.55, zFrom);
          ctx.fillStyle = night ? "rgba(140,200,255,0.10)" : "rgba(255,255,255,0.22)";
          ctx.beginPath();
          ctx.moveTo(r0.x, r0.y);
          ctx.lineTo(r1.x, r1.y);
          ctx.lineTo(r1.x, a1.y + (r1.y - a0.y) - (H - zFrom) * 0.02);
          ctx.lineTo(r0.x, a1.y + (r0.y - a0.y));
          ctx.closePath();
          ctx.fill();
          if (night) {
            ctx.fillStyle = lit;
            for (let z = zFrom + 2, r = 0; z < H - 1; z += TOWER_FLOOR_PX * 1.5, r++) {
              if (((seed >>> (r % 30)) & 3) !== 0) continue;
              const q = at(((r * 53) % 9) / 10 + 0.05, z);
              ctx.fillRect(q.x - 1, q.y - 0.7, 2, 1.4);
            }
          }
          break;
        }
      }
    };
    // left face: the south edge, right face: the east edge
    face(u0, v1, u1, v1, floorsAt(x, y + 1) * TOWER_FLOOR_PX, 0.95);
    face(u1, v1, u1, v0, floorsAt(x + 1, y) * TOWER_FLOOR_PX, 0.72);
    // roof
    const c00 = P(u0, v0, H);
    const c10 = P(u1, v0, H);
    const c11 = P(u1, v1, H);
    const c01 = P(u0, v1, H);
    ctx.fillStyle = shade(t.frame, this.day, 0.9);
    ctx.beginPath();
    ctx.moveTo(c00.x, c00.y);
    ctx.lineTo(c10.x, c10.y);
    ctx.lineTo(c11.x, c11.y);
    ctx.lineTo(c01.x, c01.y);
    ctx.closePath();
    ctx.fill();
    if (i === t.crown) this.drawTowerTop(ctx, P(0.5, 0.5, H), t, (u1 - u0) * hw, (v1 - v0) * hh);
  }

  private drawTowerTop(ctx: CanvasRenderingContext2D, c: { x: number; y: number }, t: Tower, a: number, b: number) {
    const night = this.isNight;
    const frame = shade(t.frame, this.day, 1);
    const glow = (r: number, y: number) => {
      const g = ctx.createRadialGradient(c.x, y, 0, c.x, y, r);
      g.addColorStop(0, night ? "rgba(255,90,80,0.95)" : "rgba(255,120,100,0.8)");
      g.addColorStop(1, "rgba(255,90,80,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(c.x, y, r, 0, Math.PI * 2);
      ctx.fill();
    };
    ctx.strokeStyle = frame;
    switch (t.top) {
      case "roofbox":
        ctx.fillStyle = shade(t.frame, this.day, 0.7);
        ctx.fillRect(c.x - a * 0.35, c.y - 6, a * 0.7, 6);
        break;
      case "spire":
        ctx.fillStyle = shade(t.glass, this.day, 1.15);
        ctx.beginPath();
        ctx.moveTo(c.x - a * 0.25, c.y);
        ctx.lineTo(c.x + a * 0.25, c.y);
        ctx.lineTo(c.x, c.y - 46);
        ctx.closePath();
        ctx.fill();
        glow(4, c.y - 46);
        break;
      case "antenna":
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(c.x - 3, c.y);
        ctx.lineTo(c.x - 3, c.y - 30);
        ctx.moveTo(c.x + 3, c.y + 1);
        ctx.lineTo(c.x + 3, c.y - 20);
        ctx.stroke();
        glow(3, c.y - 30);
        break;
      case "crown":
        ctx.fillStyle = shade(t.frame, this.day, 1.05);
        ctx.beginPath();
        ctx.moveTo(c.x - a, c.y);
        ctx.lineTo(c.x, c.y + b);
        ctx.lineTo(c.x, c.y - 24);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = shade(t.frame, this.day, 0.75);
        ctx.beginPath();
        ctx.moveTo(c.x + a, c.y);
        ctx.lineTo(c.x, c.y + b);
        ctx.lineTo(c.x, c.y - 24);
        ctx.closePath();
        ctx.fill();
        break;
      case "helipad":
        ctx.fillStyle = shade([70, 74, 86], this.day);
        ctx.beginPath();
        ctx.ellipse(c.x, c.y, a * 0.8, b * 0.8, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = night ? "rgba(255,230,120,0.95)" : "rgba(255,255,255,0.9)";
        ctx.lineWidth = 0.8;
        ctx.stroke();
        ctx.fillStyle = ctx.strokeStyle;
        ctx.font = "bold 6px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("H", c.x, c.y);
        break;
      case "dome":
        ctx.fillStyle = shade(t.glass, this.day, 1.2);
        ctx.beginPath();
        ctx.ellipse(c.x, c.y, a * 0.8, a * 0.7, 0, Math.PI, 0);
        ctx.fill();
        break;
      case "beacon": {
        ctx.fillStyle = shade(t.frame, this.day, 0.85);
        ctx.fillRect(c.x - 2, c.y - 12, 4, 12);
        const g = ctx.createRadialGradient(c.x, c.y - 14, 0, c.x, c.y - 14, night ? 26 : 12);
        g.addColorStop(0, `rgba(${t.glass.map((v) => Math.min(255, v + 90)).join(",")},0.95)`);
        g.addColorStop(1, "rgba(120,220,255,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(c.x, c.y - 14, night ? 26 : 12, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
    }
  }

  /** An isometric house standing on the centre (px, py) of a tile. */
  private drawBuilding(ctx: CanvasRenderingContext2D, px: number, py: number, id: number) {
    const b = this.buildings[id];
    if (!b) return;
    if (b.cottage) return drawCottage(ctx, px, py, b.cottage, this.cottageColors[id]!, TW, TH, this.rot);
    const st: BuildingStyle = b.style;
    const col = this.houseColors[id]!;
    const a = (TW / 2) * st.footprint;
    const c = (TH / 2) * st.footprint;
    let base = py;
    if (st.stilts) {
      ctx.strokeStyle = col.post;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const [dx, dy] of [[-a * 0.8, 0], [0, c * 0.8], [a * 0.8, 0]]) {
        ctx.moveTo(px + dx, py + dy);
        ctx.lineTo(px + dx, py + dy - 5);
      }
      ctx.stroke();
      base -= 5;
    }
    const H = b.floors * FLOOR_PX + (st.roof === "flat" ? 1 : 0);
    const top = base - H;
    // walls
    ctx.fillStyle = col.wl;
    ctx.beginPath();
    ctx.moveTo(px - a, base);
    ctx.lineTo(px, base + c);
    ctx.lineTo(px, top + c);
    ctx.lineTo(px - a, top);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = col.wr;
    ctx.beginPath();
    ctx.moveTo(px + a, base);
    ctx.lineTo(px, base + c);
    ctx.lineTo(px, top + c);
    ctx.lineTo(px + a, top);
    ctx.closePath();
    ctx.fill();
    // a row of windows on each floor
    ctx.fillStyle = col.win;
    const cols = b.cols;
    for (let f = 0; f < b.floors; f++) {
      const fy = base - f * FLOOR_PX - FLOOR_PX * 0.62;
      for (let k = 0; k < cols; k++) {
        const t = (k + 0.7) / (cols + 0.4);
        // left face runs from (px-a, fy) to (px, fy+c); right face mirrors it
        const lx = px - a + a * t;
        const ly = fy + c * t;
        ctx.fillRect(lx - 0.8, ly - 1.1, 1.6, 2.2);
        const rx = px + a - a * t;
        ctx.fillRect(rx - 0.8, ly - 1.1, 1.6, 2.2);
      }
    }
    if (b.balconies) {
      ctx.strokeStyle = col.roof;
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      for (let f = 1; f < b.floors; f++) {
        const fy = base - f * FLOOR_PX;
        ctx.moveTo(px - a, fy);
        ctx.lineTo(px, fy + c);
        ctx.lineTo(px + a, fy);
      }
      ctx.stroke();
    }
    if (st.roof === "deco" || st.roof === "mansion") {
      // gilded verticals and a cornice: the Jazz Age signature
      ctx.strokeStyle = col.trim;
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      for (const t of st.roof === "deco" ? [0.2, 0.5, 0.8] : [0.15, 0.4, 0.65, 0.9]) {
        ctx.moveTo(px - a + a * t, base + c * t);
        ctx.lineTo(px - a + a * t, top + c * t);
        ctx.moveTo(px + a - a * t, base + c * t);
        ctx.lineTo(px + a - a * t, top + c * t);
      }
      ctx.moveTo(px - a, top + 1);
      ctx.lineTo(px, top + c + 1);
      ctx.lineTo(px + a, top + 1);
      ctx.stroke();
    }
    let roofTop = top;
    if (b.setback && st.roof !== "deco") {
      // a smaller penthouse floor on top
      const a2 = a * 0.62;
      const c2 = c * 0.62;
      const t2 = top - FLOOR_PX;
      ctx.fillStyle = col.roof;
      ctx.beginPath();
      ctx.moveTo(px, top - c);
      ctx.lineTo(px + a, top);
      ctx.lineTo(px, top + c);
      ctx.lineTo(px - a, top);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = col.wl;
      ctx.beginPath();
      ctx.moveTo(px - a2, top);
      ctx.lineTo(px, top + c2);
      ctx.lineTo(px, t2 + c2);
      ctx.lineTo(px - a2, t2);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = col.wr;
      ctx.beginPath();
      ctx.moveTo(px + a2, top);
      ctx.lineTo(px, top + c2);
      ctx.lineTo(px, t2 + c2);
      ctx.lineTo(px + a2, t2);
      ctx.closePath();
      ctx.fill();
      roofTop = t2;
    }
    const k2 = b.setback && st.roof !== "deco" ? 0.62 : 1;
    this.drawRoof(ctx, px, roofTop, a * k2, c * k2, b, col);
  }

  private drawRoof(
    ctx: CanvasRenderingContext2D,
    px: number,
    top: number,
    a: number,
    c: number,
    b: Building,
    col: { wl: string; wr: string; roof: string; roofDark: string; win: string; post: string; trim: string },
  ) {
    const st = b.style;
    const diamond = (cx: number, cy: number, aa: number, cc: number) => {
      ctx.beginPath();
      ctx.moveTo(cx, cy - cc);
      ctx.lineTo(cx + aa, cy);
      ctx.lineTo(cx, cy + cc);
      ctx.lineTo(cx - aa, cy);
      ctx.closePath();
    };
    const pyramid = (cy: number, aa: number, cc: number, rise: number) => {
      ctx.fillStyle = col.roofDark;
      ctx.beginPath();
      ctx.moveTo(px - aa, cy);
      ctx.lineTo(px, cy - cc);
      ctx.lineTo(px + aa, cy);
      ctx.lineTo(px, cy - rise);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = col.roof;
      ctx.beginPath();
      ctx.moveTo(px - aa, cy);
      ctx.lineTo(px, cy + cc);
      ctx.lineTo(px + aa, cy);
      ctx.lineTo(px, cy - rise);
      ctx.closePath();
      ctx.fill();
    };
    switch (st.roof) {
      case "flat":
        ctx.fillStyle = col.roof;
        diamond(px, top, a, c);
        ctx.fill();
        if ((st.id === "skyline" || st.id === "spire") && b.floors > 18) {
          ctx.strokeStyle = col.roof;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(px, top);
          ctx.lineTo(px, top - 10);
          ctx.stroke();
        }
        break;
      case "gable": {
        // ridge along the tile's x axis
        const r = c * 1.4;
        const m1 = { x: px - a / 2, y: top - c / 2 - r };
        const m2 = { x: px + a / 2, y: top + c / 2 - r };
        ctx.fillStyle = col.roofDark;
        ctx.beginPath();
        ctx.moveTo(px, top - c);
        ctx.lineTo(px + a, top);
        ctx.lineTo(m2.x, m2.y);
        ctx.lineTo(m1.x, m1.y);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = col.wr;
        ctx.beginPath();
        ctx.moveTo(px, top + c);
        ctx.lineTo(px + a, top);
        ctx.lineTo(m2.x, m2.y);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = col.roof;
        ctx.beginPath();
        ctx.moveTo(px - a, top);
        ctx.lineTo(px, top + c);
        ctx.lineTo(m2.x, m2.y);
        ctx.lineTo(m1.x, m1.y);
        ctx.closePath();
        ctx.fill();
        break;
      }
      case "dome":
        ctx.fillStyle = col.roof;
        ctx.beginPath();
        ctx.ellipse(px, top + c * 0.2, a, a * 0.85, 0, Math.PI, 0);
        ctx.fill();
        ctx.fillStyle = col.roofDark;
        ctx.beginPath();
        ctx.ellipse(px + a * 0.35, top + c * 0.2, a * 0.65, a * 0.7, 0, Math.PI * 1.5, 0);
        ctx.lineTo(px + a * 0.35, top + c * 0.2);
        ctx.fill();
        break;
      case "cone":
        pyramid(top, a * 1.15, c * 1.15, c * 2.6);
        break;
      case "factory": {
        ctx.fillStyle = col.roof;
        diamond(px, top, a, c);
        ctx.fill();
        // saw-tooth skylights along the roof
        ctx.fillStyle = col.roofDark;
        for (let k = 0; k < 3; k++) {
          const t = (k + 0.5) / 3;
          const x0 = px - a + a * t;
          const y0 = top - c + c * t;
          ctx.beginPath();
          ctx.moveTo(x0, y0 + c * 0.55);
          ctx.lineTo(x0 + a * 0.45, y0 + c);
          ctx.lineTo(x0 + a * 0.45, y0 + c - 4);
          ctx.closePath();
          ctx.fill();
        }
        // chimney with smoke
        const cx = px + a * 0.45;
        const cy = top - c * 0.1;
        ctx.fillStyle = shade([150, 70, 56], this.day);
        ctx.fillRect(cx - 1.6, cy - 16, 3.2, 16);
        ctx.fillStyle = "rgba(220,224,230,0.55)";
        for (const [dx, dy, r] of [[1, -19, 2.4], [3, -23, 3], [6, -27, 3.6]]) {
          ctx.beginPath();
          ctx.arc(cx + dx, cy + dy, r, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      }
      case "mansion": {
        // a low hipped slate roof, gold ridge, and a white portico on the front
        pyramid(top, a, c, c * 1.1);
        ctx.strokeStyle = col.trim;
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(px - a, top);
        ctx.lineTo(px, top + c);
        ctx.lineTo(px + a, top);
        ctx.stroke();
        ctx.fillStyle = "rgba(255,255,255,0.9)";
        for (const t of [0.35, 0.5, 0.65]) ctx.fillRect(px - a + a * t - 0.5, top + c * t, 1, b.floors * FLOOR_PX);
        break;
      }
      case "deco": {
        // stepped crown of three tiers and a needle, edged in gold
        let aa = a;
        let cc = c;
        let y = top;
        for (let k = 0; k < 3; k++) {
          const na = aa * 0.72;
          const nc = cc * 0.72;
          const hgt = 6 - k;
          ctx.fillStyle = col.roof;
          diamond(px, y, aa, cc);
          ctx.fill();
          ctx.fillStyle = col.wl;
          ctx.beginPath();
          ctx.moveTo(px - na, y);
          ctx.lineTo(px, y + nc);
          ctx.lineTo(px, y + nc - hgt);
          ctx.lineTo(px - na, y - hgt);
          ctx.closePath();
          ctx.fill();
          ctx.fillStyle = col.wr;
          ctx.beginPath();
          ctx.moveTo(px + na, y);
          ctx.lineTo(px, y + nc);
          ctx.lineTo(px, y + nc - hgt);
          ctx.lineTo(px + na, y - hgt);
          ctx.closePath();
          ctx.fill();
          aa = na;
          cc = nc;
          y -= hgt;
        }
        ctx.fillStyle = col.trim;
        diamond(px, y, aa, cc);
        ctx.fill();
        ctx.strokeStyle = col.trim;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(px, y);
        ctx.lineTo(px, y - 14);
        ctx.stroke();
        break;
      }
      case "pagoda":
        pyramid(top, a * 1.3, c * 1.3, c * 1.2);
        ctx.fillStyle = col.wl;
        ctx.fillRect(px - a * 0.45, top - c * 1.2 - 3, a * 0.9, 3);
        pyramid(top - c * 1.2 - 3, a * 0.9, c * 0.9, c * 1.6);
        break;
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
    } else if (biome === "oceania") {
      // palm: a leaning trunk and a crown of fronds
      ctx.strokeStyle = "rgba(120,90,60,0.95)";
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(x, py + 1);
      ctx.quadraticCurveTo(x + 1, py - 6, x + 3, py - 11);
      ctx.stroke();
      ctx.strokeStyle = this.tree[i];
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      for (const [dx, dy] of [[-6, 2], [6, 2], [-4, -3], [5, -3], [0, -5]]) {
        ctx.moveTo(x + 3, py - 11);
        ctx.quadraticCurveTo(x + 3 + dx * 0.5, py - 13 + dy * 0.3, x + 3 + dx, py - 11 + dy);
      }
      ctx.stroke();
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

  /** A small airliner seen from above, nose along the tile axis. */
  private drawPlane(ctx: CanvasRenderingContext2D, px: number, py: number, ax: "x" | "y", k: number) {
    // screen directions of the tile axes
    const f = ax === "x" ? { x: TW / 2, y: TH / 2 } : { x: -TW / 2, y: TH / 2 };
    const s = ax === "x" ? { x: -TW / 2, y: TH / 2 } : { x: TW / 2, y: TH / 2 };
    const P = (u: number, v: number) => ({ x: px + (f.x * u + s.x * v) * k, y: py - 3 + (f.y * u + s.y * v) * k });
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    ctx.beginPath();
    ctx.ellipse(px + 1, py + 1, 9 * k, 4 * k, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = this.isNight ? "#c8d0e0" : "#ffffff";
    const poly = (pts: [number, number][]) => {
      ctx.beginPath();
      pts.forEach(([u, v], n) => {
        const q = P(u, v);
        if (n) ctx.lineTo(q.x, q.y);
        else ctx.moveTo(q.x, q.y);
      });
      ctx.closePath();
      ctx.fill();
    };
    poly([[-0.42, -0.04], [0.4, -0.04], [0.46, 0], [0.4, 0.04], [-0.42, 0.04]]); // fuselage
    poly([[0.02, -0.04], [-0.12, -0.36], [-0.18, -0.36], [-0.1, -0.04], [-0.1, 0.04], [-0.18, 0.36], [-0.12, 0.36], [0.02, 0.04]]); // wings
    poly([[-0.34, -0.03], [-0.44, -0.14], [-0.47, -0.14], [-0.42, 0], [-0.47, 0.14], [-0.44, 0.14], [-0.34, 0.03]]); // tail
    ctx.fillStyle = "#3a8fd6";
    poly([[0.3, -0.035], [0.38, -0.03], [0.38, 0.03], [0.3, 0.035]]);
  }

  private axis(x: number, y: number, kinds: Kind[]): "x" | "y" {
    const n = this.world.size;
    const at = (xx: number, yy: number) => xx >= 0 && yy >= 0 && xx < n && yy < n && kinds.includes(this.kinds[yy * n + xx]);
    const horiz = (at(x - 1, y) ? 1 : 0) + (at(x + 1, y) ? 1 : 0);
    const vert = (at(x, y - 1) ? 1 : 0) + (at(x, y + 1) ? 1 : 0);
    return horiz >= vert ? "x" : "y";
  }

  /** A world axis as seen on screen: a quarter turn swaps x and y. */
  private viewAxis(ax: "x" | "y"): "x" | "y" {
    return this.rot % 2 ? (ax === "x" ? "y" : "x") : ax;
  }

  private drawRail(ctx: CanvasRenderingContext2D, px: number, py: number, x: number, y: number) {
    const ax = this.viewAxis(this.axis(x, y, ["rail", "railbridge", "station"]));
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
    const wax = this.axis(x, y, ["runway"]);
    if ((wax === "x" ? x : y) % 2) return;
    const ax = this.viewAxis(wax);
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
      const v = this.wmap[t];
      const x = v % n;
      const y = (v - x) / n;
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
      const { px, py } = this.at(plot.anchor.x, plot.anchor.y);
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
    const c = this.world.center;
    if (this.second && this.at(this.second.anchor.x, this.second.anchor.y).py < this.at(c, c).py) {
      this.drawSecond(time);
      this.drawTowerAt(time, c, c, 1.6, TOWER_HEIGHT, 0.55, this.towerSelected, 12);
    } else {
      this.drawTowerAt(time, c, c, 1.6, TOWER_HEIGHT, 0.55, this.towerSelected, 12);
      this.drawSecond(time);
    }
  }

  private drawSecond(time: number) {
    if (!this.second) return;
    this.drawTowerAt(time, this.second.anchor.x, this.second.anchor.y, 1.9, SECOND_HEIGHT, 0.32, this.secondSelected, 40);
  }

  /** A landmark tower on a tile: two glass faces narrowing to the top, floor bands, a beacon. */
  private drawTowerAt(time: number, x: number, y: number, size: number, H: number, taper: number, selected: boolean, bands: number) {
    const { ctx } = this;
    const { px: bx, py: ty } = this.at(x, y);
    const by = ty + TH / 2;
    const hw = size * (TW / 2);
    const hh = size * (TH / 2);
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
    for (let f = 1; f < bands; f++) {
      const t = f / bands;
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
    if (selected) {
      ctx.strokeStyle = "rgba(160,250,255,0.95)";
      ctx.lineWidth = 2 / Math.max(this.camera.scale, 0.25);
      ctx.beginPath();
      ctx.moveTo(bx - hw - 4, by);
      ctx.lineTo(bx, by + hh + 3);
      ctx.lineTo(bx + hw + 4, by);
      ctx.stroke();
    }
  }

  /** Arcade signs: a round badge on a short pole over each plot with an attraction. */
  private drawAttractions(time: number) {
    if (!this.attractions.size) return;
    const { ctx } = this;
    const k = 1 / this.camera.scale;
    const r = 11 * k;
    const pulse = 0.5 + 0.5 * Math.sin(time / 380);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `800 ${13 * k}px Inter, system-ui, sans-serif`;
    for (const [id, a] of this.attractions) {
      const p = this.world.plots[id];
      if (!p) continue;
      const { px, py } = this.at(p.anchor.x, p.anchor.y);
      const y = py - 34 * k;
      const col = a.ai ? "56,232,255" : "255,92,210";
      ctx.strokeStyle = `rgba(${col},0.9)`;
      ctx.lineWidth = 2 * k;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px, y + r);
      ctx.stroke();
      ctx.fillStyle = `rgba(${col},${0.18 + 0.22 * pulse})`;
      ctx.beginPath();
      ctx.arc(px, y, r * (1.35 + 0.35 * pulse), 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgba(${col},0.95)`;
      ctx.beginPath();
      ctx.arc(px, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#0b1030";
      ctx.fillText(a.glyph, px, y + 0.5 * k);
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
    const at = (x: number, y: number) => this.at(x, y);

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
    // seats of government on the plaza
    if (s > 0.35) {
      for (const b of CIVIC) {
        const label = this.civicLabels[b.id];
        if (!label) continue;
        const { px, py } = at(w.center + b.dx, w.center + b.dy);
        pill(label, px, py + 12 * k, 10, "#fff7dc", this.busyCivic.has(b.id) ? "rgba(10,120,90,0.88)" : "rgba(60,48,20,0.82)");
      }
    }
    // street names and house numbers when zoomed in
    if (s > 0.9) {
      const r = this.visibleRange();
      // skip labels that would overlap one already drawn
      const placed: { x: number; y: number }[] = [];
      for (const road of w.roads) {
        const { x, y } = this.viewTile(road.mid.x, road.mid.y);
        if (x < r.x0 || x > r.x1 || y < r.y0 || y > r.y1) continue;
        const { px, py } = at(road.mid.x, road.mid.y);
        if (placed.some((q) => Math.abs(q.x - px) * s < 130 && Math.abs(q.y - py) * s < 26)) continue;
        placed.push({ x: px, y: py });
        pill(road.name, px, py, 10, "#ffffff", "rgba(40,44,60,0.85)");
      }
      ctx.font = font(10, 600);
      ctx.fillStyle = "rgba(10,20,30,0.8)";
      for (const p of w.plots) {
        if (p.water) continue;
        const { x, y } = this.viewTile(p.anchor.x, p.anchor.y);
        if (x < r.x0 || x > r.x1 || y < r.y0 || y > r.y1) continue;
        const { px, py } = at(p.anchor.x, p.anchor.y);
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

/** A small boat under the drop while it is on the water (boat or ferry). */
function drawHull(ctx: CanvasRenderingContext2D, px: number, py: number, s: number, time: number) {
  const k = Math.max(0.6, Math.min(1.6, s));
  const bob = Math.sin(time / 260) * 1.2 * k;
  const w = 15 * k;
  const h = 5 * k;
  const y = py + bob;
  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,0.35)";
  ctx.beginPath();
  ctx.ellipse(px, y + h + 1.5 * k, w * 1.15, 2.2 * k, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#7c4a24";
  ctx.strokeStyle = "#f5e6c8";
  ctx.lineWidth = Math.max(1, k);
  ctx.beginPath();
  ctx.moveTo(px - w, y - h * 0.4);
  ctx.lineTo(px + w, y - h * 0.4);
  ctx.quadraticCurveTo(px + w * 0.7, y + h, px, y + h);
  ctx.quadraticCurveTo(px - w * 0.7, y + h, px - w, y - h * 0.4);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}
