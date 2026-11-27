/*
 * City orders and workforce. Same backend as farms: n8n "[73 PUBLIC] AquaTerra Farm" hands the request to
 * aquaterra_farm(), which passes the actions city | deliver to aquaterra_city() (server/city/city.sql).
 */
import { FARM_ENDPOINT } from "@/game/farm/api";

export const ORDER_ERRORS = [
  "session", "not_found", "expired", "filled", "share", "cap", "nothing", "units", "too_little", "action",
] as const;
export type OrderError = (typeof ORDER_ERRORS)[number] | "network";
const KNOWN = new Set<string>(ORDER_ERRORS);
export type Result<T> = { ok: true; data: T; error?: undefined } | { ok: false; data?: undefined; error: OrderError };

export interface CityOrder {
  id: number;
  good: string;
  project: string;
  qty: number;
  delivered: number;
  /** Tide paid per unit */
  reward: number;
  price: number;
  suppliers: number;
  /** with a session: what I delivered, and what my storehouse has */
  mine: number | null;
  have: number | null;
}
export interface CityHome { plotId: number; address: string; kind: "starter" | "cottage" | "tower"; level: number; people: number }
export interface CityView {
  day: string;
  endsAt: string;
  orders: CityOrder[];
  past: { day: string; orders: number; filled: number; units: number; tide: number }[];
  laws: {
    bonusPct: number; sharePct: number; cap: number; pot: number; basePct: number; incomeTaxPct: number;
    homes: { starter: number; cottage: number; tower1: number; tower2: number; tower3: number };
  };
  jobs: Record<string, number>;
  city: { people: number; jobs: number };
  me?: {
    people: number;
    jobs: number;
    /** share of full output, 0..1 */
    output: number;
    homes: CityHome[];
    works: { kind: string; count: number; jobs: number }[];
    earnedToday: number;
  };
  delivered?: number;
  good?: string;
  tide?: number;
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
    return { ok: false, error: KNOWN.has(String(data.error)) ? (data.error as OrderError) : "network" };
  } catch {
    return { ok: false, error: "network" };
  }
}

export const fetchCity = (session?: string | null) => call<CityView>({ action: "city", ...(session ? { session } : {}) });
export const deliver = (session: string, orderId: number, units?: number) =>
  call<CityView>({ action: "deliver", session, orderId, ...(units !== undefined ? { units } : {}) });

/** What one resident may still deliver to an order, as aquaterra_city() counts it (before the daily cap). */
export function canDeliver(o: CityOrder, sharePct: number) {
  const share = Math.max(1, Math.ceil((o.qty * sharePct) / 100 - 1e-9));
  return Math.max(0, Math.min(o.have ?? 0, o.qty - o.delivered, share - (o.mine ?? 0)));
}
