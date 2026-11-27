/**
 * New lands added to AquaTerra World after its first release.
 *
 * The world only grows: each entry raises new land out of open sea, with its own
 * districts, roads and plots, and leaves everything that already exists exactly as
 * it was (same tiles, same districts, same plot addresses). To add a land, append
 * one entry at the END of this list; never reorder or edit earlier entries, or the
 * lands after them would change. A land never touches existing coast: tiles
 * closer than MARGIN to anything that is not open sea stay water.
 */
import type { Biome } from "./regions";

export interface Expansion {
  /** English name of the land, shown on the map. */
  name: string;
  /**
   * "island": one large ragged island; "archipelago": many islands, big and small, some mountainous;
   * "harbours": wild islands with ragged coasts, deep harbour bays, mountains, lakes, palms and fields,
   * no towns or streets (a land from LATE_FROM on).
   */
  shape: "island" | "archipelago" | "harbours";
  /** Rectangle of open sea it may rise in, in tiles: [x0, y0, x1, y1]. */
  area: [number, number, number, number];
  /** One district per entry, in order. Names continue each region's name list. */
  districts: Biome[];
  /** Own random seed, so the land does not depend on any other land. */
  seed: number;
  /** Lagoon colours for the shallow sea, as in Oceania. */
  lagoon?: boolean;
}

/**
 * Lands from this index on are raised after the water plots are cut, and their plots come
 * after every plot that existed before (ids are kept by the land registry on the server).
 * They have no towns or streets: all their land is cut into lots. Earlier entries keep the
 * old order (street plots and islands first), so nothing that existed changes.
 */
export const LATE_FROM = 2;

/** Open sea kept between a new land and anything already on the map. */
export const MARGIN = 12;

export const EXPANSIONS: Expansion[] = [
  {
    name: "Greenhaven Isle",
    shape: "island",
    area: [16, 318, 284, 434],
    districts: ["temperate", "wetland", "temperate", "wetland"],
    seed: 1001,
  },
  {
    name: "Northern Archipelago",
    shape: "archipelago",
    area: [340, 8, 436, 276],
    districts: ["isles", "isles", "isles", "isles"],
    seed: 1002,
    lagoon: true,
  },
  {
    name: "Halcyon Archipelago",
    shape: "harbours",
    area: [136, 4, 332, 50],
    districts: ["palms", "palms", "palms", "palms"],
    seed: 1003,
    lagoon: true,
  },
];
