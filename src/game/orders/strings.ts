import type { Language } from "@/i18n/translations";
import type { OrderError } from "./api";

const n = (v: number) => v.toLocaleString("en");
const tide = (v: number) => `${n(v)} TIDE`;

const en = {
  n,
  tide,
  title: "City Orders",
  short: "Orders",
  backToWorld: "Back to the world",
  intro:
    "Every day NICS AI looks at what the city needs and posts orders: crops for a feast, bricks for a bridge, fish for the harbour market. Deliver from your storehouse and the city pays more than the Reserve. Orders end at midnight UTC, filled or not.",
  nics: "NICS AI, city planner",
  today: "Today's orders",
  none: "No orders today.",
  endsIn: (h: number, m: number) => `New orders in ${h} h ${m} min`,
  projects: {
    feast: "the Founders' feast", canteen: "the school canteens", foodbank: "the city food bank", festival: "the harvest festival",
    fishmarket: "the harbour fish market", harbourfeast: "the harbour feast",
    bridge: "a new bridge", school: "a new school", harbour: "the harbour works", clinic: "a new clinic", library: "the city library", seawall: "the sea wall",
    foundry: "the city foundry", roads: "road repairs", station: "the new station", workshop: "the city workshops",
  } as Record<string, string>,
  need: (q: number, good: string, project: string) => `${n(q)} ${good} for ${project}`,
  pays: (r: number, p: number, pct: number) => `Pays ${n(r)} TIDE a unit (Reserve ${n(p)}, +${pct - 100}%)`,
  progress: (d: number, q: number, s: number) => `${n(d)} of ${n(q)} delivered · ${n(s)} ${s === 1 ? "supplier" : "suppliers"}`,
  filled: "Filled. Thank you!",
  youHave: (h: number) => `You have ${n(h)}`,
  deliver: (u: number, t: number) => `Deliver ${n(u)} for ${tide(t)}`,
  howToGet: "Grow it on a farm, make it in industry or buy it on the market.",
  signIn: "Sign in to deliver to the city.",
  rules: (share: number, cap: number, tax: number) =>
    `One resident fills at most ${share}% of an order and earns up to ${tide(cap)} a day from orders. Pay comes from the AquaTerra Reserve; ${tax}% income tax goes to the State Treasury. Delivered goods are used by the city.`,
  earned: (v: number, cap: number) => `Earned from orders today: ${tide(v)} of ${tide(cap)}`,
  past: "Last days",
  pastRow: (o: number, f: number, u: number, t: number) => `${f} of ${o} filled · ${n(u)} units · ${tide(t)} paid`,
  workforce: "Workforce",
  workforceIntro: (base: number) =>
    `Your homes house NPC residents, and they work in your companies and farms. With enough people everything runs at full speed; with nobody it runs at ${base}%.`,
  people: "People in your homes",
  jobs: "Jobs in your companies and farms",
  output: "Output",
  outputNote: (pct: number, people: number, jobs: number) =>
    jobs === 0 ? "No jobs yet: set up a company or plant a field." : people >= jobs ? `Fully staffed: ${pct}% speed.` : `Short of ${n(jobs - people)} ${jobs - people === 1 ? "worker" : "workers"}: ${pct}% speed. Build homes to grow.`,
  homes: "Homes",
  noHomes: "No homes yet. A cottage houses people; a skyscraper many more.",
  homeKind: (k: string, level: number) => (k === "tower" ? `Skyscraper, ${[0, 10, 30, 60][level] ?? 0} floors` : k === "starter" ? "Starter house" : "Cottage"),
  peopleN: (v: number) => `${n(v)} ${v === 1 ? "person" : "people"}`,
  homeTable: (h: { starter: number; cottage: number; tower1: number; tower2: number; tower3: number }) =>
    `A starter house houses ${h.starter}, a cottage ${h.cottage}, a skyscraper ${h.tower1} / ${h.tower2} / ${h.tower3} (10 / 30 / 60 floors).`,
  jobTable: "Jobs per company",
  farmJobs: "Field", seaJobs: "Sea pen",
  city: (p: number, j: number) => `The city: ${n(p)} NPC residents, ${n(j)} jobs`,
  delivered: (u: number, t: number) => `Delivered ${n(u)}: ${tide(t)} before tax.`,
  errors: {
    session: "Please sign in again.",
    not_found: "Order not found.",
    expired: "This order has ended.",
    filled: "This order is already filled.",
    share: "You delivered your share of this order. Leave some for other residents.",
    cap: "You reached today's limit for city orders.",
    nothing: "You have none of this in your storehouse.",
    units: "Wrong number of units.",
    too_little: "Too little to pay out.",
    action: "Something went wrong.",
    network: "No connection to the city office. Try again.",
  } satisfies Record<OrderError, string>,
};

export type OrderStrings = typeof en;
const registry: Partial<Record<Language, OrderStrings>> = { en };
export const orderStrings = (lang: Language): OrderStrings => registry[lang] ?? en;
