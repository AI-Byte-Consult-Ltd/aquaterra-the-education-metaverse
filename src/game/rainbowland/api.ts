/*
 * Rainbowland API. Backend: n8n workflow "[72 PUBLIC] AquaTerra Rainbowland"
 * (POST /webhook/aquaterra-rainbowland) hands every request to the Postgres function
 * aquaterra_rainbow() (server/rainbowland/rainbowland.sql). This file only asks.
 */
import type { Tier } from "./grid";

export const RAINBOW_ENDPOINT = (import.meta.env.VITE_RAINBOW_ENDPOINT as string | undefined) || "https://n8n.aibyteconsult.com/webhook/aquaterra-rainbowland";

export type RainbowError = "session" | "token" | "action" | "network";
export type Result<T> = { ok: true; data: T; error?: undefined } | { ok: false; data?: undefined; error: RainbowError };

export interface TierRule { tier: Tier; label: string; code: string; tiles: number; price: number; subsoilPct: number }
export interface RainbowMap {
  cols: number;
  rows: number;
  total: number;
  /** One letter per token in token order: c r e l x (tier), ? not known yet. */
  tiles: string;
  tiers: TierRule[];
  /** [token, owner name, mine] for every LAND that came home. */
  claimed: [number, string, boolean][];
  swapFee: number | null;
}
export interface RainbowCell {
  token: number; x: number; y: number; rarity: string | null; oldDistrict: string | null;
  tier: Tier; tiles: number; price: number; subsoilPct: number;
  claimed: boolean; owner: string | null; mine: boolean; plotId: number | null; since: string | null;
}

async function call<T>(body: Record<string, unknown>): Promise<Result<T>> {
  try {
    const res = await fetch(RAINBOW_ENDPOINT, {
      method: "POST",
      // text/plain keeps this a "simple" request: no CORS preflight.
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => null)) as (Record<string, unknown> & { ok?: boolean; error?: string }) | null;
    if (!data || typeof data !== "object") return { ok: false, error: "network" };
    if (data.ok) return { ok: true, data: data as unknown as T };
    const e = String(data.error);
    return { ok: false, error: e === "session" || e === "token" || e === "action" ? e : "network" };
  } catch {
    return { ok: false, error: "network" };
  }
}

export const fetchRainbowMap = (session: string | null) => call<RainbowMap>({ action: "map", session: session ?? "" });
export const fetchRainbowCell = (token: number, session: string | null) => call<{ cell: RainbowCell }>({ action: "cell", token: String(token), session: session ?? "" });

/* Prism Hills (the Polygon LAND): same webhook, {land: "prism"}, Postgres aquaterra_prism(). */
export interface PrismMap { cols: number; rows: number; total: number; pricePerCell: number; claimed: [number, string, boolean][]; swapFee: number | null }
export interface PrismCell { token: number; x: number; y: number; tiles: number; price: number; claimed: boolean; owner: string | null; mine: boolean; plotId: number | null; since: string | null }
export const fetchPrismMap = (session: string | null) => call<PrismMap>({ land: "prism", action: "map", session: session ?? "" });
export const fetchPrismCell = (token: number, session: string | null) => call<{ cell: PrismCell }>({ land: "prism", action: "cell", token: String(token), session: session ?? "" });
