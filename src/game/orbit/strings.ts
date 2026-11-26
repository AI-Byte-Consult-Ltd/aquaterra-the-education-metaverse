import type { Language } from "@/i18n/translations";
import type { OrbitError } from "./api";

const n = (v: number) => v.toLocaleString("en");
const tide = (v: number) => `${n(v)} TIDE`;
const RARITY = ["", "Common", "Uncommon", "Rare", "Epic", "Legendary", "Mythic"];

const en = {
  tide,
  n,
  title: "Orbit",
  short: "Orbit",
  backToWorld: "Back to the world",
  intro:
    "Above AquaTerra turns the Solar System. Its planets, moons and asteroids hold 10,000 mining claims: the Milky Way Marvels. Bring your claim home through the Heritage Port and mine its resource every day. The AquaTerra Reserve buys what you mine for Tide.",
  stats: (total: number, owned: number, miners: number) => `${n(total)} claims · ${n(owned)} brought home · ${n(miners)} ${miners === 1 ? "miner" : "miners"}`,
  notLoaded: "The sky charts are still being drawn from the NFT records. Come back in a few minutes.",
  tapHint: "Tap a planet to see its moons and claims.",
  sun: "Sun",
  belt: "Asteroid Belt",
  outer: "Outer Solar System",
  bodies: (k: number) => `${n(k)} ${k === 1 ? "body" : "bodies"}`,
  claims: (k: number) => `${n(k)} ${k === 1 ? "claim" : "claims"}`,
  home: (k: number) => `${n(k)} home`,
  rarity: (r: number) => RARITY[r] ?? "",
  free: "Still on chain",
  yours: "Yours",
  resources: "Resources",
  perUnit: (p: number) => `${p} TIDE a unit`,
  bring: "Bring a claim home",
  bringNote: "Own a Milky Way Marvels NFT? Link your wallet in the Heritage Port and swap it: it becomes the same claim here.",
  mine: "My claims",
  mineAll: "Mine all claims",
  minedToday: "Mined today",
  perDay: (u: number, res: string) => `${n(u)} ${res} a day`,
  noClaims: "You have no claims yet.",
  hold: "My hold",
  holdEmpty: "The hold is empty. Mine your claims to fill it.",
  sell: "Sell",
  worth: (v: number) => `worth ${tide(v)}`,
  mined: (k: number) => `Mined ${n(k)} ${k === 1 ? "claim" : "claims"}. Resources are in your hold.`,
  sold: (units: number, res: string, t: number, tax: number) => `Sold ${n(units)} ${res} for ${tide(t)}. ${tax}% income tax goes to the State Treasury.`,
  resets: (iso: string) => `Next mining in ${hoursTo(iso)}`,
  history: "Recent activity",
  logMine: (u: number, res: string) => `Mined ${n(u)} ${res}`,
  logSell: (u: number, res: string, t: number) => `Sold ${n(u)} ${res} for ${tide(t)}`,
  signIn: "Sign in to see and mine your claims.",
  soon: "Coming next: expeditions from the Skyport.",
  close: "Close",
  errors: {
    session: "Please sign in again.",
    not_found: "This body is not on the charts.",
    mined_today: "All your claims are mined today. Come back tomorrow.",
    no_claims: "You have no claims yet. Bring one home through the Heritage Port.",
    nothing: "Nothing of this resource in your hold.",
    units: "You do not have that many units.",
    too_little: "Too little to sell: it would not make one whole TIDE.",
    action: "Something went wrong.",
    network: "Connection problem. Check your internet and try again.",
  } satisfies Record<OrbitError, string>,
};

function hoursTo(iso: string) {
  const ms = Math.max(0, new Date(iso).getTime() - Date.now());
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

export type OrbitStrings = typeof en;

/** English only for now (decision 2026-11-22). Add a language by registering another object. */
const registry: Partial<Record<Language, OrbitStrings>> = { en };

export const orbitStrings = (lang: Language): OrbitStrings => registry[lang] ?? en;
