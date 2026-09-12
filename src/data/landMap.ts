// Aquaterra world grid — first-generation land parcel map.
//
// This is a small illustrative prototype, NOT the real production grid.
// Per the official docs (info.aquaterra.world), the real world is 640x640
// = 409,600 LANDs (coords X/Y: -100..539), ~50,000 already minted, traded
// on EbisusBay / Crypto.com NFT, priced in $RAVERSE (38B supply, Cronos).
// See WORLD_FACTS below for the numbers surfaced on the page. This
// prototype grid itself carries no per-parcel pricing -- it's a planning
// layout, not a storefront.
//
// Districts below are not hand-guessed: they're derived from the team's
// real Tiled map (see src/data/tileMap.ts, scripts/tmx-to-grid.mjs) by
// averaging each tile's color, clustering those colors, and flood-filling
// connected regions on a downsampled grid -- the eight largest resulting
// regions are the eight districts here, named for the Nine Realms of Norse
// mythology (public-domain -- not Marvel's, though Marvel borrowed the
// names too) for an epic, non-commercial-IP flavor. Every one of the
// 640x640 cells belongs to whichever district's anchor is nearest, so the
// whole grid is covered -- there's no more separate "ocean" fill; the real
// map has actual terrain (water included) painted everywhere already.
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
  anchor: [number, number]; // world coordinates (0..639), not continent-local
  baseType: ParcelType;
  blurb: LocalizedText;
}

// Kept as a wrapper (rather than flattening districts to the top level) so
// the existing districtOf/continentOf API and the page's "by area" filter
// don't need reshaping -- there's just one entry now, since the real map is
// one continuous painted world rather than separate landmasses in an
// abstract ocean.
export interface ContinentSpec {
  id: string;
  name: string;
  blurb: LocalizedText;
  districts: District[];
}

export const CONTINENTS: ContinentSpec[] = [
  {
    id: "AQT",
    name: "Aquaterra",
    blurb: {
      en: "One continuous world, eight realms — named for Norse mythology's Nine Realms, minus one held in reserve.",
      ru: "Единый непрерывный мир, восемь земель — названы в честь Девяти Миров скандинавской мифологии, один пока в резерве.",
    },
    districts: [
      {
        id: "asgard",
        name: "Asgard",
        anchor: [131, 91],
        baseType: "commercial",
        blurb: {
          en: "The gleaming capital, seat of Aquaterra's founders — streets platted in gold and stone.",
          ru: "Сияющая столица, обитель основателей Aquaterra — улицы, вымощенные золотом и камнем.",
        },
      },
      {
        id: "vanaheim",
        name: "Vanaheim",
        anchor: [320, 443],
        baseType: "residential",
        blurb: {
          en: "Vast fertile lowlands where a river winds through orchards and open fields.",
          ru: "Обширные плодородные низины, где река вьётся среди садов и открытых полей.",
        },
      },
      {
        id: "jotunheim",
        name: "Jotunheim",
        anchor: [491, 183],
        baseType: "resource",
        blurb: {
          en: "Rugged highland claimed by no one — wild, resource-rich, and untamed.",
          ru: "Суровое нагорье, никем не освоенное — дикое, богатое ресурсами, неукрощённое.",
        },
      },
      {
        id: "alfheim",
        name: "Alfheim",
        anchor: [435, 83],
        baseType: "residential",
        blurb: {
          en: "Bright northern plains bathed in light — home to the NICS AI Campus.",
          ru: "Светлые северные равнины, залитые светом — здесь расположен кампус NICS AI.",
        },
      },
      {
        id: "folkvangr",
        name: "Fólkvangr",
        anchor: [227, 275],
        baseType: "residential",
        blurb: {
          en: "Freyja's meadow — a quiet green expanse favored by settlers.",
          ru: "Луг Фрейи — тихие зелёные просторы, любимые поселенцами.",
        },
      },
      {
        id: "midgard",
        name: "Midgard",
        anchor: [347, 167],
        baseType: "commercial",
        blurb: {
          en: "The mortal crossing — Aquaterra's harbor, markets and the causeway to every realm.",
          ru: "Мир смертных — гавань Aquaterra, рынки и дамба, ведущая во все земли.",
        },
      },
      {
        id: "svartalfheim",
        name: "Svartalfheim",
        anchor: [63, 215],
        baseType: "resource",
        blurb: {
          en: "A secretive enclave of rare hues — said to hide the richest veins in Aquaterra.",
          ru: "Скрытный анклав редких оттенков — говорят, здесь залегают самые богатые жилы Aquaterra.",
        },
      },
      {
        id: "niflheim",
        name: "Niflheim",
        anchor: [339, 327],
        baseType: "resource",
        blurb: {
          en: "Mist-veiled waters at the world's quiet edge.",
          ru: "Туманные воды на тихом краю мира.",
        },
      },
    ],
  },
];

