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
    "The tier comes from the rarity written in the LAND itself: superheavy elements, Diamond and Mythical are Legendary; precious metals, radioactive elements and royal gems are Epic; rare earths and gems are Rare; Cyber land glows neon.",
  zones: "Zones",
  zonesNote: "Seven zones run west to east, one for each colour of the rainbow.",
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
