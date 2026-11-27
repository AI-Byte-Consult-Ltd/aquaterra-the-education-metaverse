/*
 * First Light Realty (resident sales of any asset), sales of land to the state, and harvest barter.
 * Backend: n8n workflow "[74 PUBLIC] AquaTerra Agency" (POST /webhook/aquaterra-agency) hands each
 * request to the Postgres function aquaterra_agency() (server/agency/agency.sql). All rules live on the server.
 */
export const AGENCY_ENDPOINT = (import.meta.env.VITE_AGENCY_ENDPOINT as string | undefined) || "https://n8n.aibyteconsult.com/webhook/aquaterra-agency";

export const AGENCY_ERRORS = [
  "session", "not_found", "not_owner", "kind", "price", "listed", "too_many", "self", "gone", "insufficient", "plot_limit",
  "road_limit", "pledged", "auction", "field", "debt", "too_soon", "too_little", "crop", "units", "nothing", "action",
] as const;
export type AgencyError = (typeof AGENCY_ERRORS)[number] | "network";
const KNOWN = new Set<string>(AGENCY_ERRORS);

export type Result<T> = { ok: true; data: T; error?: undefined } | { ok: false; data?: undefined; error: AgencyError };

export type AssetKind = "plot" | "road" | "apartment" | "planet" | "companion";
export const ASSET_KINDS: AssetKind[] = ["plot", "road", "apartment", "planet", "companion"];

export interface AgencyLaws {
  feePct: number;
  salesTaxPct: number;
  dutyPct: number;
  statePct: number;
  holdDays: number;
  housePct: number;
  maxListings: number;
  maxPlots: number;
  maxRoads: number;
  barterTaxPct: number;
  maxOffers: number;
}
export interface Listing {
  id: number;
  kind: AssetKind;
  ref: string;
  title: string;
  place: string | null;
  price: number;
  seller: string;
  mine: boolean;
  at: string;
  registryPrice: number | null;
  duty: number;
}
export interface Asset {
  kind: AssetKind;
  ref: string;
  title: string;
  place: string | null;
  value?: number;
  pricePaid?: number;
  block?: "pledged" | "auction" | "field" | null;
  listing: number | null;
}
export interface Appraisal {
  plotId: number;
  address: string;
  pricePaid: number;
  registryPrice: number;
  landPct: number;
  housePct: number;
  land: number;
  house: number;
  gross: number;
  taxPct: number;
  tax: number;
  net: number;
  sellableAt: string;
  block: AgencyError | null;
}
export interface AgencyView {
  laws: AgencyLaws;
  listings: Listing[];
  sold?: { kind: AssetKind; title: string; price: number; at: string }[];
  assets?: Asset[];
  history?: { kind: AssetKind; title: string; price: number; fee: number; tax: number; side: "sold" | "bought"; at: string }[];
  balance?: number;
  free?: number;
  appraisal?: Appraisal;
}
export interface Offer {
  id: number;
  maker: string;
  mine: boolean;
  giveCrop: string;
  giveUnits: number;
  wantCrop: string;
  wantUnits: number;
  takerTax: number;
  at: string;
}
export interface BarterView {
  laws: AgencyLaws;
  offers: Offer[];
  free?: number;
  tax?: number;
}

async function call<T>(body: Record<string, unknown>): Promise<Result<T>> {
  try {
    const res = await fetch(AGENCY_ENDPOINT, {
      method: "POST",
      // text/plain keeps this a "simple" request: no CORS preflight.
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => null)) as (Record<string, unknown> & { ok?: boolean; error?: string }) | null;
    if (!data || typeof data !== "object") return { ok: false, error: "network" };
    if (data.ok) return { ok: true, data: data as unknown as T };
    return { ok: false, error: KNOWN.has(String(data.error)) ? (data.error as AgencyError) : "network" };
  } catch {
    return { ok: false, error: "network" };
  }
}

export const fetchListings = (session?: string | null, kind?: AssetKind) =>
  call<AgencyView>({ action: "list", ...(session ? { session } : {}), ...(kind ? { kind } : {}) });
export const fetchMine = (session: string) => call<AgencyView>({ action: "mine", session });
export const appraise = (session: string, plotId: number) => call<AgencyView>({ action: "appraise", session, plotId });
export const sellToState = (session: string, plotId: number) => call<AgencyView>({ action: "sell_state", session, plotId });
export const addListing = (session: string, kind: AssetKind, ref: string, price: number) =>
  call<AgencyView & { listingId: number }>({ action: "list_add", session, kind, ref, price });
export const cancelListing = (session: string, id: number) => call<AgencyView>({ action: "list_cancel", session, id });
export const buyListing = (session: string, id: number) => call<AgencyView & { price: number; duty: number }>({ action: "buy", session, id });

export const fetchBarter = (session?: string | null) => call<BarterView>({ action: "barter", ...(session ? { session } : {}) });
export const offerBarter = (session: string, give: string, giveUnits: number, want: string, wantUnits: number) =>
  call<BarterView>({ action: "barter_offer", session, give, giveUnits, want, wantUnits });
export const takeBarter = (session: string, id: number) => call<BarterView>({ action: "barter_take", session, id });
export const cancelBarter = (session: string, id: number) => call<BarterView>({ action: "barter_cancel", session, id });

/** What the seller keeps from a sale (same rounding as agency.sql). */
export const sellerGets = (price: number, l: AgencyLaws) =>
  price - Math.round((price * l.feePct) / 100) - Math.round((price * l.salesTaxPct) / 100);
