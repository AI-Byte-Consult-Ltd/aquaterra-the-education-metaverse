/*
 * Public finance of the Commonwealth and the Bank of First Light. Backend: n8n
 * workflow "[68 PUBLIC] AquaTerra Bank" (POST /webhook/aquaterra-bank), which
 * hands each request to the Postgres function aquaterra_bank()
 * (server/treasury/treasury.sql). Salaries, taxes, debts, auctions and interest
 * are run by the server; this file only asks and shows.
 */
import { useEffect, useState } from "react";

export const BANK_ENDPOINT = (import.meta.env.VITE_BANK_ENDPOINT as string | undefined) || "https://n8n.aibyteconsult.com/webhook/aquaterra-bank";

export type BankError =
  | "session" | "forbidden" | "insufficient" | "amount" | "not_owner" | "pledged" | "auction" | "debt" | "too_much" | "days" | "bank_short"
  | "not_found" | "closed" | "self" | "low_bid" | "plot_limit" | "no_citizen" | "reason" | "action" | "network";

const KNOWN = new Set<string>([
  "session", "forbidden", "insufficient", "amount", "not_owner", "pledged", "auction", "debt", "too_much", "days", "bank_short", "not_found",
  "closed", "self", "low_bid", "plot_limit", "no_citizen", "reason", "action",
]);

export type Result<T> = { ok: true; data: T; error?: undefined } | { ok: false; data?: undefined; error: BankError };

/** The laws of public finance in force (keys of aquaterra_gov_params). */
export type Laws = Partial<Record<
  | "income_tax_pct" | "salary_council" | "salary_directorate" | "salary_assembly" | "salary_mayor" | "salary_nics_ai" | "land_tax_week_bp"
  | "land_tax_free_plots" | "debt_grace_days" | "debt_penalty_pct" | "debt_auction_days" | "auction_hours" | "deal_duty_pct" | "fine_max"
  | "civic_bonus" | "deposit_rate_pct" | "loan_rate_pct" | "loan_ltv_pct" | "loan_repay_pct" | "loan_max_days" | "mortgage_pct"
  | "sales_tax_pct" | "travel_tax_pct" | "arcade_prize_tax_pct" | "rent_tax_pct" | "arcade_entry_tax_pct",
  number
>>;

export const DEFAULT_LAWS: Required<Pick<Laws, "income_tax_pct" | "deal_duty_pct" | "land_tax_week_bp" | "land_tax_free_plots">> = {
  income_tax_pct: 10, deal_duty_pct: 2, land_tax_week_bp: 20, land_tax_free_plots: 1,
};

export interface Loan {
  id: number;
  kind: "founder" | "pledge" | "mortgage";
  principal: number;
  outstanding: number;
  repaid: number;
  ratePct: number;
  repayPct: number;
  openedAt: string;
  dueAt: string;
  status: "open" | "repaid" | "defaulted";
  note: string | null;
  plotId: number | null;
  plot: string | null;
  borrower: string;
}

export interface Auction {
  id: number;
  plotId: number;
  address: string;
  district: string;
  price: number;
  reason: "land_tax" | "loan";
  minBid: number;
  bestBid: number | null;
  bestBidder: string | null;
  bids: number;
  endsAt: string;
  status: string;
  seller: string;
}

export interface Overview {
  laws: Laws;
  bank: { reserves: number; deposits: number; lent: number; loans: number; savers: number };
  treasury: number;
  nicsFund: number;
  founderLoan: Loan | null;
  payroll: { day: string; total: number; paid: number; unpaid: number }[];
  landTax: { week: string; total: number; paid: number; unpaid: number } | null;
  auctions: Auction[];
  income30: { incomeTax: number; landTax: number; duty: number; fines: number; otherTax: number; salaries: number; bonuses: number };
}

export interface Debt {
  id: number;
  kind: "land_tax" | "fine";
  amount: number;
  paid: number;
  reason: string;
  createdAt: string;
  status: "open" | "auction";
  penalized: boolean;
}

