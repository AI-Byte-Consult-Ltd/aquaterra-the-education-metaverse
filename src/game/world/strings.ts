import type { Language } from "@/i18n/translations";
import type { STYLES } from "./buildings";
import type { Biome, Kind, Plot } from "./generator";

const en = {
  back: "AquaTerra",
  title: "AquaTerra World",
  badge: "Prototype",
  searchPlaceholder: "12 Coral Street",
  searchGo: "Go",
  notFound: "No such address",
  tower: "First Light Tower",
  district: "District",
  climate: "Climate",
  landscape: "Landscape",
  area: "Area",
  toTower: "To the tower",
  water: "Water view",
  yes: "yes",
  no: "no",
  status: "Status",
  free: "Free",
  buyLater: "Buying plots opens in stage 3 of the plan (ownership and economy). Nothing is for sale yet.",
  copyLink: "Copy link",
  copied: "Link copied",
  close: "Close",
  stats: (plots: number, districts: number, airports: number, stations: number) =>
    `${plots.toLocaleString("en")} plots · ${districts} districts · ${airports} airports · ${stations} stations`,
  hint: "Drag to move, scroll or pinch to zoom, tap a plot",
  towerAbout:
    "The heart of the world and home of NICS AI. Apartments are the existing Radiant Residences NFTs on Cronos: one apartment, one NFT.",
  floors: "Floors",
  apartments: "Apartments (NFT)",
  contract: "Contract on Cronos",
  aiStatus: "NICS AI",
  aiStatusValue: "Co-governs the world. Its voice starts with prepared phrases and cards while NICS Language trains.",
  biomes: {
    metropolis: "Metropolis",
    temperate: "Temperate",
    tundra: "Frozen north",
    desert: "Desert",
    jungle: "Tropical jungle",
    savanna: "Savanna",
    wetland: "Wetlands",
    volcanic: "Volcanic",
    autumn: "Autumn forest",
    blossom: "Blossom gardens",
  } satisfies Record<Biome, string>,
  landscapes: {
    meadow: "Open land",
    forest: "Woodland",
    hillside: "Hillside",
    beachfront: "Beachfront",
  } satisfies Record<Plot["landscape"], string>,
  tiles: {
    deep: "Deep ocean",
    ocean: "Ocean",
    shallow: "Shallow water",
    lake: "Lake",
    river: "River",
    beach: "Beach",
    land: "Open land",
    forest: "Forest",
    hill: "Hills",
    mountain: "Mountains",
    peak: "Peak",
    road: "Highway",
    street: "Street",
    bridge: "Bridge",
    rail: "Railway",
    railbridge: "Railway bridge",
    station: "Railway station",
    runway: "Runway",
    apron: "Airport",
    terminal: "Airport terminal",
    pier: "Pier",
    plaza: "Town square",
    tower: "First Light Tower",
  } satisfies Record<Kind, string>,
  wild: "Not divided into plots yet",
  houses: "Houses",
  housesOn: "Show houses",
  housesOff: "Hide houses",
  housesNote: "Houses on the map are a preview of what fits each plot. Nothing is built or owned yet.",
  fitsHere: "Fits here",
  floorsShort: (n: number) => (n === 1 ? "1 floor" : `${n} floors`),
  styles: {
    skyline: "Skyline Tower",
    spire: "Glass Spire",
    loft: "City Loft",
    garden: "Garden House",
    snowdome: "Snow Dome",
    lodge: "Timber Lodge",
    adobe: "Adobe Court",
    canopy: "Canopy Stilt House",
    rondavel: "Thatch Rondavel",
    stiltcabin: "Marsh Stilt Cabin",
    basalt: "Basalt Bunker",
    cedar: "Cedar Cottage",
    pagoda: "Blossom Pagoda",
    villa: "Beach Villa",
  } satisfies Record<keyof typeof STYLES, string>,
  m2: "m²",
  km: "km",
};

export type WorldStrings = typeof en;

/**
 * The game UI is English-only for now (decision 2026-11-22). To add a language,
 * write a `WorldStrings` object and register it here; every other language
 * falls back to English.
 */
const registry: Partial<Record<Language, WorldStrings>> = { en };

export const worldStrings = (lang: Language): WorldStrings => registry[lang] ?? en;
export const worldLocale = (lang: Language): string => (registry[lang] ? lang : "en");
