import type { Plot, World } from "./generator";
import { region } from "./regions";
import type { RGB } from "./palette";
import { cottageDesign, designCottages, type Cottage } from "./cottages";

export type Roof = "flat" | "gable" | "dome" | "cone" | "pagoda" | "factory" | "mansion" | "deco";

export interface BuildingStyle {
  id: string;
  roof: Roof;
  wall: RGB;
  roofColor: RGB;
  /** Glow of the windows at night. */
  window: RGB;
  /** Raised on stilts above wet ground. */
  stilts?: boolean;
  floors: [number, number];
  /** Footprint as a share of one tile, 0..1. */
  footprint: number;
}

/** House styles of the starter catalogue, by climate. Every climate has its own look. */
export const STYLES: Record<string, BuildingStyle> = {
  skyline: { id: "skyline", roof: "flat", wall: [120, 170, 214], roofColor: [190, 214, 236], window: [170, 236, 255], floors: [40, 100], footprint: 0.85 },
  spire: { id: "spire", roof: "flat", wall: [92, 196, 190], roofColor: [200, 240, 236], window: [190, 255, 246], floors: [40, 100], footprint: 0.85 },
  loft: { id: "loft", roof: "flat", wall: [176, 160, 150], roofColor: [120, 112, 110], window: [255, 214, 150], floors: [6, 16], footprint: 0.78 },
  garden: { id: "garden", roof: "gable", wall: [236, 228, 210], roofColor: [186, 74, 58], window: [255, 220, 150], floors: [1, 2], footprint: 0.76 },
  snowdome: { id: "snowdome", roof: "dome", wall: [236, 244, 252], roofColor: [246, 250, 255], window: [255, 200, 120], floors: [1, 2], footprint: 0.76 },
  lodge: { id: "lodge", roof: "gable", wall: [132, 92, 64], roofColor: [230, 238, 246], window: [255, 196, 110], floors: [1, 2], footprint: 0.76 },
  adobe: { id: "adobe", roof: "flat", wall: [220, 170, 112], roofColor: [204, 150, 96], window: [255, 214, 140], floors: [1, 2], footprint: 0.76 },
  canopy: { id: "canopy", roof: "cone", wall: [150, 110, 70], roofColor: [70, 140, 60], window: [255, 226, 140], floors: [1, 2], footprint: 0.76 },
  rondavel: { id: "rondavel", roof: "cone", wall: [214, 186, 140], roofColor: [176, 140, 70], window: [255, 210, 130], floors: [1, 2], footprint: 0.76 },
  stiltcabin: { id: "stiltcabin", roof: "gable", wall: [120, 140, 120], roofColor: [80, 96, 86], window: [255, 220, 140], floors: [1, 2], footprint: 0.76 },
  basalt: { id: "basalt", roof: "flat", wall: [70, 58, 60], roofColor: [52, 44, 46], window: [255, 120, 50], floors: [1, 2], footprint: 0.7 },
  cedar: { id: "cedar", roof: "gable", wall: [214, 176, 128], roofColor: [176, 86, 40], window: [255, 206, 120], floors: [1, 2], footprint: 0.76 },
  pagoda: { id: "pagoda", roof: "pagoda", wall: [246, 232, 236], roofColor: [196, 70, 96], window: [255, 214, 196], floors: [1, 2], footprint: 0.76 },
  factory: { id: "factory", roof: "factory", wall: [176, 120, 96], roofColor: [110, 116, 126], window: [255, 200, 120], floors: [2, 4], footprint: 0.9 },
  warehouse: { id: "warehouse", roof: "flat", wall: [140, 156, 172], roofColor: [176, 182, 190], window: [255, 214, 150], floors: [2, 3], footprint: 0.92 },
  hangar: { id: "hangar", roof: "dome", wall: [206, 212, 220], roofColor: [176, 186, 198], window: [190, 230, 255], floors: [2, 3], footprint: 0.9 },
  resort: { id: "resort", roof: "flat", wall: [248, 248, 242], roofColor: [214, 222, 230], window: [150, 230, 255], floors: [1, 2], footprint: 0.78 },
  mansion: { id: "mansion", roof: "mansion", wall: [244, 232, 206], roofColor: [58, 64, 80], window: [255, 222, 150], floors: [1, 2], footprint: 0.9 },
  cottage: { id: "cottage", roof: "flat", wall: [244, 244, 240], roofColor: [62, 66, 74], window: [255, 214, 150], floors: [1, 2], footprint: 0.8 },
  decotower: { id: "decotower", roof: "deco", wall: [226, 210, 178], roofColor: [206, 166, 72], window: [255, 220, 150], floors: [8, 22], footprint: 0.74 },
};


