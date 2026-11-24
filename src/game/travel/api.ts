/*
 * Travel in AquaTerra World. Backend: n8n workflow "[66 PUBLIC] AquaTerra Travel"
 * (POST /webhook/aquaterra-travel), which hands each request to the Postgres
 * function aquaterra_travel() (server/travel/travel.sql). Where a resident
 * stands, which routes exist, every fare and tax are decided there; this file only asks.
 */
import type { FareParams, HubKind, Mode, Route, TransitMode } from "./network";

export const TRAVEL_ENDPOINT = (import.meta.env.VITE_TRAVEL_ENDPOINT as string | undefined) || "https://n8n.aibyteconsult.com/webhook/aquaterra-travel";

export type TravelError = "session" | "route" | "not_here" | "insufficient" | "taken" | "not_found" | "hub_limit" | "forbidden" | "param" | "amount" | "action" | "network";
const KNOWN = new Set<TravelError>(["session", "route", "not_here", "insufficient", "taken", "not_found", "hub_limit", "forbidden", "param", "amount", "action"]);

export type Result<T> = { ok: true; data: T; error?: undefined } | { ok: false; data?: undefined; error: TravelError };

export interface Location {
  districtId: number;
  district: string | null;
  /** "centre", "plot" or "hub:station:16". */
  spot: string;
  plotId: number | null;
  x: number;
  y: number;
  trips: number;
  since: string;
}

export interface HubInfo {
  id: string;
  kind: HubKind;
  district: number;
  name: string;
  x: number;
  y: number;
  price: number;
  owner: string | null;
  mine: boolean;
  trips: number;
  revenue: number;
}

export interface NetworkInfo {
  fares: FareParams;
  prices: Record<"price_station" | "price_port" | "price_airport" | "max_hubs_per_citizen", number>;
  taxPct: number;
  hubs: HubInfo[];
  routes: [TransitMode, number, number, number][];
  /** Residents standing in each district (by id), counts only. */
  here: Record<string, number>;
  me?: Location | null;
}

export interface TripLeg {
  mode: Mode;
  from?: number;
  to: number;
  plot?: number | null;
  dist?: number;
  fare: number;
  tax: number;
  operator?: string;
}

export interface TripResult {
  me: Location;
  legs: TripLeg[];
  fare: number;
  tax: number;
  balance: number;
}

export interface TravelAdmin {
  params: Record<string, number>;
  taxPct: number;
  trips: number;
  trips24h: number;
  fares: number;
  taxes: number;
  travellers: number;
  hubs: { id: string; name: string; kind: HubKind; price: number; owner: string | null; trips: number; revenue: number }[];
}

const call = async <T>(body: Record<string, unknown>): Promise<Result<T>> => {
  try {
    const res = await fetch(TRAVEL_ENDPOINT, {
      method: "POST",
      // text/plain keeps this a "simple" request: no CORS preflight.
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => null)) as (Record<string, unknown> & { ok?: boolean; error?: string }) | null;
    if (!data || typeof data !== "object") return { ok: false, error: "network" };
    if (data.ok) return { ok: true, data: data as T };
    return { ok: false, error: KNOWN.has(data.error as TravelError) ? (data.error as TravelError) : "network" };
  } catch {
    return { ok: false, error: "network" };
  }
};

export const fetchNetwork = (session: string | null) => call<NetworkInfo>({ action: "network", session: session ?? "" });
export const fetchWhere = (session: string) => call<{ me: Location; balance: number }>({ action: "where", session });
export const travel = (session: string, legs: { mode: Mode; to?: number; plot?: number | null }[]) => call<TripResult>({ action: "go", session, legs });
export const buyHub = (session: string, hub: string) => call<{ hub: string; price: number }>({ action: "buy_hub", session, hub });
export const fetchTravelAdmin = (session: string) => call<TravelAdmin>({ action: "admin", session });
export const setTravelParam = (session: string, key: string, value: number) => call<TravelAdmin>({ action: "admin_param", session, key, value });

export const toRoutes = (net: NetworkInfo | null): Route[] => (net?.routes ?? []).map(([mode, a, b, dist]) => ({ mode, a, b, dist }));
