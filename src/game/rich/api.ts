/*
 * Richest residents of AquaTerra World. Public, no sign-in. Backend: the economy
 * webhook (action richlist) -> Postgres function aquaterra_richlist()
 * (server/richlist/richlist.sql). Only display names are returned, never emails.
 * Net worth = TIDE + land at the price paid + money put into buildings + bank deposit - open bank debt.
 */
import { ECONOMY_ENDPOINT } from "@/game/economy/api";

export interface RichResident {
  rank: number;
  name: string | null;
  founder: boolean;
  worth: number;
  tide: number;
  land: number;
  plots: number;
  build: number;
  buildings: number;
  deposit: number;
  debt: number;
}

export interface RichList {
  residents: RichResident[];
  total: number;
  at: string;
}

export async function fetchRichList(): Promise<RichList | null> {
  try {
    const res = await fetch(ECONOMY_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: JSON.stringify({ action: "richlist" }),
    });
    const d = (await res.json().catch(() => null)) as (RichList & { ok?: boolean }) | null;
    if (!d || !d.ok || !Array.isArray(d.residents)) return null;
    return { residents: d.residents, total: Number(d.total) || d.residents.length, at: String(d.at) };
  } catch {
    return null;
  }
}