export interface Notice {
  id: number;
  at: string;
  kind: string;
  text: string;
  read: boolean;
}

export interface MyPlot {
  id: number;
  address: string;
  pricePaid: number;
  taxFree: boolean;
  weeklyTax: number;
  pledged: boolean;
  auction: boolean;
  maxLoan: number;
}

export interface Me {
  balance: number;
  free: number;
  deposit: { principal: number; interestPaid: number };
  loans: Loan[];
  debts: Debt[];
  notices: Notice[];
  office: { office: "council" | "directorate" | "assembly" | "mayor"; salary: number } | null;
  plots: MyPlot[];
  votedThisMonth: boolean;
  lastBonus: string | null;
  myBids: number[];
}

export interface AdminView {
  debts: (Omit<Debt, "penalized"> & { citizen: string })[];
  loans: Loan[];
  officials: { citizen: string; office: string; salary: number }[];
}

const call = async <T>(body: Record<string, unknown>): Promise<Result<T>> => {
  try {
    const res = await fetch(BANK_ENDPOINT, {
      method: "POST",
      // text/plain keeps this a "simple" request: no CORS preflight.
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => null)) as (Record<string, unknown> & { ok?: boolean; error?: string }) | null;
    if (!data || typeof data !== "object") return { ok: false, error: "network" };
    if (data.ok) return { ok: true, data: data as T };
    return { ok: false, error: KNOWN.has(String(data.error)) ? (data.error as BankError) : "network" };
  } catch {
    return { ok: false, error: "network" };
  }
};

type WithMe<T = object> = T & { me: Me };

export const fetchOverview = () => call<Overview>({ action: "overview" });
export const fetchMe = (session: string) => call<Me>({ action: "me", session });
export const deposit = (session: string, amount: number) => call<WithMe>({ action: "deposit", session, amount });
export const withdraw = (session: string, amount: number) => call<WithMe>({ action: "withdraw", session, amount });
export const borrow = (session: string, plotId: number, amount: number, days: number) =>
  call<WithMe<{ loanId: number }>>({ action: "borrow", session, plotId, amount, days });
export const repay = (session: string, loanId: number, amount?: number) => call<WithMe>({ action: "repay", session, loanId, amount });
export const payDebts = (session: string) => call<WithMe<{ paid: number }>>({ action: "pay_debts", session });
export const bid = (session: string, auctionId: number, amount: number) => call<WithMe>({ action: "bid", session, auctionId, amount });
export const readNotices = (session: string) => call<WithMe>({ action: "read_notices", session });
export const fine = (session: string, to: string, amount: number, reason: string) =>
  call<WithMe<{ paid: number }>>({ action: "fine", session, to: to.trim(), amount, reason: reason.trim() });
export const fetchAdmin = (session: string) => call<WithMe<AdminView>>({ action: "admin", session });

/** The duty the server adds to a plot deal (at least 1 TIDE). */
export const dealDuty = (price: number, pct: number) => (pct > 0 && price > 0 ? Math.max(1, Math.round((price * pct) / 100)) : 0);
/** Smallest bid the server accepts now. */
export const minBid = (a: Auction) => Math.max(a.minBid, a.bestBid === null ? 0 : a.bestBid + Math.max(1, Math.ceil(a.bestBid * 0.01)));

let lawsCache: Laws | null = null;
let lawsPromise: Promise<Laws | null> | null = null;
/** The laws in force, fetched once per page load. Null until they arrive (or when offline). */
export function useLaws(): Laws | null {
  const [laws, setLaws] = useState<Laws | null>(lawsCache);
  useEffect(() => {
    if (lawsCache) return;
    lawsPromise ??= fetchOverview().then((r) => (r.ok ? (lawsCache = r.data.laws) : null));
    let alive = true;
    void lawsPromise.then((l) => alive && l && setLaws(l));
    return () => {
      alive = false;
    };
  }, []);
  return laws;
}
