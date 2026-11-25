/*
 * Roads of AquaTerra World and First Light Transit. Backend: n8n workflow
 * "[70 PUBLIC] AquaTerra Roads" (POST /webhook/aquaterra-roads), which hands each
 * request to the Postgres function aquaterra_roads() (server/roads/roads.sql).
 * Prices, tolls, wear and repairs are decided there; this file only asks.
 */
export const ROADS_ENDPOINT = (import.meta.env.VITE_ROADS_ENDPOINT as string | undefined) || "https://n8n.aibyteconsult.com/webhook/aquaterra-roads";

export type RoadsError = "session" | "not_found" | "taken" | "not_here" | "road_limit" | "insufficient" | "not_owner" | "repaired" | "amount" | "action" | "network";
const KNOWN = new Set<string>(["session", "not_found", "taken", "not_here", "road_limit", "insufficient", "not_owner", "repaired", "amount", "action"]);

export type Result<T> = { ok: true; data: T; error?: undefined } | { ok: false; data?: undefined; error: RoadsError };

export interface Road {
  id: string;
  a: number;
  b: number;
  dist: number;
  name: string;
  price: number;
  owner: string | null;
  mine: boolean;
  /** Condition now, percent. */
  cond: number;
  /** TIDE to bring it back to 100%. */
  repairCost: number;
  trips: number;
  revenue: number;
  repairs: number;
  boughtAt: string | null;
}

export type RoadLaws = Partial<Record<
  | "road_price_base" | "road_price_per_tile" | "road_max_per_citizen" | "road_decay_day_pct" | "road_wear_trip_pct"
  | "road_repair_full_pct" | "road_full_income_pct" | "road_auto_repair_pct" | "road_takeover_refund_pct" | "travel_tax_pct",
  number
>>;

export interface RoadsView {
  roads: Road[];
  laws: RoadLaws;
  company: { balance: number; roads: number; sold: number; tolls: number; repairs: number; sales: number };
  /** District where I stand (signed in only). */
  here: number | null;
  /** TIDE I may spend on roads (earned, not welcome coins). */
  balance: number | null;
}

const call = async (body: Record<string, unknown>): Promise<Result<RoadsView>> => {
  try {
    const res = await fetch(ROADS_ENDPOINT, {
      method: "POST",
      // text/plain keeps this a "simple" request: no CORS preflight.
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => null)) as (Record<string, unknown> & { ok?: boolean; error?: string }) | null;
    if (!data || typeof data !== "object") return { ok: false, error: "network" };
    if (data.ok) return { ok: true, data: data as unknown as RoadsView };
    return { ok: false, error: KNOWN.has(String(data.error)) ? (data.error as RoadsError) : "network" };
  } catch {
    return { ok: false, error: "network" };
  }
};

const withSession = (session: string | null) => (session ? { session } : {});
export const fetchRoads = (session: string | null) => call({ action: "list", ...withSession(session) });
export const buyRoad = (session: string, road: string) => call({ action: "buy", session, road });
export const repairRoad = (session: string, road: string, pct?: number) => call({ action: "repair", session, road, ...(pct ? { pct } : {}) });
