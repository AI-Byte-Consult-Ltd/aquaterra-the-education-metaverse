/*
 * Buying Tide. Backend: n8n workflow "[68 PUBLIC] AquaTerra Exchange"
 * (POST /webhook/aquaterra-exchange), which hands each request to the Postgres
 * function aquaterra_exchange() (server/exchange/exchange.sql) and talks to
 * Revolut for card orders. Prices, limits, matching of payments and every
 * credit are decided by the server; this file only asks.
 */

export const EXCHANGE_ENDPOINT = (import.meta.env.VITE_EXCHANGE_ENDPOINT as string | undefined) || "https://n8n.aibyteconsult.com/webhook/aquaterra-exchange";

export type ExchangeError =
  | "session" | "disabled" | "pack" | "coin" | "limit" | "too_many" | "no_rate" | "busy" | "not_found" | "self"
  | "amount" | "price" | "address" | "insufficient" | "treasury_empty" | "provider" | "forbidden" | "param" | "action" | "network";
const KNOWN = new Set<ExchangeError>([
  "session", "disabled", "pack", "coin", "limit", "too_many", "no_rate", "busy", "not_found", "self",
  "amount", "price", "address", "insufficient", "treasury_empty", "provider", "forbidden", "param", "action",
]);

export type Result<T> = { ok: true; data: T; error?: undefined } | { ok: false; data?: undefined; error: ExchangeError };

export interface Pack {
  pack: number;
  tide: number;
  eurCents: number;
  usdtMicro: number;
  /** null while there is no fresh CRO price */
  croMicro: number | null;
}

export type OrderStatus = "pending" | "credited" | "expired" | "cancelled" | "failed";

export interface TideOrder {
  id: number;
  method: "card" | "usdt" | "cro";
  pack: number;
  tide: number;
  /** card: euro cents; usdt / cro: millionths of the coin */
  amount: number;
  currency: "EUR" | "USDT" | "CRO";
  payTo: string | null;
  status: OrderStatus;
  checkoutUrl: string | null;
  createdAt: string;
  expiresAt: string;
  txHash: string | null;
}

export interface MarketOffer {
  id: number;
  seller: string;
  mine: boolean;
  tide: number;
  /** millionths of USDT per 1 000 TIDE */
  priceMicro: number;
  createdAt: string;
}

export interface MarketTrade {
  id: number;
  offerId: number;
  tide: number;
  amount: number;
  payTo: string;
  status: "pending" | "paid" | "expired" | "cancelled";
  fee: number;
  /** true: I am the buyer */
  mine: boolean;
  seller: string;
  buyer: string;
  createdAt: string;
  expiresAt: string;
  txHash: string | null;
}

export interface Withdrawal {
  id: number;
  tide: number;
  fee: number;
  address: string;
  status: "queued" | "sent" | "failed";
  txHash: string | null;
  createdAt: string;
}

export interface ExchangeInfo {
  card: boolean;
  crypto: boolean;
  cro: boolean;
  croUsdMicro: number;
  market: boolean;
  token: boolean;
  marketFeeBp: number;
  marketMin: number;
  marketPayMinutes: number;
  tokenFeeBp: number;
  tokenMin: number;
  packs: Pack[];
  market_offers: MarketOffer[];
  /** signed in only */
  free?: number;
  orders?: TideOrder[];
  trades?: MarketTrade[];
  withdrawals?: Withdrawal[];
}

export interface ExchangeAdmin {
  params: Record<string, number>;
  settings: Record<string, string>;
  sold: {
    card: { orders: number; tide: number; eurCents: number };
    usdt: { orders: number; tide: number; micro: number };
    cro: { orders: number; tide: number; micro: number };
    market: { trades: number; tide: number; fees: number };
  };
  escrow: number;
  orders: (TideOrder & { who: string })[];
  unmatched: { tx: string; token: string; from: string | null; to: string; amount: string; seenAt: string }[];
  lastBlock: number | null;
}

const call = async <T>(body: Record<string, unknown>): Promise<Result<T>> => {
  try {
    const res = await fetch(EXCHANGE_ENDPOINT, {
      method: "POST",
      // text/plain keeps this a "simple" request: no CORS preflight.
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => null)) as (Record<string, unknown> & { ok?: boolean; error?: string }) | null;
    if (!data || typeof data !== "object") return { ok: false, error: "network" };
    if (data.ok) return { ok: true, data: data as T };
    return { ok: false, error: KNOWN.has(data.error as ExchangeError) ? (data.error as ExchangeError) : "network" };
  } catch {
    return { ok: false, error: "network" };
  }
};

export const fetchExchange = (session: string | null) => call<ExchangeInfo>({ action: "offers", session: session ?? "" });
export const buyByCard = (session: string, pack: number) => call<{ order: TideOrder }>({ action: "buy_card", session, pack });
export const fetchOrder = (session: string, id: number) => call<{ order: TideOrder }>({ action: "order", session, id });
export const buyByCrypto = (session: string, pack: number, coin: "usdt" | "cro") => call<{ order: TideOrder }>({ action: "buy_crypto", session, pack, coin });
export const cancelOrder = (session: string, id: number) => call<{ order: TideOrder }>({ action: "cancel", session, id });
export const sellOnMarket = (session: string, tide: number, priceMicro: number, address: string) =>
  call<{ offerId: number }>({ action: "market_sell", session, tide, priceMicro, address: address.trim() });
export const cancelOffer = (session: string, id: number) => call<{ returned: number }>({ action: "market_cancel", session, id });
export const buyOnMarket = (session: string, id: number, tide: number) => call<{ trade: MarketTrade }>({ action: "market_buy", session, id, tide });
export const dropTrade = (session: string, id: number) => call<Record<string, never>>({ action: "market_drop", session, id });
export const withdrawToken = (session: string, tide: number, address: string) =>
  call<{ tide: number; fee: number }>({ action: "withdraw", session, tide, address: address.trim() });

export const fetchExchangeAdmin = (session: string) => call<ExchangeAdmin>({ action: "admin", session });
export const setExchangeParam = (session: string, key: string, value: number) => call<ExchangeAdmin>({ action: "admin_param", session, key, value });
export const setExchangeSetting = (session: string, key: string, value: string) =>
  call<ExchangeAdmin>({ action: "admin_setting", session, key, value: value.trim() });

/** 5500123 millionths -> "5.500123" (exact, for copying into a wallet). */
export const micro = (n: number) => `${Math.floor(n / 1e6)}.${String(n % 1e6).padStart(6, "0")}`;
/** Same as the server: price of `tide` at `priceMicro` per 1 000, rounded up to whole cents (before the unique tail). */
export const marketCost = (tide: number, priceMicro: number) => Math.ceil((tide * priceMicro) / 1000 / 10000) * 10000;
export const isAddress = (s: string) => /^0x[0-9a-fA-F]{40}$/.test(s.trim());
