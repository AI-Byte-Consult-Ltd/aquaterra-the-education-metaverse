/*
 * Building on plots. Backend: n8n workflow "[68 PUBLIC] AquaTerra Build"
 * (POST /webhook/aquaterra-build), which hands each request to the Postgres
 * function aquaterra_build() (server/build/build.sql). Every rule (who may
 * build, prices, permits, heights, income, taxes) is decided there.
 */
import type { Built } from "@/game/world/buildings";

export const BUILD_ENDPOINT = (import.meta.env.VITE_BUILD_ENDPOINT as string | undefined) || "https://n8n.aibyteconsult.com/webhook/aquaterra-build";

export type BuildError =
  | "session" | "not_found" | "not_owner" | "not_buildable" | "tower_site" | "kind" | "occupied" | "nothing_here" | "building"
  | "max_level" | "height_limit" | "tower_limit" | "insufficient" | "nothing_to_claim" | "treasury_empty" | "forbidden" | "param"
  | "amount" | "network";

const KNOWN = new Set<BuildError>([
  "session", "not_found", "not_owner", "not_buildable", "tower_site", "kind", "occupied", "nothing_here", "building", "max_level",
  "height_limit", "tower_limit", "insufficient", "nothing_to_claim", "treasury_empty", "forbidden", "param", "amount",
]);

export type Result<T> = { ok: true; data: T; error?: undefined } | { ok: false; data?: undefined; error: BuildError };

export type BuildParamKey =
  | "cottage_cost" | "tower_cost_0" | "tower_cost_1" | "tower_cost_2" | "tower_cost_3" | "permit_pct" | "demolish_cost" | "sell_back_pct"
  | "cottage_income" | "tower_income_1" | "tower_income_2" | "tower_income_3" | "income_cap_days" | "tower_tax_step_pct"
  | "hours_cottage" | "hours_0" | "hours_1" | "hours_2" | "hours_3" | "max_towers_per_citizen";

export interface BuildRules {
  params: Record<BuildParamKey, number>;
  /** Law of the Commonwealth: highest building in the city centre, floors. */
  centreHeight: number;
  incomeTaxPct: number;
  floors: number[];
}

/** [plot id, kind, level, design, ready at (epoch seconds)] */
export type BuiltRow = [number, Built["kind"], number, number, number];

export interface MyBuilding {
  plotId: number;
  kind: "cottage" | "tower";
  level: number;
  floors: number;
  readyAt: string;
  invested: number;
  rate: number;
  taxPct: number;
  pending: number;
}

export interface BuildAdmin {
  rules: BuildRules;
  notes: Record<BuildParamKey, string>;
  counts: { cottages: number; towers: number; cleared: number; sites: number };
  spent: number;
  permits: number;
  incomeTax: number;
  recent: { at: string; plotId: number; who: string; action: string; kind: string; level: number; cost: number; fee: number }[];
}

const call = async <T>(body: Record<string, unknown>): Promise<Result<T>> => {
  try {
    const res = await fetch(BUILD_ENDPOINT, {
      method: "POST",
      // text/plain keeps this a "simple" request: no CORS preflight.
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => null)) as (Record<string, unknown> & { ok?: boolean; error?: string }) | null;
    if (!data || typeof data !== "object") return { ok: false, error: "network" };
    if (data.ok) return { ok: true, data: data as T };
    return { ok: false, error: KNOWN.has(data.error as BuildError) ? (data.error as BuildError) : "network" };
  } catch {
    return { ok: false, error: "network" };
  }
};

export const toBuilt = (rows: BuiltRow[]): Map<number, Built> =>
  new Map(rows.map(([id, kind, level, design, readyAt]) => [id, { kind, level, design, readyAt }]));

export const fetchBuildMap = () => call<{ buildings: BuiltRow[]; rules: BuildRules }>({ action: "map" });
export const fetchMyBuildings = (session: string) => call<{ mine: MyBuilding[]; free: number; rules: BuildRules }>({ action: "me", session });

type Done = { building: BuiltRow; floors: number; cost?: number; permit?: number; refund?: number; fee?: number };
export const buildOn = (session: string, plotId: number, kind: "cottage" | "tower", design: number, replace: boolean) =>
  call<Done>({ action: "build", session, plotId, kind, design, replace });
export const raiseTower = (session: string, plotId: number) => call<Done>({ action: "upgrade", session, plotId });
export const demolish = (session: string, plotId: number) => call<Done>({ action: "demolish", session, plotId });
export const sellBuilding = (session: string, plotId: number) => call<Done>({ action: "sell", session, plotId });
export const collectIncome = (session: string) => call<{ amount: number; tax: number }>({ action: "collect", session });

export const fetchBuildAdmin = (session: string) => call<BuildAdmin>({ action: "admin", session });
export const setBuildParam = (session: string, key: BuildParamKey, value: number) => call<BuildAdmin>({ action: "admin_param", session, key, value });

/** Cost and permit of the next step, by the same rule as the server. */
export const withPermit = (cost: number, rules: BuildRules) => cost + Math.round((cost * rules.params.permit_pct) / 100);
