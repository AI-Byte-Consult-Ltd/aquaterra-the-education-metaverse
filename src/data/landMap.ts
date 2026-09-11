// Aquaterra world grid — first-generation land parcel map.
//
// This is a small illustrative prototype, NOT the real production grid.
// Per the official docs (info.aquaterra.world), the real world is 640x640
// = 409,600 LANDs (coords X/Y: -100..539), ~50,000 already minted, traded
// on EbisusBay / Crypto.com NFT, priced in $RAVERSE (38B supply, Cronos).
// See WORLD_FACTS below for the numbers surfaced on the page. This
// prototype grid itself carries no per-parcel pricing -- it's a planning
// layout, not a storefront. The pannable world now spans the full 640x640
// official extent: the four hand-authored continents below sit in one
// corner of it, and a scattered "Open Waters" archipelago (see WLD in
// CONTINENTS) fills the rest of the grid so every one of the 640x640
// cells is a real, selectable square rather than empty canvas.
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
  coordMin: -100,
  coordMax: 539,
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

// On-parcel assets, Upland-style: things an owner has built/parked here.
// Illustrative/simulated, deterministic from the parcel's seed -- not read
// from any real inventory contract yet.
export interface ParcelAsset {
  icon: "house" | "vehicle" | "workshop" | "dock";
  label: LocalizedText;
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
  apartments?: number;
  buildingName?: string;
  placeName?: LocalizedText;
  resourceType?: string;
  // Upland-style ownership/economy layer -- simulated pending real
  // marketplace + wallet integration (see ownerFor/rewardFor/tollFor).
  owner: string | null;
  assets: ParcelAsset[];
  dailyReward: number; // RAVERSE/day this parcel earns its owner, passively
  tollFee: number; // RAVERSE a visitor pays to cross an owned parcel
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
  {
    // The rest of the official 640x640 grid, outside the four named
    // continents: a sparse frontier archipelago so every cell on the map
    // is real land or open sea, never empty canvas. worldOffset [0,0] and
    // cols/rows = the full grid size means gx/gy below already *are* world
    // coordinates; scatterIslands is steered away from the other four
    // continents' footprints (see the WLD branch in buildWorld).
    id: "WLD",
    name: "Open Waters",
    seed: 8080,
    cols: 640,
    rows: 640,
    worldOffset: [0, 0],
    center: [320, 320],
    radius: [320, 320],
    archipelago: { count: 3200, minSpacing: 6 },
    blurb: {
      en: "The uncharted frontier of the grid — thousands of isolated claims scattered far from the founding continents.",
      ru: "Неизведанные земли сетки — тысячи разрозненных участков вдали от основных континентов.",
    },
    districts: [
      {
        id: "open-waters",
        name: "Open Waters",
        anchor: [320, 320],
        baseType: "resource",
        blurb: { en: "An isolated frontier claim, far from the founding continents.", ru: "Отдалённый участок вдали от основных континентов." },
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
// `exclude`, when given, steers new island centers (and their extra cells)
// away from cells it flags -- used to keep the world-spanning WLD scatter
// off the four named continents' footprints.
function scatterIslands(continent: ContinentSpec, exclude?: (x: number, y: number) => boolean): Set<string> {
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
    if (exclude?.(cx, cy)) continue;
    if (centers.some(([ex, ey]) => (cx - ex) ** 2 + (cy - ey) ** 2 < minSpacing2)) continue;
    centers.push([cx, cy]);

    land.add(`${cx},${cy}`);
    const sizeRoll = hashCell(continent.seed, cx, cy);
    const extraCells = sizeRoll < 0.55 ? 0 : sizeRoll < 0.85 ? 1 : 2;
    for (let i = 0; i < extraCells; i++) {
      const [dx, dy] = dirs[Math.floor(hashCell(continent.seed, cx + i * 131, cy + i * 197) * dirs.length)];
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx >= 0 && nx < continent.cols && ny >= 0 && ny < continent.rows && !exclude?.(nx, ny)) land.add(`${nx},${ny}`);
    }
  }
  return land;
}

function resourceTypeFor(type: ParcelType, seed: number, gx: number, gy: number): string | undefined {
  if (type !== "resource") return undefined;
  const roll = hashCell(seed + 2, gx, gy);
  return RESOURCE_MATERIALS[Math.floor(roll * RESOURCE_MATERIALS.length)];
}

// Wild (WLD) cells have no curated district, so they roll their own type
// instead of inheriting one baseType from a district -- keeps the frontier
// varied rather than one uniform resource field.
const WILD_TYPE_ROLLS: [number, ParcelType][] = [
  [0.45, "residential"],
  [0.75, "resource"],
  [0.95, "commercial"],
  [1.01, "landmark"],
];
function wildTypeFor(seed: number, gx: number, gy: number): ParcelType {
  const roll = hashCell(seed + 3, gx, gy);
  for (const [ceiling, type] of WILD_TYPE_ROLLS) if (roll < ceiling) return type;
  return "residential";
}

// Ownership/economy layer -- Upland-style (passive daily reward + a toll
// to cross owned land), but entirely simulated/deterministic for now: no
// wallet or marketplace read backs any of this yet.
function ownerFor(status: ParcelStatus, type: ParcelType, seed: number, gx: number, gy: number): string | null {
  if (status === "reserved") {
    if (type === "education") return "NICS AI Foundation";
    if (type === "tower" || type === "landmark") return "Aquaterra Foundation";
  }
  const roll = hashCell(seed + 5, gx, gy);
  if (roll < 0.72) return null; // unclaimed
  const a = Math.floor(hashCell(seed + 6, gx, gy) * 0xfffff).toString(16).padStart(5, "0");
  const b = Math.floor(hashCell(seed + 7, gx, gy) * 0xffff).toString(16).padStart(4, "0");
  return `0x${a}…${b}`;
}

const ASSET_ROLLS: Array<{ types: ParcelType[]; threshold: number; asset: ParcelAsset }> = [
  { types: ["residential"], threshold: 0.4, asset: { icon: "house", label: { en: "House", ru: "Дом" } } },
  { types: ["commercial"], threshold: 0.6, asset: { icon: "workshop", label: { en: "Workshop", ru: "Мастерская" } } },
  { types: ["resource"], threshold: 0.65, asset: { icon: "dock", label: { en: "Dock", ru: "Причал" } } },
];
function assetsFor(owner: string | null, type: ParcelType, seed: number, gx: number, gy: number): ParcelAsset[] {
  if (!owner) return [];
  const roll = hashCell(seed + 8, gx, gy);
  const assets: ParcelAsset[] = [];
  for (const r of ASSET_ROLLS) if (r.types.includes(type) && roll > r.threshold) assets.push(r.asset);
  if (roll > 0.8) assets.push({ icon: "vehicle", label: { en: "Vehicle", ru: "Транспорт" } });
  return assets;
}

const REWARD_BASE: Record<ParcelType, number> = { residential: 4, commercial: 9, resource: 14, tower: 22, education: 0, landmark: 0 };
function rewardFor(type: ParcelType, waterfront: boolean, seed: number, gx: number, gy: number): number {
  const base = REWARD_BASE[type];
  if (base === 0) return 0;
  const variance = 0.85 + hashCell(seed + 9, gx, gy) * 0.3;
  return Math.round(base * (waterfront ? 1.3 : 1) * variance * 10) / 10;
}

const TOLL_BASE: Record<ParcelType, number> = { residential: 0.5, commercial: 1.2, resource: 1.5, tower: 2.5, education: 0, landmark: 0 };
function tollFor(owner: string | null, type: ParcelType, waterfront: boolean, seed: number, gx: number, gy: number): number {
  if (!owner) return 0;
  const base = TOLL_BASE[type];
  if (base === 0) return 0;
  const variance = 0.8 + hashCell(seed + 10, gx, gy) * 0.4;
  return Math.round(base * (waterfront ? 1.2 : 1) * variance * 10) / 10;
}

function buildWorld(): Parcel[] {
  const parcels: Parcel[] = [];

  for (const continent of CONTINENTS) {
    const [cx, cy] = continent.center;
    const [rx, ry] = continent.radius;
    const land =
      continent.id === "WLD"
        ? scatterIslands(
            continent,
            (x, y) =>
              CONTINENTS.some(
                (c) => c.id !== "WLD" && x >= c.worldOffset[0] - 4 && x < c.worldOffset[0] + c.cols + 4 && y >= c.worldOffset[1] - 4 && y < c.worldOffset[1] + c.rows + 4,
              ),
          )
        : continent.archipelago
          ? scatterIslands(continent)
          : new Set<string>();

    if (continent.id !== "WLD" && !continent.archipelago) {
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

      let type: ParcelType = continent.id === "WLD" ? wildTypeFor(continent.seed, gx, gy) : district.baseType;
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
      const owner = ownerFor(status, type, continent.seed, gx, gy);

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
        resourceType: resourceTypeFor(type, continent.seed, gx, gy),
        apartments,
        buildingName,
        placeName,
        owner,
        assets: assetsFor(owner, type, continent.seed, gx, gy),
        dailyReward: rewardFor(type, waterfront, continent.seed, gx, gy),
        tollFee: tollFor(owner, type, waterfront, continent.seed, gx, gy),
      });
    }
  }

  return parcels;
}

export const PARCELS: Parcel[] = buildWorld();

// The full official grid extent, not just the bounding box of the
// hand-authored continents -- see the top-of-file note on WLD.
export const WORLD_BOUNDS = { maxX: WORLD_FACTS.gridSize, maxY: WORLD_FACTS.gridSize };

const PARCEL_BY_CELL = new Map<string, Parcel>(PARCELS.map((p) => [`${p.wx},${p.wy}`, p]));

export function parcelAtWorld(wx: number, wy: number): Parcel | undefined {
  return PARCEL_BY_CELL.get(`${wx},${wy}`);
}

// Converts an internal render coordinate to the official on-chain-style
// coordinate the docs use (grid starts at (coordMin, coordMin)).
export function officialCoord(w: number): number {
  return w + WORLD_FACTS.coordMin;
}

export function districtOf(p: Parcel): District {
  const continent = CONTINENTS.find((c) => c.id === p.continentId)!;
  return continent.districts.find((d) => d.id === p.districtId)!;
}

export function continentOf(p: Parcel): ContinentSpec {
  return CONTINENTS.find((c) => c.id === p.continentId)!;
}
