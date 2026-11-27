/**
 * Every kind of district in AquaTerra World, described as data.
 *
 * To add a new district type, add one entry here (and its English label in
 * strings.ts). The generator, the colours, the trees and the house catalogue all
 * read from this table, so nothing else has to change. The order of entries is
 * the order landmark districts are placed in.
 *
 * To add a whole new land (an island or an archipelago) without changing anything
 * that already exists, add an entry at the end of expansions.ts.
 */
import type { RGB } from "./palette";

/** What the generator knows about a candidate town site on the continent. */
export interface Site {
  /** -1 far north … 1 far south. */
  lat: number;
  /** Moisture, about -1 dry … 1 wet. */
  moist: number;
  /** Ground height 0..1. */
  alt: number;
  /** Distance to the First Light Tower in tiles. */
  dist: number;
}

export interface Ground {
  land: RGB;
  forest: RGB;
  hill: RGB;
  mountain: RGB;
  peak: RGB;
  beach: RGB;
  /** Colour of the trees drawn on forest tiles. */
  tree: RGB;
}

export interface RegionSpec {
  /** District names, used in order without repeats. */
  names: string[];
  ground: Ground;
  /** Forest threshold: -9 covers every patch of land with forest, 9 allows none. */
  forest: number;
  /** Lake bonus: positive makes lakes likelier, -9 forbids them. */
  lakes: number;
  /** Relative size: below 1 claims more land than its neighbours, above 1 less. */
  area: number;
  /** House styles (ids from buildings.ts STYLES) picked from at random per plot. */
  houses: string[];
  /** House style for plots on the beach, if this region builds differently there. */
  coastHouse?: string;
  /** Climate districts share the continent by how well they fit a site. */
  fit?: (s: Site) => number;
  /** Landmark districts: the best-scoring sites, placed before the climates. -Infinity rules a site out. */
  landmark?: { count: number; score: (s: Site) => number };
  /** Lives on the Oceania islands instead of the continent. */
  sea?: boolean;
  /** The capital around the tower. */
  capital?: boolean;
  /** Wild land: no starter homes stand on it, residents build everything themselves. */
  wild?: boolean;
}

const g = (land: RGB, forest: RGB, hill: RGB, mountain: RGB, peak: RGB, beach: RGB, tree: RGB): Ground => ({ land, forest, hill, mountain, peak, beach, tree });

