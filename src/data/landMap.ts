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
// Districts are keyed directly by which real tile (from the team's Tiled
// map, see tileMap.ts) sits at a cell -- not by geography. The team
// labeled each of the distinct tiles used on the map (terrain type, "just
// decoration", or a marker painted in for their own planning) and this
// file encodes that labeling directly in TILE_TO_DISTRICT. A tile that
// repeats all over the map (e.g. every riverbank/coastline edge) therefore
// produces one district scattered across the whole world, not one
// contiguous region -- that's intentional, not a bug. The map is a living
// source: when the team repaints tiles in Tiled, TILE_TO_DISTRICT gets
// re-derived from the new file, and a tile's meaning can change entirely
// between versions (see the V.2 update: the "reserved plot" marker tile
// was retired, and a former decoration tile became the "Islands" marker).
//
// Because district assignment now depends on the real per-cell tile id,
// PARCELS can no longer be built eagerly at module load (the tile grid is
// fetched asynchronously -- see tileMap.ts). initWorld(tileGrid) must be
// called once that fetch resolves; PARCELS is empty until then. LandMap.tsx
// calls it from the same effect that already loads the tile grid for
// rendering, so this doesn't add a second fetch.
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
  baseType: ParcelType;
  waterfront: boolean;
  blurb: LocalizedText;
  resourceMaterials?: readonly string[]; // overrides the generic list for "resource" districts
  rewardMultiplier?: number; // flavor multiplier on top of the base type reward, default 1
}

const DEFAULT_RESOURCE_MATERIALS = ["Platinum", "Gold", "Cobalt", "Rare Earth", "Emerald", "Energy Node"] as const;

