import type { Biome } from "./generator";

/** District names per climate. Original names, picked without repeats. */
export const DISTRICT_NAMES: Record<Biome, string[]> = {
  metropolis: ["First Light City"],
  temperate: ["Greenhaven", "Meadowmere", "Willowbrook", "Clearwater", "Fairfield Vale", "Hollowmere"],
  tundra: ["Frostvale", "Glacier Reach", "Snowcrest", "Icefjord", "Whitepeak", "Borealis"],
  desert: ["Sunreach Dunes", "Amber Sands", "Mirage Flats", "Saffron Basin", "Dustwind", "Goldmesa"],
  jungle: ["Verdant Canopy", "Emerald Deep", "Monsoon Wilds", "Orchid Hollow", "Vinewood", "Rainheart"],
  savanna: ["Goldgrass Plains", "Lionfall Steppe", "Acacia Rise", "Sunburnt Range", "Tallgrass"],
  wetland: ["Mistmarsh", "Reedwater", "Lotus Fen", "Heron Delta", "Fogmere"],
  volcanic: ["Ember Fields", "Obsidian Ridge", "Cinder Heights", "Ashfall"],
  autumn: ["Amberwood", "Maple Crown", "Copperleaf", "Rustfield", "Harvest Hollow"],
  blossom: ["Sakura Terrace", "Petalbrook", "Blossom Isle", "Lantern Gardens"],
};

const STREET_A = [
  "Coral", "Harbor", "Lumen", "Cedar", "Signal", "Aurora", "Quartz", "Willow", "Beacon", "Tidal", "Nova", "Orchard",
  "Granite", "Juniper", "Comet", "Lagoon", "Falcon", "Prism", "Ivy", "Meridian", "Saffron", "Kelp", "Summit", "Echo",
  "Pine", "Atlas", "Velvet", "Ember", "Glass", "Riverside", "Starling", "Copper", "Maple", "Cobalt", "Dune", "Fern",
  "Halo", "Iris", "Jade", "Lantern", "Marble", "Nimbus", "Opal", "Pearl", "Quill", "Raven", "Sable", "Topaz", "Umber",
  "Vista", "Wren", "Zephyr", "Birch", "Canyon", "Delta", "Frost", "Grove", "Heron", "Indigo", "Kestrel", "Lotus",
];
const STREET_B = ["Street", "Road", "Lane", "Way", "Avenue", "Drive", "Boulevard", "Row", "Walk", "Terrace", "Hill", "Crescent"];

/** Deterministic unique street names. */
export function streetNamer(rand: () => number) {
  const used = new Set<string>();
  return (kind: "highway" | "avenue" | "street") => {
    for (let i = 0; i < 200; i++) {
      const a = STREET_A[Math.floor(rand() * STREET_A.length)];
      const b =
        kind === "highway"
          ? rand() < 0.5
            ? "Highway"
            : "Parkway"
          : kind === "avenue"
            ? rand() < 0.5
              ? "Avenue"
              : "Boulevard"
            : STREET_B[Math.floor(rand() * STREET_B.length)];
      const name = `${a} ${b}`;
      if (!used.has(name)) {
        used.add(name);
        return name;
      }
    }
    const name = `Route ${used.size + 1}`;
    used.add(name);
    return name;
  };
}
