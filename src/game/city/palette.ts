import type { TileKind } from "./generator";

/** RGB triplets for the top face of each tile, in daylight and at night. */
type RGB = [number, number, number];

const DAY: Record<TileKind, RGB> = {
  ocean: [22, 92, 140],
  shallow: [44, 150, 180],
  beach: [226, 206, 150],
  land: [120, 170, 110],
  park: [92, 158, 98],
  street: [70, 78, 96],
  bridge: [150, 160, 178],
  canal: [40, 140, 190],
  plaza: [210, 214, 226],
  tower: [230, 236, 248],
  plot: [176, 206, 150],
};

const NIGHT: Record<TileKind, RGB> = {
  ocean: [6, 22, 48],
  shallow: [12, 48, 78],
  beach: [70, 66, 62],
  land: [30, 52, 46],
  park: [22, 48, 40],
  street: [34, 36, 58],
  bridge: [70, 78, 110],
  canal: [10, 60, 104],
  plaza: [70, 76, 110],
  tower: [120, 130, 170],
  plot: [44, 70, 60],
};

/** Height of the tile's top face above sea level, in screen pixels at scale 1. */
export const ELEVATION: Record<TileKind, number> = {
  ocean: 0,
  shallow: 0,
  canal: 0,
  beach: 2,
  land: 4,
  park: 4,
  street: 4,
  bridge: 6,
  plaza: 5,
  tower: 5,
  plot: 6,
};

/**
 * Daylight factor 0..1 from the local clock: night 21:00–05:00, dawn and dusk blend.
 * The city follows the player's real time of day.
 */
export function daylight(date = new Date()): number {
  const h = date.getHours() + date.getMinutes() / 60;
  if (h >= 7 && h <= 18) return 1;
  if (h <= 5 || h >= 21) return 0;
  if (h < 7) return (h - 5) / 2;
  return 1 - (h - 18) / 3;
}

const mix = (a: RGB, b: RGB, t: number): RGB => [
  Math.round(a[0] * t + b[0] * (1 - t)),
  Math.round(a[1] * t + b[1] * (1 - t)),
  Math.round(a[2] * t + b[2] * (1 - t)),
];

const css = ([r, g, b]: RGB, k = 1) =>
  `rgb(${Math.min(255, Math.round(r * k))},${Math.min(255, Math.round(g * k))},${Math.min(255, Math.round(b * k))})`;

export interface TileColors {
  top: string;
  left: string;
  right: string;
}

export function paletteFor(day: number): Record<TileKind, TileColors> {
  const out = {} as Record<TileKind, TileColors>;
  for (const kind of Object.keys(DAY) as TileKind[]) {
    const c = mix(DAY[kind], NIGHT[kind], day);
    out[kind] = { top: css(c), left: css(c, 0.72), right: css(c, 0.58) };
  }
  return out;
}

export const skyFor = (day: number) => css(mix([150, 200, 230], [4, 10, 28], day));