export const DISTRICTS: District[] = [
  { id: "vanaheim", name: "Vanaheim", baseType: "residential", waterfront: false,
    blurb: { en: "Vast fertile lowlands where a river winds through orchards and open fields.", ru: "Обширные плодородные низины, где река вьётся среди садов и открытых полей." } },
  { id: "jotunheim", name: "Jotunheim", baseType: "resource", waterfront: false,
    blurb: { en: "Rugged highland claimed by no one — wild, resource-rich, and untamed.", ru: "Суровое нагорье, никем не освоенное — дикое, богатое ресурсами, неукрощённое." },
    resourceMaterials: ["Cobalt", "Rare Earth", "Platinum", "Iron Ore"] },
  { id: "alfheim", name: "Alfheim", baseType: "residential", waterfront: false,
    blurb: { en: "Bright northern plains bathed in light — home to the NICS AI Campus.", ru: "Светлые северные равнины, залитые светом — здесь расположен кампус NICS AI." } },
  { id: "muspelheim", name: "Muspelheim", baseType: "resource", waterfront: false,
    blurb: { en: "Scorched flats where the ground itself seems to smolder.", ru: "Выжженные равнины, где сама земля будто тлеет." },
    resourceMaterials: ["Energy Node", "Sulfur", "Obsidian"], rewardMultiplier: 1.1 },
  { id: "idavoll", name: "Idavoll", baseType: "residential", waterfront: false,
    blurb: { en: "The meeting-meadow — open green ground favored for new settlements.", ru: "Луг собраний — открытые зелёные земли, любимые новыми поселенцами." } },
  { id: "niflheim", name: "Niflheim", baseType: "resource", waterfront: true,
    blurb: { en: "Mist-veiled waters at the world's quiet edge.", ru: "Туманные воды на тихом краю мира." },
    resourceMaterials: ["Sea Salt", "Pearl", "Frost Crystal"] },
  { id: "nidavellir", name: "Nidavellir", baseType: "resource", waterfront: false,
    blurb: { en: "Stonework halls of the dwarves — masters of the forge and the mine.", ru: "Каменные чертоги гномов — мастеров кузни и рудника." },
    resourceMaterials: ["Gold", "Platinum", "Mithril"], rewardMultiplier: 1.2 },
  { id: "oceania", name: "Oceania", baseType: "resource", waterfront: true,
    blurb: { en: "Reef claims and tide pools, rich in rare resources.", ru: "Рифовые участки и отмели, богатые редкими ресурсами." },
    resourceMaterials: ["Pearl", "Coral", "Sea Salt"] },
  { id: "ran-reach", name: "Rán's Reach", baseType: "resource", waterfront: true,
    blurb: { en: "Named for the sea-goddess who claims what sinks — deep, cold water.", ru: "Названо в честь богини моря, забирающей всё затонувшее — глубокая, холодная вода." },
    resourceMaterials: ["Pearl", "Coral", "Kelp Silk"] },
  { id: "sindris-forge", name: "Sindri's Forge", baseType: "resource", waterfront: false,
    blurb: { en: "Named for the dwarf-smith of legend — a scorched, well-worked ground.", ru: "Названо в честь легендарного гнома-кузнеца — выжженная, обжитая земля." },
    resourceMaterials: ["Gold", "Energy Node", "Mithril"], rewardMultiplier: 1.2 },
  { id: "timber-plaza", name: "Timber Plaza", baseType: "residential", waterfront: false,
    blurb: { en: "Planked boardwalk ground, long since built up — open for any settler now.", ru: "Дощатая мостовая, давно обжитая земля — теперь открыта для любого поселенца." } },
  { id: "svartalfheim", name: "Svartalfheim", baseType: "resource", waterfront: false,
    blurb: { en: "A secretive enclave of rare hues — said to hide the richest veins in Aquaterra.", ru: "Скрытный анклав редких оттенков — говорят, здесь залегают самые богатые жилы Aquaterra." },
    resourceMaterials: ["Emerald", "Rare Earth", "Shadow Opal"], rewardMultiplier: 1.15 },
  { id: "coastal-reach", name: "Coastal Reach", baseType: "resource", waterfront: true,
    blurb: { en: "The shoreline itself — wherever land meets water, all around Aquaterra.", ru: "Сама береговая линия — везде, где земля встречается с водой, по всей Aquaterra." },
    resourceMaterials: ["Sea Salt", "Driftwood", "Coral"] },
  { id: "rivers-bend", name: "River's Bend", baseType: "resource", waterfront: true,
    blurb: { en: "Wherever a river curls back on itself, cutting the richest banks.", ru: "Там, где река делает петлю, вырезая самые плодородные берега." },
    resourceMaterials: ["Sea Salt", "River Gold", "Kelp Silk"] },
  { id: "lagoon", name: "Lagoon", baseType: "resource", waterfront: true,
    blurb: { en: "Still, sheltered water tucked behind the coastline.", ru: "Тихая, защищённая вода, укрытая за береговой линией." },
    resourceMaterials: ["Pearl", "Kelp Silk", "Coral"] },
  { id: "yggdrasils-grove", name: "Yggdrasil's Grove", baseType: "residential", waterfront: false,
    blurb: { en: "Named for the World Tree — wherever the land grows thick with trees.", ru: "Названо в честь Мирового Древа — везде, где земля густо поросла деревьями." } },
  { id: "old-road", name: "The Old Road", baseType: "commercial", waterfront: false,
    blurb: { en: "The paved way that ties every realm of Aquaterra together.", ru: "Мощёный путь, связывающий все земли Aquaterra воедино." }, rewardMultiplier: 1.1 },
  { id: "railway", name: "Railway", baseType: "commercial", waterfront: false,
    blurb: { en: "Iron rails carrying goods between the realms.", ru: "Железные пути, перевозящие товары между землями." }, rewardMultiplier: 1.15 },
  { id: "tidewater", name: "Tidewater", baseType: "resource", waterfront: true,
    blurb: { en: "Water that rises and falls with the world's own rhythm.", ru: "Вода, поднимающаяся и опадающая в такт дыханию мира." },
    resourceMaterials: ["Sea Salt", "Pearl"] },
  { id: "docks", name: "Docks", baseType: "commercial", waterfront: true,
    blurb: { en: "Timber piers where every realm's trade goods change hands.", ru: "Деревянные причалы, где товары всех земель переходят из рук в руки." }, rewardMultiplier: 1.25 },
  { id: "sunmeadow", name: "Sunmeadow", baseType: "residential", waterfront: false,
    blurb: { en: "Open green ground, unremarkable and easy to build on.", ru: "Открытая зелёная земля, ничем не примечательная и удобная для застройки." } },
  { id: "midgard", name: "Midgard", baseType: "commercial", waterfront: true,
    blurb: { en: "The mortal crossing — Aquaterra's harbor, markets and the causeway to every realm.", ru: "Мир смертных — гавань Aquaterra, рынки и дамба, ведущая во все земли." }, rewardMultiplier: 1.3 },
  { id: "windshore", name: "Windshore", baseType: "resource", waterfront: true,
    blurb: { en: "An exposed, wind-scoured stretch of water's edge.", ru: "Открытый, обдуваемый ветром край воды." },
    resourceMaterials: ["Sea Salt", "Driftwood"] },
  { id: "skerry", name: "Skerry", baseType: "resource", waterfront: true,
    blurb: { en: "A scatter of small rocky islets, barely above the waterline.", ru: "Россыпь маленьких скалистых островков, едва выступающих над водой." },
    resourceMaterials: ["Coral", "Driftwood", "Pearl"] },
  { id: "folkvangr", name: "Fólkvangr", baseType: "resource", waterfront: true,
    blurb: { en: "Freyja's flowering fields — little blooming isles scattered across Aquaterra's waters.", ru: "Цветущие поля Фрейи — маленькие цветущие островки, разбросанные по водам Aquaterra." },
    resourceMaterials: ["Wildflower Pollen", "Honey", "Herbal Extract"], rewardMultiplier: 1.1 },
  { id: "terra-incognita", name: "Terra Incognita", baseType: "resource", waterfront: false,
    blurb: { en: "Unmapped ground — not yet classified, same as most real Aquaterra LANDs today.", ru: "Неразмеченная земля — пока не классифицирована, как и большинство настоящих участков Aquaterra сегодня." },
    resourceMaterials: DEFAULT_RESOURCE_MATERIALS, rewardMultiplier: 0.7 },
];