export type Facade = "grid" | "bands" | "fins" | "curtain";
export type Top = "roofbox" | "spire" | "antenna" | "crown" | "helipad" | "dome" | "beacon";
export type Profile = "slab" | "stepped" | "podium" | "taper" | "twin";

/** A downtown skyscraper. It fills most of its plot and follows its shape. */
export interface Tower {
  name: string;
  glass: RGB;
  frame: RGB;
  facade: Facade;
  top: Top;
  profile: Profile;
  /** Tiles the tower stands on and the height of each, in floors. */
  tiles: number[];
  heights: number[];
  /** Tile that carries the top (spire, crown...). */
  crown: number;
}

export interface Building {
  style: BuildingStyle;
  floors: number;
  /** This building's own colours, so neighbours of one style still differ. */
  wall: RGB;
  roofColor: RGB;
  /** Window columns per face, balconies, and a set-back top floor. */
  cols: number;
  balconies: boolean;
  setback: boolean;
  tower?: Tower;
  /** Modern 1–2 storey cottage design, for cottage plots. */
  cottage?: Cottage;
}

/** Smallest plot for a skyscraper: 5 tiles = 2,000 m². */
export const TOWER_MIN_TILES = 5;

const GLASS: RGB[] = [
  [110, 160, 214], [84, 196, 190], [150, 170, 196], [60, 96, 150], [176, 206, 230], [112, 134, 160],
  [64, 140, 160], [150, 196, 176], [196, 180, 150], [120, 120, 170], [40, 70, 96], [170, 140, 120],
];
const FRAMES: RGB[] = [[230, 236, 244], [60, 66, 78], [200, 176, 120], [150, 160, 172]];
const FACADES: Facade[] = ["grid", "bands", "fins", "curtain"];
const TOPS: Top[] = ["roofbox", "spire", "antenna", "crown", "helipad", "dome", "beacon"];
const PROFILES: Profile[] = ["slab", "stepped", "podium", "taper", "twin"];
const NAME_A = [
  "Aurora", "Nova", "Zenith", "Halcyon", "Meridian", "Solace", "Vertex", "Lumen", "Orion", "Cascade", "Helix", "Prism",
  "Atlas", "Corona", "Equinox", "Vega", "Polaris", "Tidewater", "Skylark", "Obsidian", "Ivory", "Cobalt", "Sapphire", "Ember",
  "Quartz", "Monarch", "Beacon", "Horizon", "Summit", "Radiant", "Silverline", "Cirrus", "Northgate", "Lyra", "Orbit", "Pinnacle",
];
const NAME_B = ["Tower", "Spire", "Heights", "Centre", "Plaza", "One", "Point", "Exchange"];

const hash = (n: number) => {
  let h = (n * 2654435761) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 2246822519) >>> 0;
  return (h ^ (h >>> 13)) >>> 0;
};

