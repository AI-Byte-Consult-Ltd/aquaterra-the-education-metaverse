import type { Biome, Kind } from "./generator";

export type RGB = [number, number, number];

/** Ground colours per climate for natural land. */
const BIOME_GROUND: Record<Biome, { land: RGB; forest: RGB; hill: RGB; mountain: RGB; peak: RGB; beach: RGB; tree: RGB }> = {
  metropolis: { land: [190, 198, 214], forest: [96, 158, 112], hill: [168, 176, 190], mountain: [130, 130, 140], peak: [236, 238, 246], beach: [228, 214, 170], tree: [60, 140, 90] },
  temperate: { land: [124, 184, 96], forest: [70, 140, 70], hill: [150, 162, 104], mountain: [128, 118, 108], peak: [240, 240, 245], beach: [232, 214, 158], tree: [36, 112, 52] },
  tundra: { land: [222, 232, 242], forest: [196, 210, 220], hill: [196, 206, 220], mountain: [160, 170, 188], peak: [250, 252, 255], beach: [200, 206, 210], tree: [46, 92, 84] },
  desert: { land: [232, 200, 128], forest: [214, 196, 120], hill: [216, 172, 102], mountain: [188, 128, 82], peak: [222, 170, 120], beach: [240, 218, 156], tree: [90, 150, 70] },
  jungle: { land: [76, 162, 74], forest: [50, 132, 60], hill: [92, 142, 64], mountain: [96, 110, 84], peak: [200, 210, 200], beach: [226, 210, 150], tree: [18, 98, 42] },
  savanna: { land: [206, 186, 100], forest: [190, 172, 92], hill: [184, 154, 86], mountain: [150, 116, 84], peak: [230, 220, 200], beach: [234, 214, 150], tree: [110, 128, 50] },
  wetland: { land: [112, 162, 124], forest: [90, 140, 104], hill: [124, 146, 112], mountain: [110, 116, 104], peak: [226, 232, 230], beach: [190, 190, 150], tree: [48, 100, 74] },
  volcanic: { land: [96, 76, 76], forest: [86, 92, 70], hill: [84, 64, 64], mountain: [62, 48, 48], peak: [214, 70, 30], beach: [70, 64, 64], tree: [64, 96, 56] },
  autumn: { land: [190, 160, 92], forest: [176, 132, 70], hill: [168, 136, 86], mountain: [128, 106, 90], peak: [240, 238, 236], beach: [226, 206, 150], tree: [208, 104, 36] },
  blossom: { land: [150, 202, 132], forest: [140, 190, 124], hill: [166, 190, 140], mountain: [140, 130, 130], peak: [244, 236, 244], beach: [236, 220, 176], tree: [242, 160, 206] },
};

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

export function baseColor(kind: Kind, biome: Biome): RGB {
  const g = BIOME_GROUND[biome];
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

export const treeColor = (biome: Biome): RGB => BIOME_GROUND[biome].tree;

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
