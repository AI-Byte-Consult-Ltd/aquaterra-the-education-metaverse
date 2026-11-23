import type { Plot, World } from "./generator";
import { region } from "./regions";
import type { RGB } from "./palette";

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
  garden: { id: "garden", roof: "gable", wall: [236, 228, 210], roofColor: [186, 74, 58], window: [255, 220, 150], floors: [4, 12], footprint: 0.76 },
  snowdome: { id: "snowdome", roof: "dome", wall: [236, 244, 252], roofColor: [246, 250, 255], window: [255, 200, 120], floors: [3, 7], footprint: 0.76 },
  lodge: { id: "lodge", roof: "gable", wall: [132, 92, 64], roofColor: [230, 238, 246], window: [255, 196, 110], floors: [3, 8], footprint: 0.76 },
  adobe: { id: "adobe", roof: "flat", wall: [220, 170, 112], roofColor: [204, 150, 96], window: [255, 214, 140], floors: [3, 8], footprint: 0.76 },
  canopy: { id: "canopy", roof: "cone", wall: [150, 110, 70], roofColor: [70, 140, 60], window: [255, 226, 140], floors: [3, 9], footprint: 0.76 },
  rondavel: { id: "rondavel", roof: "cone", wall: [214, 186, 140], roofColor: [176, 140, 70], window: [255, 210, 130], floors: [3, 7], footprint: 0.76 },
  stiltcabin: { id: "stiltcabin", roof: "gable", wall: [120, 140, 120], roofColor: [80, 96, 86], window: [255, 220, 140], floors: [3, 7], footprint: 0.76 },
  basalt: { id: "basalt", roof: "flat", wall: [70, 58, 60], roofColor: [52, 44, 46], window: [255, 120, 50], floors: [5, 14], footprint: 0.7 },
  cedar: { id: "cedar", roof: "gable", wall: [214, 176, 128], roofColor: [176, 86, 40], window: [255, 206, 120], floors: [4, 11], footprint: 0.76 },
  pagoda: { id: "pagoda", roof: "pagoda", wall: [246, 232, 236], roofColor: [196, 70, 96], window: [255, 214, 196], floors: [3, 9], footprint: 0.76 },
  factory: { id: "factory", roof: "factory", wall: [176, 120, 96], roofColor: [110, 116, 126], window: [255, 200, 120], floors: [2, 4], footprint: 0.9 },
  warehouse: { id: "warehouse", roof: "flat", wall: [140, 156, 172], roofColor: [176, 182, 190], window: [255, 214, 150], floors: [2, 3], footprint: 0.92 },
  hangar: { id: "hangar", roof: "dome", wall: [206, 212, 220], roofColor: [176, 186, 198], window: [190, 230, 255], floors: [2, 3], footprint: 0.9 },
  resort: { id: "resort", roof: "flat", wall: [248, 248, 242], roofColor: [214, 222, 230], window: [150, 230, 255], floors: [3, 10], footprint: 0.78 },
  sandhouse: { id: "sandhouse", roof: "dome", wall: [226, 186, 128], roofColor: [236, 204, 150], window: [255, 214, 140], floors: [1, 2], footprint: 0.6 },
  cabin: { id: "cabin", roof: "gable", wall: [132, 92, 64], roofColor: [70, 96, 70], window: [255, 196, 110], floors: [1, 2], footprint: 0.6 },
  mansion: { id: "mansion", roof: "mansion", wall: [244, 232, 206], roofColor: [58, 64, 80], window: [255, 222, 150], floors: [2, 3], footprint: 0.9 },
  decotower: { id: "decotower", roof: "deco", wall: [226, 210, 178], roofColor: [206, 166, 72], window: [255, 220, 150], floors: [8, 22], footprint: 0.74 },
  treehouse: { id: "treehouse", roof: "cone", wall: [150, 110, 72], roofColor: [56, 120, 60], window: [255, 214, 130], stilts: true, floors: [1, 2], footprint: 0.5 },
  bungalow: { id: "bungalow", roof: "cone", wall: [236, 214, 170], roofColor: [190, 150, 84], window: [255, 220, 150], stilts: true, floors: [1, 2], footprint: 0.6 },
  villa: { id: "villa", roof: "flat", wall: [250, 250, 246], roofColor: [230, 232, 236], window: [150, 230, 255], floors: [1, 2], footprint: 0.74 },
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
}

/** Smallest plot for a skyscraper: 5 tiles = 2,000 m². */
export const TOWER_MIN_TILES = 5;
export const TOWER_FLOORS: [number, number] = [40, 100];

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

const isDowntown = (world: World, plot: Plot) =>
  plot.district >= 0 &&
  world.districts[plot.district].biome === "metropolis" &&
  plot.distance < world.params.landSize * 0.09 &&
  plot.tiles.length >= TOWER_MIN_TILES;

/** Shape a tower on its plot: per-tile heights from the profile, and where its top sits. */
function shapeTower(world: World, plot: Plot, floors: number, profile: Profile) {
  const n = world.size;
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

const cache = new WeakMap<World, Building[]>();

/**
 * One building per plot, in plot order: a skyscraper on every downtown plot of 2,000 m² or more,
 * no two alike, and a house in the style of the climate everywhere else. It is a preview of what
 * can be built; nothing is owned or built yet.
 */
export function buildingsFor(world: World): Building[] {
  const hit = cache.get(world);
  if (hit) return hit;
  const out = world.plots.map((p) => houseFor(world, p));
  const downtown = world.plots.filter((p) => isDowntown(world, p)).sort((a, b) => a.distance - b.distance);
  // every combination of glass, facade, top and profile is used at most once
  const combos: number[] = [];
  const total = GLASS.length * FACADES.length * TOPS.length * PROFILES.length;
  for (let i = 0; i < total; i++) combos.push(i);
  for (let i = total - 1; i > 0; i--) {
    const j = hash(i * 7919 + world.size) % (i + 1);
    [combos[i], combos[j]] = [combos[j], combos[i]];
  }
  const names = new Set<string>();
  const [lo, hi] = TOWER_FLOORS;
  const radius = world.params.landSize * 0.09;
  downtown.forEach((plot, k) => {
    let c = combos[k % total];
    const glass = GLASS[c % GLASS.length];
    c = Math.floor(c / GLASS.length);
    const facade = FACADES[c % FACADES.length];
    c = Math.floor(c / FACADES.length);
    const top = TOPS[c % TOPS.length];
    const profile = PROFILES[Math.floor(c / TOPS.length) % PROFILES.length];
    const h = hash(plot.id + 101);
    const near = Math.max(0, 1 - plot.distance / radius);
    const floors = Math.round(lo + (hi - lo) * Math.min(1, 0.65 * near + 0.35 * ((h % 1000) / 1000)));
    let name = "";
    for (let a = 0; !name || names.has(name); a++) name = `${NAME_A[(h + a) % NAME_A.length]} ${NAME_B[((h >>> 7) + a * 3) % NAME_B.length]}`;
    names.add(name);
    const { heights, crown } = shapeTower(world, plot, floors, profile);
    const style = STYLES[profile === "slab" || profile === "podium" ? "skyline" : "spire"];
    out[plot.id] = {
      style,
      floors,
      ...looks(style, h, floors),
      tower: { name, glass, frame: FRAMES[(h >>> 11) % FRAMES.length], facade, top, profile, tiles: plot.tiles, heights, crown },
    };
  });
  cache.set(world, out);
  return out;
}

export const buildingFor = (world: World, plot: Plot): Building => buildingsFor(world)[plot.id];
