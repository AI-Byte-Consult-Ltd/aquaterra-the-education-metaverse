// Aquaterra world grid — first-generation land parcel map.
//
// This is a small illustrative prototype, NOT the real production grid.
// Per the official docs (info.aquaterra.world), the real world is 640x640
// = 409,600 LANDs (coords X/Y: -128..511), ~50,000 already minted, traded
// on EbisusBay / Crypto.com NFT, priced in $RAVERSE (38B supply, Cronos).
// See WORLD_FACTS below for the numbers surfaced on the page.
//
// HYDRO is not from those docs -- it's this prototype's own second token:
// $RAVERSE prices land itself, HYDRO is a harvested resource that only
// "resource" parcels (Oceania's wells) yield. Two-currency split, same
// idea as AXS/SLP or SAND/gems: a tradable land currency plus a soft
// in-world resource you produce by holding the right parcel.
//
// Fresh (continent, gx, gy) coordinate system here — deterministic, unlike
// the old Rainbowland prototype's plotID (a keccak hash of the viewport
// offset, which couldn't be reproduced or looked up). District names are
// pulled from that same official district list where they fit this map's
// geography; the rest (Rainbowhill, Medieval, Cartoonville, Gatsbyville,
// Frozenville, Desert, Voxelville, Pixelville, Lakeside, Riverside, Party
// Island, Agora, The Digital Graveyard) are reserved for future
// continents/biomes rather than forced into this first map.
export const WORLD_FACTS = {
  totalLands: 409_600,
  mintedLands: 50_000,
  gridSize: 640,
  coordMin: -128,
  coordMax: 511,
  token: "RAVERSE",
  tokenSupply: "38B",
  chain: "Cronos",
  districtsPlanned: 20,
};

export type ParcelType = "residential" | "commercial" | "tower" | "education" | "resource" | "landmark";
export type ParcelStatus = "available" | "reserved";

// Resource parcels are flavored with a material, echoing the official docs'
// "platinum, gold, rare elements, energy nodes" language -- and the on-chain
// "rarity" trait found on a real LAND token (Cobalt), which appears to be
// exactly this: a resource type, not an abstract rarity tier.
const RESOURCE_MATERIALS = ["Platinum", "Gold", "Cobalt", "Rare Earth", "Emerald", "Energy Node"] as const;

export interface LocalizedText {
  en: string;
  ru: string;
}

export interface District {
  id: string;
  name: string;
  anchor: [number, number];
  baseType: ParcelType;
  blurb: LocalizedText;
}

// A river is a wavy polyline carved out of the land mask — the same role
// rivers play on the old Rainbowland world map: they split one landmass
// into district-sized pieces instead of leaving districts to blend at an
// invisible line.
export interface RiverSpec {
  points: [number, number][];
  width: number;
}

// An archipelago continent skips the ellipse/coastline generator entirely --
// it scatters many small, separate islands across its whole cols x rows box.
export interface ArchipelagoSpec {
  count: number;
  minSpacing: number;
}

export interface ContinentSpec {
  id: string;
  name: string;
  seed: number;
  cols: number;
  rows: number;
  worldOffset: [number, number];
  center: [number, number];
  radius: [number, number];
  districts: District[];
  rivers?: RiverSpec[];
  archipelago?: ArchipelagoSpec;
  blurb: LocalizedText;
}

export interface Parcel {
  id: string;
  continentId: string;
  districtId: string;
  gx: number;
  gy: number;
  wx: number;
  wy: number;
  type: ParcelType;
  status: ParcelStatus;
  waterfront: boolean;
  sizeM2: number;
  priceRaverse: number | null;
  apartments?: number;
  buildingName?: string;
  placeName?: LocalizedText;
  hydroYield?: number;
  resourceType?: string;
}

