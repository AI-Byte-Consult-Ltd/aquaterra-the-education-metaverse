/*
 * Industry: companies on plots that extract resources and make building materials.
 * Same backend as farms: n8n "[73 PUBLIC] AquaTerra Farm" hands the request to aquaterra_farm(),
 * which passes these actions to aquaterra_industry() (server/industry/industry.sql).
 * The storehouse, the Reserve and the market are the farm ones.
 */
import { FARM_ENDPOINT } from "@/game/farm/api";

export const INDUSTRY_ERRORS = [
  "session", "not_found", "not_owner", "works_kind", "works", "planted", "building", "place", "too_many",
  "insufficient", "nothing", "action",
] as const;
export type IndustryError = (typeof INDUSTRY_ERRORS)[number] | "network";
const KNOWN = new Set<string>(INDUSTRY_ERRORS);
export type Result<T> = { ok: true; data: T; error?: undefined } | { ok: false; data?: undefined; error: IndustryError };

export interface WorksType {
  key: string;
  product: string;
  in1: string | null;
  in1Qty: number;
  in2: string | null;
  in2Qty: number;
  /** units a tile a day at factor 1 */
  rate: number;
  place: "land" | "rock" | "water";
  cost: number;
  permit: number;
  /** deposit factor by biome, extraction only */
  biomes: Record<string, number> | null;
}
export interface Good {
  key: string;
  group: "raw" | "material" | "orbit";
  price: number;
  depot: number;
}
export interface IndustryPlot {
  plotId: number;
  address: string;
  district: string;
  tiles: number;
  biome: string | null;
  water: boolean;
  block: "planted" | "building" | null;
  works: { kind: string; factor: number; perDay: number; pending: number; since: string } | null;
  /** companies that can stand here, with how rich the plot is for each */
  options: Record<string, number> | null;
}
export interface Catalog {
  types: WorksType[];
  goods: Good[];
  recipes: Record<"cottage" | "tower", Record<string, number>>;
  laws: { capHours: number; maxWorks: number; depotPct: number; salvagePct: number; starterSalvagePct: number; marketTaxPct: number };
  companies: number;
  owners: number;
}
export interface MyIndustry extends Catalog {
  plots: IndustryPlot[];
  store: Record<string, number>;
  orbit: { resource: string; units: number; good: string }[];
  free: number;
  cost?: number;
  permit?: number;
  collected?: number;
  units?: number;
  shipped?: number;
}

async function call<T>(body: Record<string, unknown>): Promise<Result<T>> {
  try {
    const res = await fetch(FARM_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => null)) as (Record<string, unknown> & { ok?: boolean; error?: string }) | null;
    if (!data || typeof data !== "object") return { ok: false, error: "network" };
    if (data.ok) return { ok: true, data: data as unknown as T };
    return { ok: false, error: KNOWN.has(String(data.error)) ? (data.error as IndustryError) : "network" };
  } catch {
    return { ok: false, error: "network" };
  }
}

export const fetchCatalog = (session?: string | null) => call<MyIndustry>({ action: "works", ...(session ? { session } : {}) });
export const setupWorks = (session: string, plotId: number, works: string) => call<MyIndustry>({ action: "setup", session, plotId, works });
export const produce = (session: string, plotId?: number) => call<MyIndustry>({ action: "produce", session, ...(plotId !== undefined ? { plotId } : {}) });
export const dismantle = (session: string, plotId: number) => call<MyIndustry>({ action: "dismantle", session, plotId });
export const ship = (session: string, resource: string) => call<MyIndustry>({ action: "ship", session, resource });

/** Materials a construction needs, same rounding as aquaterra_ind_recipe(). */
export function recipeFor(c: Catalog, kind: "cottage" | "tower", cost: number) {
  const r = c.recipes?.[kind] ?? {};
  return Object.keys(r).sort().map((k) => ({ key: k, qty: cost > 0 ? Math.ceil((r[k] * cost) / 100 - 1e-9) : 0 }));
}

/** Tide not charged because the storehouse supplies materials, as aquaterra_industry_use() counts it. */
export function materialsSaving(c: Catalog, store: Record<string, number>, kind: "cottage" | "tower", cost: number) {
  const depot = Object.fromEntries(c.goods.map((g) => [g.key, g.depot]));
  const save = recipeFor(c, kind, cost).reduce((s, x) => s + Math.min(x.qty, store[x.key] ?? 0) * (depot[x.key] ?? 0), 0);
  return Math.min(cost, Math.floor(save + 1e-9));
}