const DISTRICT_BY_ID = new Map(DISTRICTS.map((d) => [d.id, d]));
const TERRA_INCOGNITA = "terra-incognita";

// Local tile id -> district id. Anything not listed here (including tiles
// outside the 76 the team labeled) falls back to Terra Incognita.
const TILE_TO_DISTRICT: Record<number, string> = {
  744: "vanaheim",
  1151: "jotunheim",
  62: "alfheim",
  1086: "muspelheim",
  1492: "idavoll",
  638: "niflheim",
  176: "nidavellir",
  60: "oceania", 231: "oceania",
  1498: "ran-reach",
  809: "sindris-forge",
  1041: "timber-plaza",
  1257: "svartalfheim",
  // Coastline/riverbank edging -- appears all over the map, wherever land meets water.
  59: "coastal-reach", 61: "coastal-reach", 117: "coastal-reach", 3: "coastal-reach",
  57: "coastal-reach", 118: "coastal-reach", 2: "coastal-reach", 115: "coastal-reach",
  4: "coastal-reach", 114: "coastal-reach", 116: "coastal-reach", 58: "coastal-reach",
  402: "rivers-bend",
  920: "lagoon",
  534: "yggdrasils-grove", 528: "yggdrasils-grove",
  234: "old-road", 119: "old-road", 233: "old-road",
  1069: "railway",
  178: "tidewater",
  467: "docks", 1322: "docks", 1262: "docks",
  980: "sunmeadow",
  1570: "midgard", 1462: "midgard", 1519: "midgard", 1520: "midgard", 1463: "midgard", 1569: "midgard", 1571: "midgard",
  979: "windshore", 981: "windshore", 637: "windshore", 639: "windshore",
  1365: "skerry", 1366: "skerry",
  573: "folkvangr",
  // Everything below this line was left as "or Terra Incognita" -- kept
  // explicit (rather than just falling through) so the source list of what
  // was reviewed and left unclassified is visible in one place.
  410: TERRA_INCOGNITA, 524: TERRA_INCOGNITA, 752: TERRA_INCOGNITA, 866: TERRA_INCOGNITA,
  923: TERRA_INCOGNITA, 1037: TERRA_INCOGNITA, 409: TERRA_INCOGNITA, 411: TERRA_INCOGNITA,
  466: TERRA_INCOGNITA, 468: TERRA_INCOGNITA, 523: TERRA_INCOGNITA, 525: TERRA_INCOGNITA,
  751: TERRA_INCOGNITA, 753: TERRA_INCOGNITA, 865: TERRA_INCOGNITA, 867: TERRA_INCOGNITA,
  922: TERRA_INCOGNITA, 924: TERRA_INCOGNITA, 580: TERRA_INCOGNITA, 582: TERRA_INCOGNITA,
  1036: TERRA_INCOGNITA, 1038: TERRA_INCOGNITA, 694: TERRA_INCOGNITA, 696: TERRA_INCOGNITA,
};