/** House for a plot outside downtown, from its climate, landscape, size and distance to the tower. */
function houseFor(world: World, plot: Plot): Building {
  const biome = plot.district >= 0 ? world.districts[plot.district].biome : "temperate";
  const h = hash(plot.id + 1);
  const spec = region(biome);
  const id = plot.landscape === "beachfront" && spec.coastHouse ? spec.coastHouse : spec.houses[h % spec.houses.length];
  const style = STYLES[id];
  const [lo, hi] = style.floors;
  const near = Math.max(0, 1 - plot.distance / (world.params.landSize * 0.5));
  const big = Math.min(1, plot.tiles.length / 12);
  const t = Math.min(1, 0.4 * near + 0.3 * big + 0.3 * ((h >>> 8) % 100) / 100);
  const floors = Math.round(lo + (hi - lo) * t);
  return { style, floors, ...looks(style, h, floors) };
}

/** Per-building variety: shifted colours, window rhythm, balconies, a set-back top. */
function looks(style: BuildingStyle, h: number, floors: number) {
  const j = (c: number, k: number) => Math.max(0, Math.min(255, Math.round(c * (0.86 + ((h >>> k) % 29) / 100))));
  const swap = (h >>> 3) % 4 === 0; // now and then a contrasting facade
  const base = swap ? ([230, 222, 210] as RGB) : style.wall;
  return {
    wall: [j(base[0], 2), j(base[1], 7), j(base[2], 12)] as RGB,
    roofColor: [j(style.roofColor[0], 17), j(style.roofColor[1], 19), j(style.roofColor[2], 21)] as RGB,
    cols: 2 + ((h >>> 5) % 2),
    balconies: floors >= 4 && (h >>> 9) % 3 === 0,
    setback: floors >= 6 && (h >>> 13) % 3 === 0,
  };
}

/** The city centre: First Light City's plots near the tower. A law of the Council caps heights here. */
export const isCentre = (world: World, plot: Plot) =>
  plot.district >= 0 && world.districts[plot.district].biome === "metropolis" && plot.distance < world.params.landSize * 0.09;

/** A skyscraper needs land of 2,000 m² or more. */
export const towerSite = (plot: Plot) => hasHouse(plot) && plot.tiles.length >= TOWER_MIN_TILES;

/** Longest side of a skyscraper's footprint, in tiles. */
export const TOWER_MAX_SIDE = 3;

/**
 * Where a skyscraper stands on its plot: the largest rectangle (sides up to TOWER_MAX_SIDE, never
 * longer than twice its width) that lies wholly inside the plot, nearest the plot's middle. The
 * rest of the plot stays open ground, so a tower always keeps to its plot and its proportions.
 */
export function towerFootprint(world: World, plot: Plot): number[] {
  const n = world.size;
  const set = new Set(plot.tiles);
  const cx = plot.tiles.reduce((s, t) => s + (t % n), 0) / plot.tiles.length;
  const cy = plot.tiles.reduce((s, t) => s + Math.floor(t / n), 0) / plot.tiles.length;
  let best: number[] = [plot.tiles[0]];
  let score = -Infinity;
  for (const t of plot.tiles) {
    const x0 = t % n, y0 = Math.floor(t / n);
    for (let w = 1; w <= TOWER_MAX_SIDE; w++)
      for (let d = 1; d <= TOWER_MAX_SIDE; d++) {
        if (Math.max(w, d) > 2 * Math.min(w, d)) continue;
        const tiles: number[] = [];
        for (let y = y0; y < y0 + d; y++) for (let x = x0; x < x0 + w; x++) tiles.push(y * n + x);
        if (x0 + w > n || !tiles.every((j) => set.has(j))) continue;
        // bigger first, then squarer, then closer to the middle of the plot
        const s = w * d * 100 - Math.abs(w - d) * 10 - Math.hypot(x0 + (w - 1) / 2 - cx, y0 + (d - 1) / 2 - cy);
        if (s > score) {
          score = s;
          best = tiles;
        }
      }
  }
  return best;
}

