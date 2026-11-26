import type { Language } from "@/i18n/translations";
import type { Tier } from "./grid";

const n = (v: number) => v.toLocaleString("en");
const tide = (v: number) => `${n(v)} TIDE`;

const en = {
  title: "Rainbowland",
  intro:
    "The continent of the old LAND. Every cell is one LAND NFT at its own coordinates. A cell stays in the mist until its LAND comes home through the Heritage Port; then it rises as a plot at the same address. Rainbowland grows exactly as its owners return.",
  stats: (claimed: number, total: number) => [
    { k: "LAND on the grid", v: n(total) },
    { k: "Came home", v: n(claimed) },
    { k: "Still in the mist", v: n(total - claimed) },
  ],
  search: "LAND (x, y) or token number",
  find: "Find",
  notFound: "No such LAND on the grid.",
  zoomIn: "Zoom in",
  zoomOut: "Zoom out",
  fit: "Whole continent",
  hint: "Drag to move, pinch or scroll to zoom, tap a cell.",
  loading: "Raising Rainbowland…",
  cell: "Cell",
  token: (t: number) => `Token #${n(t)}`,
  zone: "Zone",
  rarity: "Rarity",
  rarityUnknown: "not read yet",
  tier: "Tier",
  plotSize: (k: number) => `${k} ${k === 1 ? "cell" : "cells"} of land`,
  plotValue: (p: number) => `${tide(p)} value, earns like a bought plot`,
  subsoil: (pct: number) => (pct > 0 ? `+${pct}% subsoil bonus (for mining of the elements)` : "no subsoil bonus"),
  mist: "In the mist: this LAND has not come home yet.",
  owned: (who: string) => `Came home, held by ${who}`,
  mine: "This plot is yours.",
  swap: "Swap this LAND in the Heritage Port",
  swapNote: (fee: number | null) =>
    `Hold this LAND? Link your wallet in the Heritage Port and swap it${fee ? ` (fee ${tide(fee)})` : ""}. The plot appears here at the same coordinates.`,
  tiers: "Tiers",
  tierNames: { common: "Common", rare: "Rare", epic: "Epic", legendary: "Legendary", cyber: "Cyber" } satisfies Record<Tier, string>,
  tierLine: (tiles: number, price: number, pct: number) => `${tiles} ${tiles === 1 ? "cell" : "cells"} · ${tide(price)}${pct ? ` · +${pct}% subsoil` : ""}`,
  tierNote:
    "The tier comes from the rarity written in the LAND itself: Diamond, Mythical and the heaviest elements are Legendary; superheavy elements, gold, platinum and royal gems are Epic; radioactive elements and gems are Rare; about half the land is Common. Cyber land glows neon.",
  zones: "Zones",
  zonesNote: "Seven zones run west to east, one for each colour of the rainbow.",
  toPrism: "Prism Hills, the Polygon LAND next door",
  getThere: "Getting there",
  getThereNote: (harbour: string | null) =>
    `Rainbowland lies across the ocean. The Rainbow Bridge carries a road and a railway from First Light City to Rainbowland Station${harbour ? `; the ferry sails from ${harbour} to Rainbow Harbour` : ""}.`,
  youAreIn: (d: string) => `You are in ${d}.`,
  inRainbowland: "You are in Rainbowland.",
  noRoute: "No way from here yet.",
  modes: { walk: "Walk", car: "Car", train: "Train", ferry: "Ferry", plane: "Plane" } as Record<string, string>,
  overBridge: (mode: string) => `${mode} over the Rainbow Bridge`,
  fare: (v: number) => tide(v),
  noFare: "Not enough Tide for the fare.",
  signIn: "Sign in to travel",
  arrived: (fare: number) => `Welcome to Rainbowland. Fare ${tide(fare)}.`,
  backHome: (fare: number) => `Back in First Light City. Fare ${tide(fare)}.`,
  bridgeLabel: "Rainbow Bridge → First Light City",
  harbour: "Rainbow Harbour",
  station: "Rainbowland Station",
  errors: {
    session: "Please sign in again.",
    token: "No such LAND on the grid.",
    action: "Something went wrong.",
    network: "Rainbowland is not answering right now. Try again in a moment.",
  },
};

export type RainbowStrings = typeof en;
// The game is in English for now; other languages come through i18n later.
export const rainbowStrings = (_l: Language): RainbowStrings => en;

const prismEn = {
  title: "Prism Hills",
  intro:
    "The continent of the LAND on Polygon, beside Rainbowland: rolling hills and a ragged harbour, no houses. Every cell is one LAND NFT. A cell stays wild hillside until its LAND comes home through the Heritage Port; then it becomes a small plot of 1 to 3 cells at the same address.",
  stats: (claimed: number, total: number) => [
    { k: "LAND on the grid", v: n(total) },
    { k: "Came home", v: n(claimed) },
    { k: "Still wild", v: n(total - claimed) },
  ],
  search: "Parcel (x, y) or token number",
  find: "Find",
  notFound: "No such parcel on the grid.",
  zoomIn: "Zoom in",
  zoomOut: "Zoom out",
  fit: "Whole continent",
  hint: "Drag to move, pinch or scroll to zoom, tap a cell.",
  loading: "Raising Prism Hills…",
  cell: "Cell",
  token: (t: number) => `Token #${n(t)}`,
  plotSize: (k: number) => `${k} ${k === 1 ? "cell" : "cells"} of land`,
  plotValue: (p: number) => `${tide(p)} value, earns like a bought plot`,
  mist: "Wild hillside: this LAND has not come home yet.",
  owned: (who: string) => `Came home, held by ${who}`,
  mine: "This plot is yours.",
  swap: "Swap this LAND in the Heritage Port",
  swapNote: (fee: number | null) =>
    `Hold this LAND on Polygon? Link your wallet in the Heritage Port and swap it${fee ? ` (fee ${tide(fee)})` : ""}. The plot appears here at the same address.`,
  sizes: "Plot sizes",
  sizeLine: (k: number, price: number) => `${k} ${k === 1 ? "cell" : "cells"} · ${tide(price)}`,
  sizeNote: "The size is fixed by the token number: about six in ten plots are one cell, three in ten two cells, one in ten three cells.",
  getThere: "Getting there",
  getThereNote: "Prism Hills lies beside Rainbowland. The ferry sails from Rainbow Harbour to Prism Harbour, and the Prism Causeway carries a road and a railway from Rainbowland Station.",
  youAreIn: (d: string) => `You are in ${d}.`,
  inPrism: "You are in Prism Hills.",
  noRoute: "No way from here yet.",
  modes: en.modes,
  fare: (v: number) => tide(v),
  noFare: "Not enough Tide for the fare.",
  signIn: "Sign in to travel",
  arrived: (fare: number) => `Welcome to Prism Hills. Fare ${tide(fare)}.`,
  backHome: (fare: number) => `Back in First Light City. Fare ${tide(fare)}.`,
  harbour: "Prism Harbour",
  station: "Prism Hills Station",
  causeway: "Prism Causeway → Rainbowland",
  toRainbowland: "Rainbowland",
  errors: en.errors,
};
export type PrismStrings = typeof prismEn;
export const prismStrings = (_l: Language): PrismStrings => prismEn;
