import type { Language } from "@/i18n/translations";
import type { RingZone } from "./generator";

const en = {
  back: "AquaTerra",
  title: "City of Rays",
  badge: "Prototype",
  searchPlaceholder: "Ray 3, House 12",
  searchGo: "Go",
  notFound: "No such address",
  ray: (n: number) => `Ray ${n}`,
  address: (ray: number, house: number) => `Ray ${ray}, House ${house}`,
  tower: "First Light Tower",
  zone: "District",
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
  stats: (plots: number, rays: number, islands: number) => `${plots} plots · ${rays} rays · ${islands} islands`,
  hint: "Drag to move, scroll or pinch to zoom, tap a plot",
  towerAbout:
    "The heart of the city and home of NICS AI. Streets run out from the tower like rays. Apartments are the existing Radiant Residences NFTs on Cronos: one apartment, one NFT.",
  floors: "Floors",
  apartments: "Apartments (NFT)",
  contract: "Contract on Cronos",
  aiStatus: "NICS AI",
  aiStatusValue: "Co-governs the city. Voice starts with prepared phrases and cards while NICS Language trains.",
  zones: {
    core: "Core",
    inner: "Inner ring",
    middle: "Middle ring",
    outer: "Outer ring",
    coast: "Waterfront",
    islands: "Islands",
  } satisfies Record<RingZone, string>,
  tiles: {
    ocean: "Ocean",
    shallow: "Shallow water",
    beach: "Beach",
    land: "Land",
    park: "Public park",
    street: "Street",
    bridge: "Bridge",
    canal: "Ring canal",
    plaza: "Tower plaza",
    tower: "First Light Tower",
    plot: "Plot",
  } as Record<string, string>,
  tiles_m: "m",
};

export type CityStrings = typeof en;

/**
 * The game UI is English-only for now (decision 2026-11-22). To add a language,
 * write a `CityStrings` object for it and register it here; every other
 * language keeps falling back to English.
 */
const registry: Partial<Record<Language, CityStrings>> = { en };

export const cityStrings = (lang: Language): CityStrings => registry[lang] ?? en;

/** Locale for numbers: the language's own when its strings exist, else English. */
export const cityLocale = (lang: Language): string => (registry[lang] ? lang : "en");