/** Shape a tower on its footprint: per-tile heights from the profile, and where its top sits. */
function shapeTower(world: World, tiles: number[], floors: number, profile: Profile) {
  const n = world.size;
  const plot = { tiles };
  const set = new Set(plot.tiles);
  // ring = steps from the plot edge, so setbacks follow the plot's own shape
  const ring = new Map<number, number>();
  let frontier = plot.tiles.filter((t) => [t - 1, t + 1, t - n, t + n].some((j) => !set.has(j)));
  frontier.forEach((t) => ring.set(t, 0));
  for (let r = 1; frontier.length; r++) {
    const next: number[] = [];
    for (const t of frontier)
      for (const j of [t - 1, t + 1, t - n, t + n])
        if (set.has(j) && !ring.has(j)) {
          ring.set(j, r);
          next.push(j);
        }
    frontier = next;
  }
  const maxRing = Math.max(...ring.values());
  const cx = plot.tiles.reduce((s, t) => s + (t % n), 0) / plot.tiles.length;
  const cy = plot.tiles.reduce((s, t) => s + Math.floor(t / n), 0) / plot.tiles.length;
  const dist = (t: number) => Math.hypot((t % n) - cx, Math.floor(t / n) - cy);
  // the crown sits on the deepest tile nearest the middle
  const crown = [...plot.tiles].sort((a, b) => ring.get(b)! - ring.get(a)! || dist(a) - dist(b))[0];
  const far = [...plot.tiles].sort((a, b) => Math.hypot((b % n) - (crown % n), Math.floor(b / n) - Math.floor(crown / n)) - Math.hypot((a % n) - (crown % n), Math.floor(a / n) - Math.floor(crown / n)))[0];
  const dmax = Math.max(...plot.tiles.map(dist), 0.5);
  const near = (t: number) => Math.abs((t % n) - (crown % n)) + Math.abs(Math.floor(t / n) - Math.floor(crown / n)) <= 1;
  const heights = plot.tiles.map((t) => {
    const r = ring.get(t)!;
    let f = 1;
    switch (profile) {
      case "stepped":
        f = maxRing === 0 ? (t === crown ? 1 : 0.62) : 0.5 + 0.5 * (r / maxRing);
        break;
      case "podium":
        f = (maxRing === 0 ? near(t) : r === maxRing) ? 1 : 0.14;
        break;
      case "taper":
        f = 1 - 0.4 * (dist(t) / dmax);
        break;
      case "twin":
        f = t === crown ? 1 : t === far ? 0.86 : 0.3;
        break;
    }
    return Math.max(3, Math.round(floors * f));
  });
  heights[plot.tiles.indexOf(crown)] = floors;
  return { heights, crown };
}

const cache = new WeakMap<World, (Building | null)[]>();

/** Starter buildings that do not belong to the starter homes: industry, hangars and warehouses. */
const WORKS = new Set(["factory", "warehouse", "hangar"]);

/**
 * The starter building of each plot, in plot order, or null for open land. No skyscrapers are
 * standing at the start: residents build them. First Light City starts as open land around the
 * tower; elsewhere stand a limited number of 1–2 storey homes in the style of their climate
 * (modern cottages each with its own design), and the works of Forgeworks and Skyport.
 */
export function buildingsFor(world: World): (Building | null)[] {
  const hit = cache.get(world);
  if (hit) return hit;
  const biomeOf = (p: Plot) => (p.district >= 0 ? world.districts[p.district].biome : "temperate");
  const out: (Building | null)[] = world.plots.map((p) => (hasHouse(p) && biomeOf(p) !== "metropolis" ? houseFor(world, p) : null));
  // every cottage gets its own design; neighbours never look alike
  const cottages = designCottages(world.plots.filter((p) => out[p.id]?.style.id === "cottage"), biomeOf);
  for (const [id, c] of cottages) out[id] = { ...out[id]!, floors: c.floors, wall: c.wall, roofColor: c.roofColor, cottage: c };
  cache.set(world, out);
  return out;
}

