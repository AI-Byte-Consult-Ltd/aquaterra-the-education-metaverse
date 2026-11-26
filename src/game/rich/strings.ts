import type { Language } from "@/i18n/translations";

const n = (v: number) => v.toLocaleString("en");
const tide = (v: number) => `${n(v)} TIDE`;

const en = {
  tide,
  title: "Richest residents",
  intro:
    "Every resident of AquaTerra World, ranked by net worth in Tide. Live from the city ledger: nothing here is estimated.",
  formula: "Net worth = TIDE on the wallet + land at the price paid + money put into buildings + bank deposit − open bank debt.",
  rank: "#",
  resident: "Resident",
  worth: "Net worth",
  tide_: "TIDE",
  land: "Land",
  buildings: "Buildings",
  bank: "Bank",
  unnamed: "Unnamed resident",
  founder: "Founder",
  plots: (k: number) => `${n(k)} ${k === 1 ? "plot" : "plots"}`,
  houses: (k: number) => `${n(k)} built`,
  debt: (v: number) => `debt ${tide(v)}`,
  deposit: (v: number) => `deposit ${tide(v)}`,
  total: (k: number) => `${n(k)} ${k === 1 ? "resident" : "residents"} with property`,
  updated: (at: string) => `Updated ${new Date(at).toLocaleString("en", { dateStyle: "medium", timeStyle: "short" })}`,
  empty: "Nobody owns anything yet. Be the first.",
  error: "The ledger is not answering right now. Try again in a minute.",
  retry: "Try again",
  join: "Become a resident",
  join2: "Sign up with your email, get 1,000 TIDE and buy your first plot.",
  world: "Open the world",
  back: "Back to the world",
};

export type RichStrings = typeof en;

/** English only for now (decision 2026-11-22). Add a language by registering another object. */
const registry: Partial<Record<Language, RichStrings>> = { en };

export const richStrings = (lang: Language): RichStrings => registry[lang] ?? en;
