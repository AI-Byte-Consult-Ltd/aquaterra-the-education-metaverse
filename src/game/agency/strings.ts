import type { Language } from "@/i18n/translations";
import type { AgencyError, AgencyLaws, AssetKind } from "./api";

const n = (v: number) => v.toLocaleString("en");
const tide = (v: number) => `${n(v)} TIDE`;
const pct = (v: number) => `${Number(v).toLocaleString("en", { maximumFractionDigits: 2 })}%`;

const en = {
  n,
  tide,
  title: "First Light Realty",
  short: "Realty",
  backToWorld: "Back to the world",
  intro:
    "The real estate agency of AquaTerra. List anything you own for other residents at your own price: land and water plots with their houses, roads, tower apartments, Orbit planets, AI companions. Or sell a plot back to the state at its tax valuation.",
  signIn: "Sign in to buy and sell.",
  kinds: { plot: "Plots", road: "Roads", apartment: "Apartments", planet: "Planets", companion: "AI companions" } satisfies Record<AssetKind, string>,
  kind: { plot: "Plot", road: "Road", apartment: "Apartment", planet: "Planet", companion: "AI companion" } satisfies Record<AssetKind, string>,
  all: "All",
  rulesTitle: "How it works",
  rules: (l: AgencyLaws) => [
    `Listing is free. When it sells, the agency takes ${pct(l.feePct)} and the state takes ${pct(l.salesTaxPct)} sales tax from the seller.`,
    `The buyer pays the price${l.dutyPct > 0 ? `, and for land also the ${pct(l.dutyPct)} deal duty of the Charter` : ""}, with free Tide (welcome Tide is for land from the Reserve).`,
    `The asset stays yours until it is sold. A resident may own up to ${n(l.maxPlots)} plots and ${n(l.maxRoads)} roads.`,
    "A plot bought here earns its daily income on the lower of the price and its registry price.",
    `Sale to the state: land at ${pct(l.statePct)} of the lower of what you paid and the registry price, a house at ${pct(l.housePct)} of what was invested in it, minus ${pct(l.salesTaxPct)} sales tax. After ${n(l.holdDays)} days of owning the plot.`,
  ],
  market: "On sale",
  recent: "Recently sold",
  empty: "Nothing on sale here yet.",
  by: (s: string) => `by ${s}`,
  registry: (v: number) => `registry price ${tide(v)}`,
  buy: (price: number, duty: number) => `Buy for ${tide(price + duty)}`,
  bought: (t: string) => `${t} is yours.`,
  yours: "Your listing",
  free: (v: number) => `Free Tide: ${tide(v)}`,
  myAssets: "What you own",
  noAssets: "You own nothing yet. Buy land in the world first.",
  listedAs: (id: number) => `Listed (#${id})`,
  priceLabel: "Your price, TIDE",
  list: "List for sale",
  listed: "Listed with First Light Realty.",
  youGet: (v: number) => `You get ${tide(v)} after commission and tax`,
  cancel: "Take off sale",
  cancelled: "Taken off sale.",
  blocks: { pledged: "Pledged to the bank", auction: "At a land auction", field: "A crop grows here" },
  sellState: "Sell to the state",
  appraiseBtn: "Tax valuation",
  appraisalTitle: (a: string) => `Tax valuation of ${a}`,
  land: (v: number, p: number, base: number) => `Land: ${pct(p)} of ${tide(base)} = ${tide(v)}`,
  house: (v: number, p: number) => `House: ${pct(p)} of what was invested = ${tide(v)}`,
  tax: (v: number, p: number) => `Sales tax ${pct(p)}: −${tide(v)}`,
  net: (v: number) => `You get ${tide(v)}`,
  sellableAt: (iso: string) => `Can be sold to the state from ${new Date(iso).toLocaleString("en")}`,
  confirmState: (v: number) => `Sell for ${tide(v)}`,
  soldState: (a: string, v: number) => `${a} sold to the state for ${tide(v)}.`,
  stateNote: "The plot goes back on sale in the land registry and any building on it is taken down.",
  myListings: "Your listings",
  history: "Your deals",
  historyLine: (side: "sold" | "bought", title: string, price: number, fee: number, tax: number) =>
    side === "sold" ? `Sold ${title} for ${tide(price)} (commission ${tide(fee)}, tax ${tide(tax)})` : `Bought ${title} for ${tide(price)}`,
  close: "Close",
  barter: {
    title: "Barter",
    intro: (taxPct: number) =>
      `Swap your harvest for another crop directly with other residents. Each side pays ${pct(taxPct)} of the Reserve value of what it receives to the State Treasury.`,
    give: "I give",
    want: "I want",
    units: "Units",
    offer: "Offer the swap",
    offered: "Your offer is on the board.",
    board: "Offers",
    empty: "No offers yet.",
    line: (maker: string, gu: number, g: string, wu: number, w: string) => `${maker} gives ${n(gu)} ${g} for ${n(wu)} ${w}`,
    take: (tax: number) => `Swap (tax ${tide(tax)})`,
    done: "Swapped. The crops are in your barn.",
    cancel: "Cancel",
    cancelled: "Offer cancelled. Your crops are back in the barn.",
    taxNote: (v: number) => `Your tax, held until the swap: ${tide(v)}`,
  },
  errors: {
    session: "Please sign in again.",
    not_found: "Not found, or already gone.",
    not_owner: "This is not yours.",
    kind: "Unknown kind of asset.",
    price: "Check the price (a whole number of TIDE).",
    listed: "It is already on sale.",
    too_many: "Too many open listings or offers. Close one first.",
    self: "This is your own.",
    gone: "The seller no longer has it. The listing is closed.",
    insufficient: "Not enough free Tide (welcome Tide is for land from the Reserve).",
    plot_limit: "You already own the most plots a resident may own.",
    road_limit: "You already own the most roads a resident may own.",
    pledged: "This plot is pledged to the bank.",
    auction: "This plot is at a land auction.",
    field: "A crop grows on this plot. Harvest or clear the field first.",
    debt: "Pay your land tax debt first.",
    too_soon: "You have not owned this plot long enough yet.",
    too_little: "Too little to sell.",
    crop: "Choose two different crops.",
    units: "Check the number of units.",
    nothing: "Not enough in the barn.",
    action: "Something went wrong.",
    network: "No connection to the agency. Try again.",
  } satisfies Record<AgencyError, string>,
};

export type AgencyStrings = typeof en;

/** English only for now (decision 2026-11-22). Add a language by registering another object. */
const registry: Partial<Record<Language, AgencyStrings>> = { en };

export const agencyStrings = (lang: Language): AgencyStrings => registry[lang] ?? en;