export const REGIONS = {
  metropolis: {
    names: ["First Light City"],
    ground: g([190, 198, 214], [96, 158, 112], [168, 176, 190], [130, 130, 140], [236, 238, 246], [228, 214, 170], [60, 140, 90]),
    forest: 0.42,
    lakes: 0,
    area: 0.55,
    houses: ["loft"],
    coastHouse: "resort",
    capital: true,
  },
  volcanic: {
    names: ["Ember Fields", "Obsidian Ridge", "Cinder Heights", "Ashfall"],
    ground: g([96, 76, 76], [86, 92, 70], [84, 64, 64], [62, 48, 48], [214, 70, 30], [70, 64, 64], [64, 96, 56]),
    forest: 0.4,
    lakes: 0,
    area: 1,
    houses: ["basalt"],
    // the two highest districts are volcanic ridges
    landmark: { count: 2, score: (s) => s.alt },
    fit: (s) => s.alt * 3 - 1,
  },
  woodland: {
    names: ["Deepwood", "Elderwood", "Greatforest"],
    ground: g([86, 140, 70], [46, 110, 56], [80, 120, 70], [96, 104, 88], [220, 228, 220], [214, 204, 160], [22, 86, 40]),
    forest: -9,
    lakes: 0,
    area: 0.25,
    houses: ["cottage"],
    // the wettest district well away from the capital is woods from edge to edge
    landmark: { count: 1, score: (s) => (s.dist > 60 ? s.moist : -Infinity) },
  },
  dunes: {
    names: ["Great Sand Sea", "Sunscorch Erg"],
    ground: g([240, 208, 140], [240, 208, 140], [228, 188, 120], [204, 146, 92], [226, 176, 120], [244, 222, 162], [120, 150, 70]),
    forest: 9,
    lakes: -9,
    area: 0.2,
    houses: ["cottage"],
    // the driest southern district is sand from edge to edge
    landmark: { count: 1, score: (s) => (s.dist > 60 && s.lat > -0.2 ? -s.moist : -Infinity) },
  },
  industrial: {
    names: ["Forgeworks", "Ironport"],
    ground: g([170, 166, 158], [170, 166, 158], [150, 146, 140], [120, 116, 112], [200, 200, 204], [200, 190, 160], [90, 120, 80]),
    forest: 9,
    lakes: -9,
    area: 0.7,
    houses: ["factory", "factory", "warehouse"],
    // factories close to the capital
    landmark: { count: 1, score: (s) => (s.dist > 40 ? -s.dist : -Infinity) },
  },
  airport: {
    names: ["Skyport", "Aeroheights"],
    ground: g([150, 196, 120], [150, 196, 120], [140, 176, 112], [120, 124, 110], [224, 228, 230], [226, 214, 170], [70, 130, 70]),
    forest: 9,
    lakes: -9,
    area: 0.6,
    houses: ["hangar", "warehouse"],
    // the flattest, lowest land far from the capital; it gets the international airport
    landmark: { count: 1, score: (s) => (s.dist > 70 ? -s.alt : -Infinity) },
  },
  deco: {
    names: ["Gatsbyville"],
    ground: g([112, 188, 98], [70, 150, 80], [126, 176, 104], [120, 124, 110], [230, 232, 236], [238, 224, 186], [40, 120, 60]),
    forest: 0.45,
    lakes: 0,
    area: 0.75,
    houses: ["mansion"],
    // Roaring Twenties mansions, the next district out from the capital
    landmark: { count: 1, score: (s) => (s.dist > 40 ? -s.dist : -Infinity) },
  },
  temperate: {
    names: ["Greenhaven", "Meadowmere", "Willowbrook", "Clearwater", "Fairfield Vale", "Hollowmere"],
    ground: g([124, 184, 96], [70, 140, 70], [150, 162, 104], [128, 118, 108], [240, 240, 245], [232, 214, 158], [36, 112, 52]),
    forest: 0.08,
    lakes: 0,
    area: 1,
    houses: ["garden"],
    coastHouse: "resort",
    fit: (s) => 0.2 - Math.abs(s.lat) * 0.5,
  },
  tundra: {
    names: ["Frostvale", "Glacier Reach", "Snowcrest", "Icefjord", "Whitepeak", "Borealis"],
    ground: g([222, 232, 242], [196, 210, 220], [196, 206, 220], [160, 170, 188], [250, 252, 255], [200, 206, 210], [46, 92, 84]),
    forest: 0.12,
    lakes: 0,
    area: 1,
    houses: ["snowdome", "lodge"],
    fit: (s) => -s.lat * 2 + s.alt,
  },
  desert: {
    names: ["Sunreach Dunes", "Amber Sands", "Mirage Flats", "Saffron Basin", "Dustwind", "Goldmesa"],
    ground: g([232, 200, 128], [214, 196, 120], [216, 172, 102], [188, 128, 82], [222, 170, 120], [240, 218, 156], [90, 150, 70]),
    forest: 0.55,
    lakes: -0.15,
    area: 1,
    houses: ["adobe"],
    coastHouse: "resort",
    fit: (s) => s.lat * 1.5 - s.moist * 1.5,
  },
  jungle: {
    names: ["Verdant Canopy", "Emerald Deep", "Monsoon Wilds", "Orchid Hollow", "Vinewood", "Rainheart"],
    ground: g([76, 162, 74], [50, 132, 60], [92, 142, 64], [96, 110, 84], [200, 210, 200], [226, 210, 150], [18, 98, 42]),
    forest: -0.25,
    lakes: 0,
    area: 1,
    houses: ["canopy"],
    coastHouse: "resort",
    fit: (s) => s.lat * 1.5 + s.moist * 1.5,
  },
  savanna: {
    names: ["Goldgrass Plains", "Lionfall Steppe", "Acacia Rise", "Sunburnt Range", "Tallgrass"],
    ground: g([206, 186, 100], [190, 172, 92], [184, 154, 86], [150, 116, 84], [230, 220, 200], [234, 214, 150], [110, 128, 50]),
    forest: 0.35,
    lakes: 0,
    area: 1,
    houses: ["rondavel"],
    coastHouse: "resort",
    fit: (s) => s.lat * 0.8 - Math.abs(s.moist) * 0.5 + 0.2,
  },
  wetland: {
    names: ["Mistmarsh", "Reedwater", "Lotus Fen", "Heron Delta", "Fogmere"],
    ground: g([112, 162, 124], [90, 140, 104], [124, 146, 112], [110, 116, 104], [226, 232, 230], [190, 190, 150], [48, 100, 74]),
    forest: 0.15,
    lakes: 0.12,
    area: 1,
    houses: ["stiltcabin"],
    coastHouse: "resort",
    fit: (s) => s.moist * 2 - s.alt * 2,
  },
  autumn: {
    names: ["Amberwood", "Maple Crown", "Copperleaf", "Rustfield", "Harvest Hollow"],
    ground: g([190, 160, 92], [176, 132, 70], [168, 136, 86], [128, 106, 90], [240, 238, 236], [226, 206, 150], [208, 104, 36]),
    forest: -0.05,
    lakes: 0,
    area: 1,
    houses: ["cedar"],
    coastHouse: "resort",
    fit: (s) => -s.lat * 0.8 + s.moist * 0.5,
  },
  blossom: {
    names: ["Sakura Terrace", "Petalbrook", "Blossom Isle", "Lantern Gardens"],
    ground: g([150, 202, 132], [140, 190, 124], [166, 190, 140], [140, 130, 130], [244, 236, 244], [236, 220, 176], [242, 160, 206]),
    forest: 0.05,
    lakes: 0,
    area: 1,
    houses: ["pagoda"],
    coastHouse: "resort",
    fit: (s) => 0.3 - Math.abs(s.lat) + s.moist * 0.6,
  },
  oceania: {
    names: ["Coral Reach", "Pearl Atolls", "Lagoon Keys", "Tidewind Isles", "Seaglass Bay", "Moonreef"],
    ground: g([132, 204, 112], [84, 176, 96], [120, 170, 100], [96, 112, 92], [150, 120, 100], [246, 234, 196], [36, 150, 84]),
    forest: 0.1,
    lakes: -9,
    area: 1,
    houses: ["cottage"],
    sea: true,
  },
  isles: {
    names: ["Stormcrest Isles", "Saltwind Isles", "Driftstone Isles", "Gullrock Isles", "Kelpwater Isles", "Cragmoor Isles"],
    ground: g([118, 186, 102], [64, 146, 84], [116, 150, 96], [104, 108, 100], [228, 232, 236], [238, 226, 186], [30, 120, 70]),
    forest: 0.05,
    lakes: -9,
    area: 1,
    houses: ["cottage"],
    coastHouse: "resort",
    // a land added later (see expansions.ts): rugged green islands with mountains
    sea: true,
  },
  palms: {
    names: ["Palmcrest Isles", "Sunhaven Isles", "Coralpeak Isles", "Jadewater Isles", "Mangrove Keys", "Driftpalm Isles"],
    ground: g([122, 198, 98], [64, 164, 82], [134, 172, 98], [118, 122, 100], [170, 160, 146], [248, 236, 196], [30, 150, 72]),
    forest: 0.1,
    lakes: 0,
    area: 1,
    houses: ["cottage"],
    coastHouse: "resort",
    // Halcyon Archipelago (expansions.ts): wild palm islands, mountains, lakes and fields, no towns
    sea: true,
    wild: true,
  },
} satisfies Record<string, RegionSpec>;

export type Biome = keyof typeof REGIONS;
export const BIOMES = Object.keys(REGIONS) as Biome[];
export const region = (b: Biome): RegionSpec => REGIONS[b];
