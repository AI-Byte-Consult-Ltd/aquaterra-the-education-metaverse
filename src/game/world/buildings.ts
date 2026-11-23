import type { Biome, Plot, World } from "./generator";
import type { RGB } from "./palette";

export type Roof = "flat" | "gable" | "dome" | "cone" | "pagoda";

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
  skyline: { id: "skyline", roof: "flat", wall: [120, 170, 214], roofColor: [190, 214, 236], window: [170, 236, 255], floors: [8, 34], footprint: 0.72 },
  spire: { id: "spire", roof: "flat", wall: [92, 196, 190], roofColor: [200, 240, 236], window: [190, 255, 246], floors: [6, 24], footprint: 0.6 },
  loft: { id: "loft", roof: "flat", wall: [176, 160, 150], roofColor: [120, 112, 110], window: [255, 214, 150], floors: [4, 9], footprint: 0.78 },
  garden: { id: "garden", roof: "gable", wall: [236, 228, 210], roofColor: [186, 74, 58], window: [255, 220, 150], floors: [1, 3], footprint: 0.62 },
  snowdome: { id: "snowdome", roof: "dome", wall: [236, 244, 252], roofColor: [246, 250, 255], window: [255, 200, 120], floors: [1, 2], footprint: 0.6 },
  lodge: { id: "lodge", roof: "gable", wall: [132, 92, 64], roofColor: [230, 238, 246], window: [255, 196, 110], floors: [1, 2], footprint: 0.64 },
  adobe: { id: "adobe", roof: "flat", wall: [220, 170, 112], roofColor: [204, 150, 96], window: [255, 214, 140], floors: [1, 3], footprint: 0.7 },
  canopy: { id: "canopy", roof: "cone", wall: [150, 110, 70], roofColor: [70, 140, 60], window: [255, 226, 140], stilts: true, floors: [1, 2], footprint: 0.56 },
  rondavel: { id: "rondavel", roof: "cone", wall: [214, 186, 140], roofColor: [176, 140, 70], window: [255, 210, 130], floors: [1, 1], footprint: 0.56 },
  stiltcabin: { id: "stiltcabin", roof: "gable", wall: [120, 140, 120], roofColor: [80, 96, 86], window: [255, 220, 140], stilts: true, floors: [1, 2], footprint: 0.58 },
  basalt: { id: "basalt", roof: "flat", wall: [70, 58, 60], roofColor: [52, 44, 46], window: [255, 120, 50], floors: [2, 5], footprint: 0.7 },
  cedar: { id: "cedar", roof: "gable", wall: [214, 176, 128], roofColor: [176, 86, 40], window: [255, 206, 120], floors: [1, 3], footprint: 0.62 },
  pagoda: { id: "pagoda", roof: "pagoda", wall: [246, 232, 236], roofColor: [196, 70, 96], window: [255, 214, 196], floors: [2, 4], footprint: 0.6 },
  villa: { id: "villa", roof: "flat", wall: [250, 250, 246], roofColor: [230, 232, 236], window: [150, 230, 255], floors: [1, 2], footprint: 0.74 },
};

const BY_BIOME: Record<Biome, string[]> = {
  metropolis: ["skyline", "loft"],
  temperate: ["garden"],
  tundra: ["snowdome", "lodge"],
  desert: ["adobe"],
  jungle: ["canopy"],
  savanna: ["rondavel"],
  wetland: ["stiltcabin"],
  volcanic: ["basalt"],
  autumn: ["cedar"],
  blossom: ["pagoda"],
};

export interface Building {
  style: BuildingStyle;
  floors: number;
}

const hash = (n: number) => {
  let h = (n * 2654435761) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 2246822519) >>> 0;
  return (h ^ (h >>> 13)) >>> 0;
};

/**
 * The house that fits a plot best, from the climate of its district, its landscape,
 * its size and how close it is to the tower. It is a preview of what can be built;
 * nothing is owned or built yet.
 */
export function buildingFor(world: World, plot: Plot): Building {
  const biome = plot.district >= 0 ? world.districts[plot.district].biome : "temperate";
  const h = hash(plot.id + 1);
  let id: string;
  if (plot.landscape === "beachfront" && biome !== "tundra" && biome !== "volcanic") id = "villa";
  else if (biome === "metropolis") {
    // a tight downtown around the tower, lofts further out
    const r = plot.distance / (world.size * 0.07);
    id = r < 1 ? (h % 3 === 0 ? "spire" : "skyline") : r < 1.6 && h % 2 === 0 ? "spire" : "loft";
  }
  else {
    const list = BY_BIOME[biome];
    id = list[h % list.length];
  }
  const style = STYLES[id];
  const [lo, hi] = style.floors;
  // bigger plots and plots nearer the tower get taller houses
  const near =
    id === "skyline" || id === "spire"
      ? Math.max(0, 1 - plot.distance / (world.size * 0.11)) ** 1.3
      : Math.max(0, 1 - plot.distance / (world.size * 0.5));
  const big = Math.min(1, plot.tiles.length / 12);
  const t = Math.min(1, (id === "skyline" || id === "spire" ? 0.75 : 0.45) * near + 0.35 * big + 0.2 * ((h >>> 8) % 100) / 100);
  return { style, floors: Math.round(lo + (hi - lo) * t) };
}

/** One house per plot, in plot order. */
export const buildingsFor = (world: World): Building[] => world.plots.map((p) => buildingFor(world, p));
