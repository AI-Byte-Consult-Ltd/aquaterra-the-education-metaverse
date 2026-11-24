/*
 * AquaTerra Tide economy. Backend: n8n workflow "[64 PUBLIC] AquaTerra Economy"
 * (POST /webhook/aquaterra-economy). Every rule (prices, balances, income,
 * limits) is checked by the server; this file only asks.
 */

export const ECONOMY_ENDPOINT = "https://n8n.aibyteconsult.com/webhook/aquaterra-economy";

export type EconomyError =
  | "session"
  | "insufficient"
  | "taken"
  | "not_for_sale"
  | "not_here"
  | "plot_limit"
  | "no_citizen"
  | "ambiguous"
  | "self"
  | "amount"
  | "nothing_to_claim"
  | "treasury_empty"
  | "forbidden"
  | "param"
  | "network";

const KNOWN: EconomyError[] = [
  "session", "insufficient", "taken", "not_for_sale", "not_here", "plot_limit", "no_citizen", "ambiguous", "self",
  "amount", "nothing_to_claim", "treasury_empty", "forbidden", "param",
];

export type Result<T> = { ok: true; data: T; error?: undefined } | { ok: false; data?: undefined; error: EconomyError };

export interface OwnedPlot {
  id: number;
  address: string;
  district: string;
  pricePaid: number;
  boughtAt: string;
  pending: number;
}

export type LedgerKind = "genesis" | "welcome" | "plot_purchase" | "transfer" | "fee" | "tax" | "income" | "grant" | "state" | "fare" | "hub_purchase";

export interface HistoryEntry {
  id: number;
  at: string;
  kind: LedgerKind;
  /** Positive: received. Negative: paid. */
  amount: number;
  counterparty: string | null;
  plotId: number | null;
  memo: string | null;
}

export interface Wallet {
  balance: number;
  /** Welcome coins not yet spent on land: they cannot be sent to others. */
  locked: number;
  welcomed: boolean;
  plots: OwnedPlot[];
  history: HistoryEntry[];
  /** Public rules of the economy, as the server applies them now. */
  params?: Partial<EconomyParams>;
}

export interface LandInfo {
  catalog: number;
  /** [plot id, owner's citizen name, is it mine] */
  owned: [number, string, boolean][];
}

export type EconomyParams = Record<
  "genesis_supply" | "welcome_grant" | "income_bp_per_day" | "income_cap_days" | "transfer_fee_bp" | "max_plots_per_citizen" | "max_grant",
  number
>;

export interface AdminLedgerEntry {
  id: number;
  at: string;
  kind: LedgerKind;
  from: string | null;
  to: string | null;
  amount: number;
  plotId: number | null;
  memo: string | null;
}

export interface EconomyOverview {
  treasury: number;
  stateTreasury: number;
  supply: number;
  genesis: number;
  wallets: number;
  catalog: number;
  plotsSold: number;
  landSales: number;
  params: EconomyParams;
  holders: { email: string; name: string; balance: number; plots: number }[];
  ledger: AdminLedgerEntry[];
}

const call = async <T>(body: Record<string, unknown>): Promise<Result<T>> => {
  try {
    const res = await fetch(ECONOMY_ENDPOINT, {
      method: "POST",
      // text/plain keeps this a "simple" request: no CORS preflight.
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => null)) as (Record<string, unknown> & { ok?: boolean; error?: string }) | null;
    if (!data || typeof data !== "object") return { ok: false, error: "network" };
    if (data.ok) return { ok: true, data: data as T };
    return { ok: false, error: KNOWN.includes(data.error as EconomyError) ? (data.error as EconomyError) : "network" };
  } catch {
    return { ok: false, error: "network" };
  }
};

export const fetchLand = (session: string | null) => call<LandInfo>({ action: "land", session: session ?? "" });
export const fetchWallet = (session: string) => call<Wallet>({ action: "wallet", session });
export const buyPlot = (session: string, plotId: number) => call<{ plotId: number; price: number }>({ action: "buy", session, plotId });
export const sendTide = (session: string, to: string, amount: number, memo: string) =>
  call<{ amount: number; fee: number; to: string }>({ action: "transfer", session, to: to.trim(), amount, memo: memo.trim() });
export const claimIncome = (session: string) => call<{ amount: number }>({ action: "claim", session });

export const fetchOverview = (session: string) => call<EconomyOverview>({ action: "admin", session });
export const grantTide = (session: string, to: string, amount: number, memo: string) =>
  call<EconomyOverview>({ action: "admin_grant", session, to: to.trim(), amount, memo: memo.trim() });
export const setParam = (session: string, key: keyof EconomyParams, value: number) =>
  call<EconomyOverview>({ action: "admin_param", session, key, value });

/** Transfer fee the server will add, from its basis-point rate (minimum 1 TIDE). */
export const transferFee = (amount: number, feeBp: number) => (feeBp > 0 && amount > 0 ? Math.max(1, Math.floor((amount * feeBp) / 10000)) : 0);

/** Same rule as the server (1% of the price a day by default, stops after the cap). */
export const dailyIncome = (price: number, bpPerDay = 100) => Math.floor((price * bpPerDay) / 10000);