export const CONTINENTS: ContinentSpec[] = [
  {
    id: "AUR",
    name: "Aurora",
    seed: 1337,
    cols: 22,
    rows: 16,
    worldOffset: [0, 0],
    center: [11, 8],
    radius: [10, 7],
    blurb: {
      en: "The founding continent — two rivers split it into four districts around the NICS AI Campus.",
      ru: "Основной континент — две реки делят его на четыре района вокруг кампуса NICS AI.",
    },
    rivers: [
      {
        points: [[0, 8], [2.5, 6.3], [5, 8.6], [7.5, 6.6], [10, 8.8], [12.5, 6.8], [15, 8.6], [17.5, 7], [20, 8.5], [22, 9]],
        width: 1.2,
      },
      { points: [[10, 8], [11, 9.5], [9, 11], [10.5, 12.5], [8.5, 14]], width: 1 },
    ],
    districts: [
      {
        id: "the-city",
        name: "The City",
        anchor: [7, 4],
        baseType: "residential",
        blurb: { en: "Aquaterra's civic heart, north of the river — the first streets ever platted.", ru: "Гражданский центр Aquaterra, к северу от реки — первые размеченные улицы." },
      },
      {
        id: "riverside",
        name: "Riverside",
        anchor: [5, 12],
        baseType: "residential",
        blurb: { en: "Fishing docks and housing along the southern riverbank.", ru: "Рыбацкие пристани и жильё вдоль южного берега реки." },
      },
      {
        id: "campus",
        name: "NICS Campus",
        anchor: [14, 5],
        baseType: "education",
        blurb: { en: "Where the NICS AI agents live, teach and run lessons.", ru: "Здесь живут ИИ-агенты NICS — учат и ведут уроки." },
      },
      {
        id: "factory",
        name: "Factory",
        anchor: [17, 10],
        baseType: "commercial",
        blurb: { en: "Workshops and the trade quarter facing the strait toward Meridian.", ru: "Мастерские и торговый квартал, смотрит через пролив на Меридиан." },
      },
    ],
  },
  {
    id: "MER",
    name: "Meridian",
    seed: 2024,
    cols: 20,
    rows: 18,
    worldOffset: [30, 2],
    center: [10, 9],
    radius: [9, 8],
    blurb: {
      en: "The business continent — financial docks, two towers, and a marina.",
      ru: "Деловой континент — финансовые доки, два небоскрёба и марина.",
    },
    districts: [
      {
        id: "celebrity",
        name: "Celebrity",
        anchor: [7, 9],
        baseType: "commercial",
        blurb: { en: "Meridian's glamour district — home to Aquaterra's two towers.", ru: "Район роскоши Меридиана — здесь стоят два небоскрёба Aquaterra." },
      },
      {
        id: "departures",
        name: "Departures",
        anchor: [12, 5],
        baseType: "commercial",
        blurb: { en: "The gateway district — causeway landing and the road to Aurora.", ru: "Район-ворота — причал дамбы и дорога на Аврору." },
      },
      {
        id: "seaside",
        name: "Seaside",
        anchor: [13, 13],
        baseType: "residential",
        blurb: { en: "Waterfront apartments south of the docks, Meridian's priciest coastline.", ru: "Апартаменты у воды к югу от доков — самое дорогое побережье Меридиана." },
      },
    ],
  },
  {
    id: "VER",
    name: "Verdant Isle",
    seed: 77,
    cols: 10,
    rows: 8,
    worldOffset: [14, 22],
    center: [5, 4],
    radius: [4, 3],
    blurb: {
      en: "A small resource island — freshwater wells that feed the whole world's economy.",
      ru: "Небольшой остров ресурсов — источники воды, питающие экономику всего мира.",
    },
    districts: [
      {
        id: "lakeside",
        name: "Lakeside",
        anchor: [5, 4],
        baseType: "resource",
        blurb: { en: "Aquaterra's fresh-water source. Owning a well means owning supply.", ru: "Источник пресной воды Aquaterra. Владеть скважиной — значит владеть поставками." },
      },
      {
        id: "forest",
        name: "Forest",
        anchor: [2, 6],
        baseType: "residential",
        blurb: { en: "A handful of homes for the well keepers, tucked among the trees.", ru: "Несколько домов смотрителей скважин среди деревьев." },
      },
    ],
  },
  {
    id: "OCE",
    name: "Oceania",
    seed: 4104,
    cols: 76,
    rows: 36,
    worldOffset: [0, 34],
    center: [38, 18],
    radius: [38, 18],
    archipelago: { count: 220, minSpacing: 2.3 },
    blurb: {
      en: "Hundreds of tiny islands scattered across the open ocean — Aquaterra's best-loved district, where almost every plot is waterfront.",
      ru: "Сотни крошечных островов в открытом океане — самый любимый район Aquaterra, где почти каждый участок у воды.",
    },
    districts: [
      {
        id: "oceania",
        name: "Oceania",
        anchor: [38, 18],
        baseType: "resource",
        blurb: { en: "Reef claims and tide pools, rich in rare resources.", ru: "Рифовые участки и отмели, богатые редкими ресурсами." },
      },
    ],
  },
];

