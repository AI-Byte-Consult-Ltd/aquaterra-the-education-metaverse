import type { Language } from "@/i18n/translations";
import type { IndustryError } from "./api";

const n = (v: number) => v.toLocaleString("en");
const tide = (v: number) => `${n(v)} TIDE`;

const en = {
  n,
  tide,
  title: "Industry",
  short: "Industry",
  backToWorld: "Back to the world",
  intro:
    "Set up a company on your land and it works around the clock: timber camps, clay pits, quarries, sand pits, mines and oil wells take what the ground holds, and works turn it into bricks, steel, glass, concrete and building materials. Every house you build uses materials: what your storehouse has is used first and that part of the price is not charged. Demolish a house and half of its materials come back.",
  stats: (c: number, o: number) => `${n(c)} ${c === 1 ? "company" : "companies"} at work · ${n(o)} ${o === 1 ? "owner" : "owners"}`,
  signIn: "Sign in to run companies on your land.",
  works: {
    timber: "Timber Camp", claypit: "Clay Pit", quarry: "Stone Quarry", sandpit: "Sand Pit", ironmine: "Iron Mine",
    coppermine: "Copper Mine", goldmine: "Gold Mine", oilwell: "Oil Well", oilrig: "Offshore Oil Rig",
    brickworks: "Brickworks", steelmill: "Steel Mill", glassworks: "Glassworks", cementworks: "Cement Works", buildersyard: "Builder's Yard",
  } as Record<string, string>,
  place: { land: "land plots", rock: "land and mountain plots", water: "water plots" } as Record<string, string>,
  myWorks: "My companies",
  noPlots: "You have no land yet. Buy a plot in the world first.",
  collectAll: "Collect from all",
  collect: "Collect",
  dismantle: "Dismantle",
  dismantleConfirm: "No refund. Tap again",
  perDay: (v: number, good: string) => `${n(v)} ${good} a day`,
  waiting: (v: number, good: string) => `${n(v)} ${good} ready`,
  needs: (q: number, good: string) => `takes ${q} ${good} each`,
  rich: (f: number) => (f >= 1.3 ? "rich deposit" : f >= 1 ? "good deposit" : f >= 0.7 ? "fair deposit" : "poor deposit"),
  capNote: (h: number) => `A company keeps up to ${h} hours of output, then waits for you to collect.`,
  choose: "Choose a company",
  setupFor: (cost: number, permit: number) => `Set up for ${tide(cost + permit)} (incl. ${tide(permit)} permit)`,
  blockPlanted: "A crop grows here. Harvest or dig it up on the farm first.",
  blockBuilding: "A house stands here. Demolish it in the plot window first.",
  nothingFits: "No company fits this plot.",
  store: "Storehouse",
  storeEmpty: "No resources yet. Collect from a company, buy on the market or ship goods down from Orbit.",
  trade: "Trade on the market",
  orbit: "Orbit hold",
  shipAll: (u: number) => `Ship ${n(u)} down`,
  catalog: "Companies and where they work",
  catalogNote: "Extraction depends on the ground of the district; every plot is a little richer or poorer. Mountains are rich in rock. Works in Forgeworks run 25% faster.",
  recipes: "What building takes",
  recipeNote: (depot: number, salvage: number, starter: number) =>
    `Per 100 TIDE of construction cost. Missing materials come from the Builder Depot at ${depot}% of the Reserve price, inside the price. Demolishing gives back ${salvage}% of the materials (an old starter house ${starter}% of a cottage).`,
  cottage: "Cottage",
  tower: "Skyscraper",
  set: (c: number, p: number) => `Company set up: ${tide(c + p)} paid.`,
  collected: (k: number, u: number) => `Collected ${n(u)} units from ${n(k)} ${k === 1 ? "company" : "companies"}.`,
  dismantled: "Company dismantled.",
  shipped: (u: number) => `${n(u)} units shipped to the storehouse.`,
  free: (v: number) => `Free to spend: ${tide(v)}`,
  errors: {
    session: "Please sign in again.",
    not_found: "Not found.",
    not_owner: "Only the owner can do this.",
    works_kind: "Unknown company.",
    works: "A company already works on this plot.",
    planted: "A crop grows here.",
    building: "A house stands here.",
    place: "This company cannot work on this plot.",
    too_many: "You run as many companies as the law allows.",
    insufficient: "Not enough free Tide (welcome Tide is for land only).",
    nothing: "Nothing to collect yet, or not enough inputs in the storehouse.",
    action: "Something went wrong.",
    network: "No connection to the industry office. Try again.",
  } satisfies Record<IndustryError, string>,
};

export type IndustryStrings = typeof en;
const registry: Partial<Record<Language, IndustryStrings>> = { en };
export const industryStrings = (lang: Language): IndustryStrings => registry[lang] ?? en;
