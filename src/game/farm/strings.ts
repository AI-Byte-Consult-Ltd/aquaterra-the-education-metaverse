import type { Language } from "@/i18n/translations";
import type { CropGroup, FarmError } from "./api";

const n = (v: number) => v.toLocaleString("en");
const tide = (v: number) => `${n(v)} TIDE`;
const price = (v: number) => `${v.toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 3 })} TIDE`;

function left(iso: string) {
  const ms = Math.max(0, new Date(iso).getTime() - Date.now());
  const mins = Math.ceil(ms / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

const en = {
  n,
  tide,
  price,
  title: "Farms",
  short: "Farms",
  backToWorld: "Back to the world",
  intro:
    "Turn your land into a field. A crop covers the whole plot: buy the seeds, wait while it grows, harvest it into your barn. Sell the harvest to other residents on the Harvest Market, or to the AquaTerra Reserve at its base price.",
  stats: (fields: number, farmers: number) => `${n(fields)} ${fields === 1 ? "field" : "fields"} growing · ${n(farmers)} ${farmers === 1 ? "farmer" : "farmers"}`,
  signIn: "Sign in to farm your land.",
  crops: {
    rose: "Roses", tulip: "Tulips", sunflower: "Sunflowers", lavender: "Lavender",
    strawberry: "Strawberries", grape: "Grapes", apple: "Apples", orange: "Oranges",
    carrot: "Carrots", potato: "Potatoes", tomato: "Tomatoes", pumpkin: "Pumpkins",
    wheat: "Wheat", tea: "Tea", coffee: "Coffee",
  } as Record<string, string>,
  icons: {
    rose: "🌹", tulip: "🌷", sunflower: "🌻", lavender: "💜", strawberry: "🍓", grape: "🍇", apple: "🍎", orange: "🍊",
    carrot: "🥕", potato: "🥔", tomato: "🍅", pumpkin: "🎃", wheat: "🌾", tea: "🍵", coffee: "☕",
  } as Record<string, string>,
  groups: { flowers: "Flowers", fruit: "Fruit", vegetables: "Vegetables", grain: "Grain", plantation: "Plantations" } satisfies Record<CropGroup, string>,
  hours: (h: number) => (h >= 24 && h % 24 === 0 ? `${h / 24} ${h === 24 ? "day" : "days"}` : `${h} h`),
  myFields: "My fields",
  noPlots: "You have no land yet. Buy a plot in the world first.",
  blockLand: "Water or works: nothing grows here.",
  blockBuilding: "You built a house here. Demolish it in the plot window to farm this land.",
  empty: "Ready to plant",
  choose: "Choose a crop",
  plantFor: (seed: number, units: number, crop: string, hours: string) => `Plant for ${tide(seed)} · ${n(units)} ${crop} in ${hours}`,
  growing: (crop: string, units: number, iso: string) => `${crop}: ${n(units)} ripe in ${left(iso)}`,
  ripe: (crop: string, units: number, wilts: string) => `${crop}: ${n(units)} ripe! Harvest within ${left(wilts)} or half wilts.`,
  wilted: (crop: string) => `${crop}: wilted, half is left`,
  harvest: "Harvest",
  harvestAll: "Harvest all ripe",
  dig: "Dig up",
  digConfirm: "Seeds are lost. Tap again",
  planted: (seed: number) => `Planted. Seeds cost ${tide(seed)}.`,
  harvested: (fields: number, units: number) => `Harvested ${n(fields)} ${fields === 1 ? "field" : "fields"}: ${n(units)} units to the barn.`,
  destroyed: (k: number) => `${n(k)} ${k === 1 ? "field was" : "fields were"} built over and lost.`,
  barn: "Barn",
  barnEmpty: "The barn is empty. Harvest a field or buy on the market.",
  reserve: "Sell to the Reserve",
  reserveNote: (cap: number, today: number, tax: number) =>
    `The Reserve buys at its base price, up to ${tide(cap)} a day (today ${tide(today)}). ${tax}% income tax goes to the State Treasury.`,
  sold: (units: number, crop: string, t: number) => `Sold ${n(units)} ${crop} to the Reserve for ${tide(t)}.`,
  worth: (v: number) => `Reserve pays ${tide(v)}`,
  market: "Harvest Market",
  marketNote: (tax: number) => `Residents trade with each other at their own prices. Orders meet at the price of the order that was there first. The seller pays ${tax}% tax to the State Treasury.`,
  crop: "Crop",
  reservePrice: "Reserve",
  bid: "Best bid",
  ask: "Best ask",
  last: "Last",
  volume: "24 h",
  asks: "Selling",
  bids: "Buying",
  trades: "Recent trades",
  noOrders: "No orders yet.",
  buy: "Buy",
  sell: "Sell",
  qty: "Units",
  priceEach: "Price per unit",
  total: (v: number) => `Total ${tide(v)}`,
  place: (side: "buy" | "sell") => (side === "buy" ? "Place buy order" : "Place sell order"),
  filled: (fills: number) => (fills > 0 ? `Order placed: ${n(fills)} ${fills === 1 ? "trade" : "trades"} done.` : "Order placed on the book."),
  myOrders: "My open orders",
  orderLine: (side: "buy" | "sell", left: number, qty: number, crop: string, p: number) =>
    `${side === "buy" ? "Buy" : "Sell"} ${n(left)}/${n(qty)} ${crop} at ${price(p)}`,
  cancel: "Cancel",
  cancelled: "Order cancelled, held goods returned.",
  free: (v: number) => `Free to spend: ${tide(v)}`,
  history: "History",
  log: {
    plant: (c: string, u: number, t: number) => `Planted ${c} (${tide(t)} seeds)`,
    harvest: (c: string, u: number) => `Harvested ${n(u)} ${c}`,
    clear: (c: string) => `Dug up ${c}`,
    reserve: (c: string, u: number, t: number) => `Sold ${n(u)} ${c} to the Reserve for ${tide(t)}`,
    buy: (c: string, u: number, t: number) => `Bought ${n(u)} ${c} for ${tide(t)}`,
    sell: (c: string, u: number, t: number) => `Sold ${n(u)} ${c} on the market, got ${tide(t)}`,
    barter: (c: string, u: number) => `Got ${n(u)} ${c} by barter`,
  },
  close: "Close",
  errors: {
    session: "Please sign in again.",
    not_found: "Not found.",
    not_owner: "Only the owner can farm this plot.",
    crop: "Unknown crop.",
    land: "Nothing grows here.",
    building: "A building stands here.",
    planted: "Something is already growing here.",
    not_ripe: "Nothing is ripe yet.",
    insufficient: "Not enough free Tide (welcome Tide is for land only).",
    nothing: "Not enough in the barn.",
    units: "Check the number of units.",
    too_little: "Too little to be worth a whole TIDE.",
    cap: "The Reserve has bought its daily limit from you. Try the Harvest Market or come back tomorrow.",
    side: "Choose buy or sell.",
    price: "Check the price (at least 0.01 TIDE).",
    too_many: "Too many open orders. Cancel one first.",
    action: "Something went wrong.",
    network: "No connection to the farm office. Try again.",
  } satisfies Record<FarmError, string>,
};

export type FarmStrings = typeof en;

/** English only for now (decision 2026-11-22). Add a language by registering another object. */
const registry: Partial<Record<Language, FarmStrings>> = { en };

export const farmStrings = (lang: Language): FarmStrings => registry[lang] ?? en;
