import type { Biome, Plot, World } from "@/game/world/generator";

/**
 * Land prices in Tide (TIDE). The same formula fills the server's land
 * registry (public/land-registry.json, synced to the server), so the price on
 * the plot card is the price the server charges. The server has the last word.
 */
export const PRICE_PER_TILE = 40;
export const MIN_PRICE = 100;
const BIOME_PREMIUM: Partial<Record<Biome, number>> = { metropolis: 1.4, deco: 1.3, oceania: 1.2 };

export function plotPrice(world: World, plot: Plot): number {
  const biome = plot.district >= 0 ? world.districts[plot.district]?.biome : undefined;
  let p = PRICE_PER_TILE * plot.tiles.length;
  // Closer to First Light Tower is dearer: up to 2.5× at the centre.
  p *= 1 + 1.5 * Math.max(0, 1 - plot.distance / 150);
  if (plot.waterView && !plot.water) p *= 1.25;
  if (plot.landscape === "beachfront") p *= 1.3;
  if (plot.landscape === "island") p *= 1.5;
  if (plot.landscape === "mountain") p *= 0.8;
  // Water plots are cheap: nothing can be built on water yet.
  if (plot.water) p *= 0.4;
  p *= (biome && BIOME_PREMIUM[biome]) || 1;
  return Math.max(MIN_PRICE, Math.round(p / 10) * 10);
}

/** One row per plot: [id, address, district name, tiles, price]. */
export type RegistryRow = [number, string, string, number, number];

export function landRegistry(world: World): RegistryRow[] {
  return world.plots.map((p) => [p.id, p.address, (p.district >= 0 && world.districts[p.district]?.name) || "Open water", p.tiles.length, plotPrice(world, p)]);
}
