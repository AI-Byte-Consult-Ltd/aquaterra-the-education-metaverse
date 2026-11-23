import type { Kind } from "./generator";
import { REGIONS, type Biome, type Ground } from "./regions";

export type RGB = [number, number, number];

/** Ground colours per region come from the region table. */
const BIOME_GROUND = REGIONS as Record<Biome, { ground: Ground }>;

const FIXED: Partial<Record<Kind, RGB>> = {
  deep: [14, 52, 104],
  ocean: [26, 94, 156],
  shallow: [58, 156, 196],
  lake: [48, 136, 200],
  river: [58, 150, 214],
  road: [70, 74, 86],
  street: [104, 108, 120],
  bridge: [168, 160, 150],
  rail: [122, 98, 86],
  railbridge: [150, 110, 96],
  station: [214, 84, 70],
  runway: [52, 54, 62],
  apron: [176, 180, 190],
  terminal: [120, 170, 214],
  pier: [150, 112, 74],
  plaza: [222, 226, 236],
  tower: [230, 236, 248],
};

/** Turquoise lagoon water of Oceania. */
export const LAGOON: RGB = [70, 200, 210];

export function baseColor(kind: Kind, biome: Biome): RGB {
  const g = BIOME_GROUND[biome].ground;
  switch (kind) {
    case "land":
      return g.land;
    case "forest":
      return g.forest;
    case "hill":
      return g.hill;
    case "mountain":
      return g.mountain;
    case "peak":
      return g.peak;
    case "beach":
      return g.beach;
    default:
      return FIXED[kind] ?? [255, 0, 255];
  }
}

export const treeColor = (biome: Biome): RGB => BIOME_GROUND[biome].ground.tree;

/** Daylight 0..1 from the local clock: night 21:00–05:00, dawn and dusk blend. */
export function daylight(date = new Date()): number {
  const h = date.getHours() + date.getMinutes() / 60;
  if (h >= 7 && h <= 18) return 1;
  if (h <= 5 || h >= 21) return 0;
  if (h < 7) return (h - 5) / 2;
  return 1 - (h - 18) / 3;
}

const NIGHT: RGB = [10, 16, 40];

/** Apply daylight and a brightness factor, return a CSS colour. */
export function shade(c: RGB, day: number, k = 1): string {
  const t = 0.25 + 0.75 * day;
  const r = c[0] * k * t + NIGHT[0] * (1 - t);
  const g = c[1] * k * t + NIGHT[1] * (1 - t);
  const b = c[2] * k * t + NIGHT[2] * (1 - t);
  return `rgb(${Math.min(255, r | 0)},${Math.min(255, g | 0)},${Math.min(255, b | 0)})`;
}

export const skyColor = (day: number) => shade([150, 200, 232], day);
