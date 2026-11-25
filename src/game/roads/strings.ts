import type { Language } from "@/i18n/translations";
import type { RoadsError } from "./api";

const n = (v: number) => v.toLocaleString("en");
const tide = (v: number) => `${n(v)} TIDE`;
const pct = (v: number) => `${v.toLocaleString("en", { maximumFractionDigits: 1 })}%`;

const en = {
  tide,
  pct,
  title: "Roads",
  backToWorld: "Back to the world",
  intro:
    "Every road between two districts can be owned. The owner earns the fare of every car trip on it, after the travel tax. Roads wear out with time and traffic: keep yours in repair, or First Light Transit repairs it at your cost.",
  company: "First Light Transit",
  companyIntro: "The state transport company. It owns the roads nobody has bought, earns their tolls and does every repair.",
  companyBalance: "Company account",
  companyRoads: (k: number, sold: number) => `${n(k)} ${k === 1 ? "road" : "roads"} of its own, ${n(sold)} sold`,
  tolls: "Tolls received",
  repairsPaid: "Paid for repairs",
  sales: "Road sales",
  rulesTitle: "How roads work",
  rules: (l: Required<Record<string, number>>) => [
    `Price: ${tide(l.road_price_base)} plus ${tide(l.road_price_per_tile)} per tile of length. Bought with earned TIDE while you stand in one of its two districts, at most ${n(l.road_max_per_citizen)} per resident.`,
    `Every car trip: ${pct(l.travel_tax_pct)} travel tax to the State Treasury, the rest to the owner. You drive on your own road for the tax only.`,
    `Wear: ${pct(l.road_decay_day_pct)} a day and ${pct(l.road_wear_trip_pct)} a trip. A full repair from 0 to 100% costs ${pct(l.road_repair_full_pct)} of the price, less in proportion.`,
    `Below ${pct(l.road_full_income_pct)} the owner gets a smaller share of each fare, the rest goes to First Light Transit.`,
    `Below ${pct(l.road_auto_repair_pct)} First Light Transit repairs the road at the owner's cost. If the owner cannot pay, the road returns to the state and the owner gets ${pct(l.road_takeover_refund_pct)} of the price minus the repair.`,
    "These numbers are laws of the Council.",
  ],
  roadsHere: "Roads of this district",
  yoursShort: "you",
  allRoads: "All roads and the rules →",
  mine: "My roads",
  all: "All roads",
  noMine: "You own no road yet.",
  filterForSale: "For sale only",
  length: (d: number) => `${n(d)} tiles`,
  condition: "Condition",
  owner: "Owner",
  stateOwned: "First Light Transit",
  price: "Price",
  tripsRevenue: (trips: number, rev: number) => `${n(trips)} trips · earned ${tide(rev)}`,
  buy: (p: number) => `Buy for ${tide(p)}`,
  buyHere: "Stand in one of its districts to buy it",
  priceAway: (p: number) => `For sale: ${tide(p)}. Travel to one of its districts to buy it.`,
  bought: (name: string) => `${name} is yours`,
  repair: (c: number) => `Repair to 100% for ${tide(c)}`,
  repaired: (c: number) => `Repaired for ${tide(c)}`,
  fullRepair: "In full repair",
  worn: "Worn: you get a smaller share of each fare",
  critical: "Near the repair line",
  spendable: (v: number) => `You can spend ${tide(v)} on roads.`,
  signIn: "Sign in to buy a road.",
  errors: {
    session: "Your session has ended. Please sign in again.",
    not_found: "This road does not exist.",
    taken: "Someone already owns this road.",
    not_here: "Go to one of the road's two districts to buy it.",
    road_limit: "You own the most roads one resident can hold.",
    insufficient: "Not enough earned Tide for this.",
    not_owner: "This is not your road.",
    repaired: "This road needs no repair.",
    amount: "Enter a valid number.",
    action: "Unknown request.",
    network: "Connection problem. Check your internet and try again.",
  } satisfies Record<RoadsError, string>,
};

export type RoadsStrings = typeof en;

/** English only for now (decision 2026-11-22). Add a language by registering another object. */
const registry: Partial<Record<Language, RoadsStrings>> = { en };

export const roadsStrings = (lang: Language): RoadsStrings => registry[lang] ?? en;
