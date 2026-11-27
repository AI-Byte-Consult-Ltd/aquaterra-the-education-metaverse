/*
 * Farms and the Harvest Market. Backend: n8n workflow "[73 PUBLIC] AquaTerra Farm"
 * (POST /webhook/aquaterra-farm) hands each request to the Postgres function
 * aquaterra_farm() (server/farm/farm.sql). All rules live on the server.
 */
export const FARM_ENDPOINT = (import.meta.env.VITE_FARM_ENDPOINT as string | undefined) || "https://n8n.aibyteconsult.com/webhook/aquaterra-farm";

export const FARM_ERRORS = [
  "session", "not_found", "not_owner", "crop", "land", "building", "planted", "not_ripe", "insufficient",
  "nothing", "units", "too_little", "cap", "side", "price", "too_many", "place", "action",
] as const;
export type FarmError = (typeof FARM_ERRORS)[number] | "network";
const KNOWN = new Set<string>(FARM_ERRORS);

export type Result<T> = { ok: true; data: T; error?: undefined } | { ok: false; data?: undefined; error: FarmError };

export type CropGroup = "flowers" | "fruit" | "vegetables" | "grain" | "plantation" | "sea";
export interface Crop {
  key: string;
  group: CropGroup;
  /** grows on water plots (sea farm) instead of land */
  water: boolean;
  hours: number;
  seedPerTile: number;
  yieldPerTile: number;
  price: number;
  bid: number | null;
  ask: number | null;
  last: number | null;
  volume: number;
}
export interface FarmLaws {
  marketTaxPct: number;
  reserveCap: number;
  wiltHours: number;
  maxOrders: number;
  incomeTaxPct: number;
}
export interface Market {
  crops: Crop[];
  laws: FarmLaws;
  fields: number;
  farmers: number;
}
export interface Field {
  crop: string;
  units: number;
  plantedAt: string;
  readyAt: string;
  wiltsAt: string;
}
export interface FarmPlot {
  plotId: number;
  address: string;
  district: string;
  tiles: number;
  water: boolean;
  block: "land" | "building" | null;
  field: Field | null;
}
export interface Order {
  id: number;
  side: "buy" | "sell";
  crop: string;
  price: number;
  qty: number;
  left: number;
  at: string;
}
export interface MyFarm extends Market {
  plots: FarmPlot[];
  barn: { crop: string; units: number; price: number; value: number }[];
  orders: Order[];
  log: { kind: "plant" | "harvest" | "clear" | "reserve" | "buy" | "sell" | "barter"; crop: string; units: number; tide: number; at: string }[];
  reserveToday: number;
  balance: number;
  free: number;
  seed?: number;
  harvested?: number;
  destroyed?: number;
  units?: number;
  sold?: number;
  tide?: number;
  fills?: number;
  status?: "open" | "done" | "cancelled";
  book?: Book;
}
/** price levels [price, units]; trades [price, units, at] */
export interface Book {
  crop: string;
  asks: [number, number][];
  bids: [number, number][];
  trades: [number, number, string][];
}

async function call<T>(body: Record<string, unknown>): Promise<Result<T>> {
  try {
    const res = await fetch(FARM_ENDPOINT, {
      method: "POST",
      // text/plain keeps this a "simple" request: no CORS preflight.
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => null)) as (Record<string, unknown> & { ok?: boolean; error?: string }) | null;
    if (!data || typeof data !== "object") return { ok: false, error: "network" };
    if (data.ok) return { ok: true, data: data as unknown as T };
    return { ok: false, error: KNOWN.has(String(data.error)) ? (data.error as FarmError) : "network" };
  } catch {
    return { ok: false, error: "network" };
  }
}

export const fetchMarket = () => call<Market>({ action: "market" });
/** Public: what grows where, for the world map. Each row is [plotId, crop, planted, ripe] in unix seconds. */
export const fetchFields = () => call<{ fields: [number, string, number, number][]; wiltHours: number; now: number }>({ action: "fields" });
export const fetchBook = (crop: string) => call<{ book: Book }>({ action: "book", crop });
export const fetchMyFarm = (session: string) => call<MyFarm>({ action: "me", session });
export const plant = (session: string, plotId: number, crop: string) => call<MyFarm>({ action: "plant", session, plotId, crop });
export const harvest = (session: string, plotId?: number) => call<MyFarm>({ action: "harvest", session, ...(plotId !== undefined ? { plotId } : {}) });
export const clearField = (session: string, plotId: number) => call<MyFarm>({ action: "clear", session, plotId });
export const sellToReserve = (session: string, crop: string, units?: number) => call<MyFarm>({ action: "reserve", session, crop, ...(units ? { units } : {}) });
export const placeOrder = (session: string, side: "buy" | "sell", crop: string, price: string, qty: number) =>
  call<MyFarm>({ action: "order", session, side, crop, price, qty });
export const cancelOrder = (session: string, orderId: number) => call<MyFarm>({ action: "cancel", session, orderId });

/** What the server will charge and give for a crop on a plot (same rounding as farm.sql). */
export const seedCost = (c: Crop, tiles: number) => Math.max(1, Math.ceil(c.seedPerTile * tiles - 1e-9));
export const cropYield = (c: Crop, tiles: number) => Math.max(1, Math.floor(c.yieldPerTile * tiles + 1e-9));
