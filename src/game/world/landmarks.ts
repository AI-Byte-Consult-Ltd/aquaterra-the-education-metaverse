/**
 * Landmarks: buildings that stand on the map from the start and are not built by residents.
 * The Second Light Tower (the old Radiant Residences Tower 2 on Cronos) stands by the lake in
 * First Light City, on 13 Velvet Highway. Its plot belongs to the state and is not for sale.
 * Every apartment in it is one NFT of the old collection (server/heritage/heritage.sql).
 */
import { designTower, TOWER_DESIGNS, type Building } from "./buildings";
import type { World } from "./generator";

export const SECOND_TOWER = {
  id: "second-light" as const,
  plotId: 44,
  address: "13 Velvet Highway",
  /** Top floor from the NFT metadata. The First Light Tower has 108. */
  floors: 791,
};

/** Design with a tapering profile and a spire: the tallest tower in the city should look like one. */
function spireDesign(world: World, plotId: number): number {
  const plot = world.plots[plotId];
  for (let d = 0; d < TOWER_DESIGNS; d++) {
    const t = designTower(world, plot, 12, d).tower!;
    if (t.profile === "taper" && t.top === "spire" && t.facade === "fins") return d;
  }
  return 0;
}

/** The landmark on a plot, or undefined. Only when the plot is where the landmark belongs. */
export function landmarkFor(world: World, plotId: number): Building | undefined {
  const plot = world.plots[plotId];
  if (plotId !== SECOND_TOWER.plotId || !plot || plot.address !== SECOND_TOWER.address) return undefined;
  const b = designTower(world, plot, SECOND_TOWER.floors, spireDesign(world, plotId));
  return { ...b, tower: { ...b.tower!, name: "Second Light Tower" } };
}

/** Which tower a plot holds, if any. */
export const towerOnPlot = (world: World, plotId: number) =>
  plotId === SECOND_TOWER.plotId && world.plots[plotId]?.address === SECOND_TOWER.address ? SECOND_TOWER.id : null;