function districtForTile(localId: number): District {
  return DISTRICT_BY_ID.get(TILE_TO_DISTRICT[localId] ?? TERRA_INCOGNITA) ?? DISTRICT_BY_ID.get(TERRA_INCOGNITA)!;
}

const SEED = 1337;

// Towers: fixed 2x2 blocks near Aquaterra's original "capital" corner.
const TOWERS: Array<{ cells: [number, number][]; name: string; apartments: number }> = [
  { cells: [[125, 85], [126, 85], [125, 86], [126, 86]], name: "Asgard Spire I", apartments: 36 },
  { cells: [[137, 96], [138, 96], [137, 97], [138, 97]], name: "Asgard Spire II", apartments: 28 },
];

// The NICS AI Campus -- a small reserved block.
const EDUCATION_ZONE: [number, number][] = [
  [430, 78], [431, 78], [432, 78],
  [430, 79], [431, 79], [432, 79],
];

// A couple of hand-placed landmarks for flavor (never for sale).
const LANDMARKS: Array<{ cell: [number, number]; name: LocalizedText }> = [
  { cell: [150, 110], name: { en: "Bifröst Gate", ru: "Врата Бифрёст" } },
  { cell: [300, 420], name: { en: "Yggdrasil's Root", ru: "Корень Иггдрасиля" } },
];