export const buildingFor = (world: World, plot: Plot): Building | null => buildingsFor(world)[plot.id];

/** What stands on a plot at the start: a home, works, or nothing. Sent to the server as build-sites.json. */
export const starterKind = (b: Building | null): "cottage" | "works" | "none" => (!b ? "none" : WORKS.has(b.style.id) ? "works" : "cottage");

/** Skyscraper designs a resident can choose from; every one is a different glass, facade, top and profile. */
export const TOWER_DESIGNS = GLASS.length * FACADES.length * TOPS.length * PROFILES.length;
/** Cottage designs offered on one plot. */
export const COTTAGE_CHOICES = 6;
export const TOWER_CHOICES = 6;

/** Design number of the k-th skyscraper choice on a plot (so neighbours are offered different towers). */
export const towerChoice = (plot: Plot, k: number) => hash(plot.id * 31 + k * 977) % TOWER_DESIGNS;

/** A skyscraper of the given height and design on a plot. Foundations are 1 floor high. */
export function designTower(world: World, plot: Plot, floors: number, design: number): Building {
  let c = ((design % TOWER_DESIGNS) + TOWER_DESIGNS) % TOWER_DESIGNS;
  const glass = GLASS[c % GLASS.length];
  c = Math.floor(c / GLASS.length);
  const facade = FACADES[c % FACADES.length];
  c = Math.floor(c / FACADES.length);
  const top = TOPS[c % TOPS.length];
  const profile = PROFILES[Math.floor(c / TOPS.length) % PROFILES.length];
  const h = hash(plot.id + 101 + design * 7);
  const name = `${NAME_A[h % NAME_A.length]} ${NAME_B[(h >>> 7) % NAME_B.length]}`;
  const f = Math.max(1, floors);
  const tiles = towerFootprint(world, plot);
  const shaped = f >= 10 ? shapeTower(world, tiles, f, profile) : { heights: tiles.map(() => f), crown: tiles[0] };
  const style = STYLES[profile === "slab" || profile === "podium" ? "skyline" : "spire"];
  return {
    style,
    floors: f,
    ...looks(style, h, f),
    tower: { name, glass, frame: FRAMES[(h >>> 11) % FRAMES.length], facade, top: f >= 10 ? top : "roofbox", profile, tiles, heights: shaped.heights, crown: shaped.crown },
  };
}

/** A building a resident built, as the server keeps it. */
export interface Built {
  kind: "cottage" | "tower" | "empty";
  /** Skyscraper level: 0 foundation, 1 = 10 floors, 2 = 30, 3 = 60. */
  level: number;
  design: number;
  /** When the work in progress is finished, epoch seconds. */
  readyAt: number;
}

/** Floors of each skyscraper level. */
export const LEVEL_FLOORS = [0, 10, 30, 60] as const;

/** A resident's cottage of a given design. */
export function designCottage(world: World, plot: Plot, design: number): Building {
  const biome = plot.district >= 0 ? world.districts[plot.district].biome : "temperate";
  const c = cottageDesign(plot, biome, design);
  const style = STYLES.cottage;
  return { style, floors: c.floors, ...looks(style, hash(plot.id + design), c.floors), wall: c.wall, roofColor: c.roofColor, cottage: c };
}

/**
 * What the map shows for a built plot. A skyscraper still being built shows the floors already
 * finished (a foundation slab until the first ten floors are done).
 */
export function builtBuilding(world: World, plot: Plot, b: Built, now = Date.now() / 1000): Building | null {
  if (b.kind === "empty") return null;
  if (b.kind === "cottage") return designCottage(world, plot, b.design);
  const done = b.readyAt <= now ? b.level : b.level - 1;
  return designTower(world, plot, done >= 1 ? LEVEL_FLOORS[done] : 1, b.design);
}

/** Water and mountain plots take no building. */
export const hasHouse = (plot: Plot): boolean => !plot.water && plot.landscape !== "mountain";