const SEED = 1337;

// Towers: fixed 2x2 blocks in Asgard, the capital.
const TOWERS: Array<{ cells: [number, number][]; name: string; apartments: number }> = [
  { cells: [[125, 85], [126, 85], [125, 86], [126, 86]], name: "Asgard Spire I", apartments: 36 },
  { cells: [[137, 96], [138, 96], [137, 97], [138, 97]], name: "Asgard Spire II", apartments: 28 },
];

// The NICS AI Campus -- a small reserved block in Alfheim, "realm of light".
const EDUCATION_ZONE: [number, number][] = [
  [430, 78], [431, 78], [432, 78],
  [430, 79], [431, 79], [432, 79],
];

// A couple of hand-placed landmarks for flavor (never for sale).
const LANDMARKS: Array<{ cell: [number, number]; name: LocalizedText }> = [
  { cell: [150, 110], name: { en: "Bifröst Gate", ru: "Врата Бифрёст" } },
  { cell: [300, 420], name: { en: "Yggdrasil's Root", ru: "Корень Иггдрасиля" } },
];

// Districts framed around water (Midgard's harbor, misty Niflheim) get the
// waterfront reward/toll premium if within this radius of either anchor --
// a stand-in for real per-tile water detection, which would need the async
// tile grid (see tileMap.ts) rather than this module's synchronous build.
const WATERFRONT_ANCHORS: [number, number][] = [[347, 167], [339, 327]];
const WATERFRONT_RADIUS = 20;

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