// Towers: fixed 2x2 blocks forced onto the Celebrity district, Meridian.
const TOWERS: Array<{ continentId: string; cells: [number, number][]; name: string; apartments: number }> = [
  {
    continentId: "MER",
    cells: [[6, 8], [7, 8], [6, 9], [7, 9]],
    name: "Radiant Residences 1",
    apartments: 36,
  },
  {
    continentId: "MER",
    cells: [[9, 6], [10, 6], [9, 7], [10, 7]],
    name: "Radiant Residences 2",
    apartments: 28,
  },
];

// A couple of hand-placed landmarks for flavor (never for sale).
const LANDMARKS: Array<{ continentId: string; cell: [number, number]; name: LocalizedText }> = [
  { continentId: "MER", cell: [12, 4], name: { en: "Central Exchange", ru: "Центральная биржа" } },
  { continentId: "AUR", cell: [18, 3], name: { en: "Lighthouse", ru: "Маяк" } },
];

function hashCell(seed: number, x: number, y: number): number {
  let h = seed ^ Math.imul(x + 1, 374761393) ^ Math.imul(y + 1, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = h ^ (h >>> 16);
  return ((h >>> 0) % 1000) / 1000;
}

function nearestDistrict(districts: District[], gx: number, gy: number): District {
  let best = districts[0];
  let bestDist = Infinity;
  for (const d of districts) {
    const dx = gx - d.anchor[0];
    const dy = gy - d.anchor[1];
    const dist = dx * dx + dy * dy;
    if (dist < bestDist) {
      bestDist = dist;
      best = d;
    }
  }
  return best;
}

function pointToSegmentDist(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function carveRivers(land: Set<string>, rivers: RiverSpec[] | undefined, cols: number, rows: number) {
  if (!rivers) return;
  for (const river of rivers) {
    for (let i = 0; i < river.points.length - 1; i++) {
      const [x1, y1] = river.points[i];
      const [x2, y2] = river.points[i + 1];
      const minX = Math.max(0, Math.floor(Math.min(x1, x2) - river.width));
      const maxX = Math.min(cols - 1, Math.ceil(Math.max(x1, x2) + river.width));
      const minY = Math.max(0, Math.floor(Math.min(y1, y2) - river.width));
      const maxY = Math.min(rows - 1, Math.ceil(Math.max(y1, y2) + river.width));
      for (let gy = minY; gy <= maxY; gy++) {
        for (let gx = minX; gx <= maxX; gx++) {
          if (pointToSegmentDist(gx, gy, x1, y1, x2, y2) <= river.width) land.delete(`${gx},${gy}`);
        }
      }
    }
  }
}

// Scatters `count` small, separated islands (1-3 cells each) across the
// continent's whole cols x rows box -- an archipelago instead of one
// coastline. Deterministic: same seed always places the same islands.
function scatterIslands(continent: ContinentSpec): Set<string> {
  const { count, minSpacing } = continent.archipelago!;
  const land = new Set<string>();
  const centers: [number, number][] = [];
  const minSpacing2 = minSpacing * minSpacing;
  const dirs: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  let tries = 0;
  while (centers.length < count && tries < count * 60) {
    tries++;
    const cx = Math.floor(hashCell(continent.seed, tries, 11) * continent.cols);
    const cy = Math.floor(hashCell(continent.seed, tries, 97) * continent.rows);
    if (centers.some(([ex, ey]) => (cx - ex) ** 2 + (cy - ey) ** 2 < minSpacing2)) continue;
    centers.push([cx, cy]);

    land.add(`${cx},${cy}`);
    const sizeRoll = hashCell(continent.seed, cx, cy);
    const extraCells = sizeRoll < 0.55 ? 0 : sizeRoll < 0.85 ? 1 : 2;
    for (let i = 0; i < extraCells; i++) {
      const [dx, dy] = dirs[Math.floor(hashCell(continent.seed, cx + i * 131, cy + i * 197) * dirs.length)];
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx >= 0 && nx < continent.cols && ny >= 0 && ny < continent.rows) land.add(`${nx},${ny}`);
    }
  }
  return land;
}

function priceFor(type: ParcelType, waterfront: boolean): number | null {
  const base: Record<ParcelType, number | null> = {
    residential: 120,
    commercial: 260,
    resource: 90,
    tower: null,
    education: null,
    landmark: null,
  };
  const p = base[type];
  if (p === null) return null;
  return waterfront ? Math.round(p * 1.4) : p;
}

// HYDRO is Aquaterra's own resource-currency concept (not in the official
// docs, which only name $RAVERSE) -- a second, harvested token distinct from
// $RAVERSE: RAVERSE prices the land itself, HYDRO is what a resource parcel
// produces from owning it. Only "resource" parcels (Oceania's wells) yield it.
function hydroYieldFor(type: ParcelType, waterfront: boolean, seed: number, gx: number, gy: number): number | undefined {
  if (type !== "resource") return undefined;
  const variance = Math.round(hashCell(seed + 1, gx, gy) * 20);
  return (waterfront ? 55 : 40) + variance;
}

function resourceTypeFor(type: ParcelType, seed: number, gx: number, gy: number): string | undefined {
  if (type !== "resource") return undefined;
  const roll = hashCell(seed + 2, gx, gy);
  return RESOURCE_MATERIALS[Math.floor(roll * RESOURCE_MATERIALS.length)];
}

function buildWorld(): Parcel[] {
  const parcels: Parcel[] = [];

  for (const continent of CONTINENTS) {
    const [cx, cy] = continent.center;
    const [rx, ry] = continent.radius;
    const land = continent.archipelago ? scatterIslands(continent) : new Set<string>();

    if (!continent.archipelago) {
      for (let gy = 0; gy < continent.rows; gy++) {
        for (let gx = 0; gx < continent.cols; gx++) {
          const nx = (gx - cx) / rx;
          const ny = (gy - cy) / ry;
          const dist2 = nx * nx + ny * ny;
          const jitter = hashCell(continent.seed, gx, gy) * 0.4;
          if (dist2 < 0.9 + jitter) land.add(`${gx},${gy}`);
        }
      }
      carveRivers(land, continent.rivers, continent.cols, continent.rows);
    }

    // Force towers and landmarks onto land regardless of the coastline roll.
    for (const t of TOWERS) if (t.continentId === continent.id) for (const [x, y] of t.cells) land.add(`${x},${y}`);
    for (const l of LANDMARKS) if (l.continentId === continent.id) land.add(`${l.cell[0]},${l.cell[1]}`);

    const towerCellMap = new Map<string, { name: string; apartments: number }>();
    for (const t of TOWERS) if (t.continentId === continent.id) for (const c of t.cells) towerCellMap.set(`${c[0]},${c[1]}`, { name: t.name, apartments: t.apartments });
    const landmarkCellMap = new Map<string, LocalizedText>();
    for (const l of LANDMARKS) if (l.continentId === continent.id) landmarkCellMap.set(`${l.cell[0]},${l.cell[1]}`, l.name);

    for (const key of land) {
      const [gx, gy] = key.split(",").map(Number);
      const district = nearestDistrict(continent.districts, gx, gy);
      const waterfront =
        !land.has(`${gx + 1},${gy}`) || !land.has(`${gx - 1},${gy}`) || !land.has(`${gx},${gy + 1}`) || !land.has(`${gx},${gy - 1}`);

      let type: ParcelType = district.baseType;
      let apartments: number | undefined;
      let buildingName: string | undefined;
      let placeName: LocalizedText | undefined;
      if (towerCellMap.has(key)) {
        type = "tower";
        apartments = towerCellMap.get(key)!.apartments;
        buildingName = towerCellMap.get(key)!.name;
      } else if (landmarkCellMap.has(key)) {
        type = "landmark";
        placeName = landmarkCellMap.get(key)!;
      }

      const status: ParcelStatus = type === "residential" || type === "commercial" || type === "resource" ? "available" : "reserved";

      parcels.push({
        id: `${continent.id}-${String(gx).padStart(2, "0")}-${String(gy).padStart(2, "0")}`,
        continentId: continent.id,
        districtId: district.id,
        gx,
        gy,
        wx: continent.worldOffset[0] + gx,
        wy: continent.worldOffset[1] + gy,
        type,
        status,
        waterfront,
        sizeM2: 256, // 16m x 16m, matching the earlier project's land-unit convention
        priceRaverse: priceFor(type, waterfront),
        hydroYield: hydroYieldFor(type, waterfront, continent.seed, gx, gy),
        resourceType: resourceTypeFor(type, continent.seed, gx, gy),
        apartments,
        buildingName,
        placeName,
      });
    }
  }

  return parcels;
}

export const PARCELS: Parcel[] = buildWorld();

export const WORLD_BOUNDS = CONTINENTS.reduce(
  (acc, c) => ({
    maxX: Math.max(acc.maxX, c.worldOffset[0] + c.cols),
    maxY: Math.max(acc.maxY, c.worldOffset[1] + c.rows),
  }),
  { maxX: 0, maxY: 0 },
);

export function districtOf(p: Parcel): District {
  const continent = CONTINENTS.find((c) => c.id === p.continentId)!;
  return continent.districts.find((d) => d.id === p.districtId)!;
}

export function continentOf(p: Parcel): ContinentSpec {
  return CONTINENTS.find((c) => c.id === p.continentId)!;
}