export interface Parcel {
  id: string;
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

function resourceTypeFor(district: District, type: ParcelType, wx: number, wy: number): string | undefined {
  if (type !== "resource") return undefined;
  const materials = district.resourceMaterials ?? DEFAULT_RESOURCE_MATERIALS;
  const roll = hashCell(SEED + 2, wx, wy);
  return materials[Math.floor(roll * materials.length)];
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
  { types: ["commercial"], threshold: 0.55, asset: { icon: "workshop", label: { en: "Workshop", ru: "Мастерская" } } },
];
const FORGE_DISTRICTS = new Set(["sindris-forge", "nidavellir"]);
const TRANSIT_DISTRICTS = new Set(["old-road", "railway"]);
function assetsFor(owner: string | null, district: District, type: ParcelType, wx: number, wy: number): ParcelAsset[] {
  if (!owner) return [];
  const roll = hashCell(SEED + 8, wx, wy);
  const assets: ParcelAsset[] = [];
  for (const r of ASSET_ROLLS) if (r.types.includes(type) && roll > r.threshold) assets.push(r.asset);
  if (FORGE_DISTRICTS.has(district.id) && roll > 0.45) assets.push({ icon: "workshop", label: { en: "Workshop", ru: "Мастерская" } });
  if (district.waterfront && roll > 0.55) assets.push({ icon: "dock", label: { en: "Dock", ru: "Причал" } });
  if (TRANSIT_DISTRICTS.has(district.id) && roll > 0.5) assets.push({ icon: "vehicle", label: { en: "Vehicle", ru: "Транспорт" } });
  else if (roll > 0.85) assets.push({ icon: "vehicle", label: { en: "Vehicle", ru: "Транспорт" } });
  return assets;
}

const REWARD_BASE: Record<ParcelType, number> = { residential: 4, commercial: 9, resource: 14, tower: 22, education: 0, landmark: 0 };
function rewardFor(district: District, type: ParcelType, waterfront: boolean, wx: number, wy: number): number {
  const base = REWARD_BASE[type];
  if (base === 0) return 0;
  const variance = 0.85 + hashCell(SEED + 9, wx, wy) * 0.3;
  return Math.round(base * (waterfront ? 1.3 : 1) * (district.rewardMultiplier ?? 1) * variance * 10) / 10;
}

const TOLL_BASE: Record<ParcelType, number> = { residential: 0.5, commercial: 1.2, resource: 1.5, tower: 2.5, education: 0, landmark: 0 };
function tollFor(owner: string | null, type: ParcelType, waterfront: boolean, wx: number, wy: number): number {
  if (!owner) return 0;
  const base = TOLL_BASE[type];
  if (base === 0) return 0;
  const variance = 0.8 + hashCell(SEED + 10, wx, wy) * 0.4;
  return Math.round(base * (waterfront ? 1.2 : 1) * variance * 10) / 10;
}

function unpackLocalId(packed: number): number {
  return (packed & 0x7ff) - 1; // see tileMap.ts: 0 means "no tile", ids are stored +1
}

function buildWorld(tileGrid: Uint16Array): Parcel[] {
  const parcels: Parcel[] = [];
  const size = WORLD_FACTS.gridSize;

  const towerCellMap = new Map<string, { name: string; apartments: number }>();
  for (const t of TOWERS) for (const c of t.cells) towerCellMap.set(`${c[0]},${c[1]}`, { name: t.name, apartments: t.apartments });
  const educationCells = new Set(EDUCATION_ZONE.map(([x, y]) => `${x},${y}`));
  const landmarkCellMap = new Map<string, LocalizedText>();
  for (const l of LANDMARKS) landmarkCellMap.set(`${l.cell[0]},${l.cell[1]}`, l.name);

  for (let wy = 0; wy < size; wy++) {
    const row = wy * size;
    for (let wx = 0; wx < size; wx++) {
      const key = `${wx},${wy}`;
      const packed = tileGrid[row + wx];
      const localId = unpackLocalId(packed);
      const district = localId >= 0 ? districtForTile(localId) : DISTRICT_BY_ID.get(TERRA_INCOGNITA)!;

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

      const status: ParcelStatus = (type === "residential" || type === "commercial" || type === "resource") ? "available" : "reserved";
      const owner = ownerFor(status, type, wx, wy);
      const waterfront = district.waterfront;

      parcels.push({
        id: `AQT-${String(wx).padStart(3, "0")}-${String(wy).padStart(3, "0")}`,
        districtId: district.id,
        gx: wx,
        gy: wy,
        wx,
        wy,
        type,
        status,
        waterfront,
        sizeM2: 256, // 16m x 16m, matching the earlier project's land-unit convention
        resourceType: resourceTypeFor(district, type, wx, wy),
        apartments,
        buildingName,
        placeName,
        owner,
        assets: assetsFor(owner, district, type, wx, wy),
        dailyReward: rewardFor(district, type, waterfront, wx, wy),
        tollFee: tollFor(owner, type, waterfront, wx, wy),
      });
    }
  }

  return parcels;
}

export let PARCELS: Parcel[] = [];
let parcelByCell = new Map<string, Parcel>();

// Must be called once the real tile grid has loaded (see tileMap.ts) --
// district assignment depends on it. Safe to call more than once (e.g. if
// the page re-mounts); it just rebuilds.
export function initWorld(tileGrid: Uint16Array): void {
  PARCELS = buildWorld(tileGrid);
  parcelByCell = new Map(PARCELS.map((p) => [`${p.wx},${p.wy}`, p]));
}

export const WORLD_BOUNDS = { maxX: WORLD_FACTS.gridSize, maxY: WORLD_FACTS.gridSize };

export function parcelAtWorld(wx: number, wy: number): Parcel | undefined {
  return parcelByCell.get(`${wx},${wy}`);
}

// Converts an internal render coordinate to the official on-chain-style
// coordinate the docs use (grid starts at (coordMin, coordMin)).
export function officialCoord(w: number): number {
  return w + WORLD_FACTS.coordMin;
}

export function districtOf(p: Parcel): District {
  return DISTRICT_BY_ID.get(p.districtId) ?? DISTRICT_BY_ID.get(TERRA_INCOGNITA)!;
}