function hashCell(seed: number, x: number, y: number): number {
  let h = seed ^ Math.imul(x + 1, 374761393) ^ Math.imul(y + 1, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = h ^ (h >>> 16);
  return ((h >>> 0) % 1000) / 1000;
}

function nearestDistrict(districts: District[], wx: number, wy: number): District {
  let best = districts[0];
  let bestDist = Infinity;
  for (const d of districts) {
    const dx = wx - d.anchor[0];
    const dy = wy - d.anchor[1];
    const dist = dx * dx + dy * dy;
    if (dist < bestDist) {
      bestDist = dist;
      best = d;
    }
  }
  return best;
}

function isWaterfront(wx: number, wy: number): boolean {
  return WATERFRONT_ANCHORS.some(([ax, ay]) => (wx - ax) ** 2 + (wy - ay) ** 2 < WATERFRONT_RADIUS ** 2);
}

function resourceTypeFor(type: ParcelType, wx: number, wy: number): string | undefined {
  if (type !== "resource") return undefined;
  const roll = hashCell(SEED + 2, wx, wy);
  return RESOURCE_MATERIALS[Math.floor(roll * RESOURCE_MATERIALS.length)];
}

// Ownership/economy layer -- Upland-style (passive daily reward + a toll
// to cross owned land), but entirely simulated/deterministic for now: no
// wallet or marketplace read backs any of this yet.
function ownerFor(status: ParcelStatus, type: ParcelType, wx: number, wy: number): string | null {
  if (status === "reserved") {
    if (type === "education") return "NICS AI Foundation";
    if (type === "tower" || type === "landmark") return "Aquaterra Foundation";
  }
  const roll = hashCell(SEED + 5, wx, wy);
  if (roll < 0.72) return null; // unclaimed
  const a = Math.floor(hashCell(SEED + 6, wx, wy) * 0xfffff).toString(16).padStart(5, "0");
  const b = Math.floor(hashCell(SEED + 7, wx, wy) * 0xffff).toString(16).padStart(4, "0");
  return `0x${a}…${b}`;
}

const ASSET_ROLLS: Array<{ types: ParcelType[]; threshold: number; asset: ParcelAsset }> = [
  { types: ["residential"], threshold: 0.4, asset: { icon: "house", label: { en: "House", ru: "Дом" } } },
  { types: ["commercial"], threshold: 0.6, asset: { icon: "workshop", label: { en: "Workshop", ru: "Мастерская" } } },
  { types: ["resource"], threshold: 0.65, asset: { icon: "dock", label: { en: "Dock", ru: "Причал" } } },
];
function assetsFor(owner: string | null, type: ParcelType, wx: number, wy: number): ParcelAsset[] {
  if (!owner) return [];
  const roll = hashCell(SEED + 8, wx, wy);
  const assets: ParcelAsset[] = [];
  for (const r of ASSET_ROLLS) if (r.types.includes(type) && roll > r.threshold) assets.push(r.asset);
  if (roll > 0.8) assets.push({ icon: "vehicle", label: { en: "Vehicle", ru: "Транспорт" } });
  return assets;
}

const REWARD_BASE: Record<ParcelType, number> = { residential: 4, commercial: 9, resource: 14, tower: 22, education: 0, landmark: 0 };
function rewardFor(type: ParcelType, waterfront: boolean, wx: number, wy: number): number {
  const base = REWARD_BASE[type];
  if (base === 0) return 0;
  const variance = 0.85 + hashCell(SEED + 9, wx, wy) * 0.3;
  return Math.round(base * (waterfront ? 1.3 : 1) * variance * 10) / 10;
}

const TOLL_BASE: Record<ParcelType, number> = { residential: 0.5, commercial: 1.2, resource: 1.5, tower: 2.5, education: 0, landmark: 0 };
function tollFor(owner: string | null, type: ParcelType, waterfront: boolean, wx: number, wy: number): number {
  if (!owner) return 0;
  const base = TOLL_BASE[type];
  if (base === 0) return 0;
  const variance = 0.8 + hashCell(SEED + 10, wx, wy) * 0.4;
  return Math.round(base * (waterfront ? 1.2 : 1) * variance * 10) / 10;
}

function buildWorld(): Parcel[] {
  const parcels: Parcel[] = [];
  const continent = CONTINENTS[0];

  const towerCellMap = new Map<string, { name: string; apartments: number }>();
  for (const t of TOWERS) for (const c of t.cells) towerCellMap.set(`${c[0]},${c[1]}`, { name: t.name, apartments: t.apartments });
  const educationCells = new Set(EDUCATION_ZONE.map(([x, y]) => `${x},${y}`));
  const landmarkCellMap = new Map<string, LocalizedText>();
  for (const l of LANDMARKS) landmarkCellMap.set(`${l.cell[0]},${l.cell[1]}`, l.name);

  for (let wy = 0; wy < WORLD_FACTS.gridSize; wy++) {
    for (let wx = 0; wx < WORLD_FACTS.gridSize; wx++) {
      const key = `${wx},${wy}`;
      const district = nearestDistrict(continent.districts, wx, wy);

      let type: ParcelType = district.baseType;
      let apartments: number | undefined;
      let buildingName: string | undefined;
      let placeName: LocalizedText | undefined;
      if (towerCellMap.has(key)) {
        type = "tower";
        apartments = towerCellMap.get(key)!.apartments;
        buildingName = towerCellMap.get(key)!.name;
      } else if (educationCells.has(key)) {
        type = "education";
        buildingName = "NICS AI Campus";
      } else if (landmarkCellMap.has(key)) {
        type = "landmark";
        placeName = landmarkCellMap.get(key)!;
      }

      const status: ParcelStatus = type === "residential" || type === "commercial" || type === "resource" ? "available" : "reserved";
      const waterfront = isWaterfront(wx, wy);
      const owner = ownerFor(status, type, wx, wy);

      parcels.push({
        id: `AQT-${String(wx).padStart(3, "0")}-${String(wy).padStart(3, "0")}`,
        continentId: continent.id,
        districtId: district.id,
        gx: wx,
        gy: wy,
        wx,
        wy,
        type,
        status,
        waterfront,
        sizeM2: 256, // 16m x 16m, matching the earlier project's land-unit convention
        resourceType: resourceTypeFor(type, wx, wy),
        apartments,
        buildingName,
        placeName,
        owner,
        assets: assetsFor(owner, type, wx, wy),
        dailyReward: rewardFor(type, waterfront, wx, wy),
        tollFee: tollFor(owner, type, waterfront, wx, wy),
      });
    }
  }

  return parcels;
}

export const PARCELS: Parcel[] = buildWorld();

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
