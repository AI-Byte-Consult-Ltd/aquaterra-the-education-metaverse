/*
 * Heritage Port: old AquaTerra NFTs come home as land or Tide. Backend: n8n workflow
 * "[71 PUBLIC] AquaTerra Heritage" (POST /webhook/aquaterra-heritage), which recovers wallet
 * signatures, asks the chain who owns a token, and hands every request to the Postgres
 * function aquaterra_heritage() (server/heritage/heritage.sql). This file only asks.
 */
export const HERITAGE_ENDPOINT = (import.meta.env.VITE_HERITAGE_ENDPOINT as string | undefined) || "https://n8n.aibyteconsult.com/webhook/aquaterra-heritage";

const ERRORS = [
  "session", "address", "not_linked", "already_mine", "linked_elsewhere", "too_many", "signature", "expired", "wallet_limit",
  "swap_open", "cell_taken", "closed", "collection", "chain_soon", "token", "choice", "no_wallet", "swapped", "reserve_empty", "plot_limit",
  "insufficient", "not_found", "not_open", "not_owner", "not_received", "chain", "forbidden", "district", "kind", "key", "amount", "action", "nothing",
] as const;
export type HeritageError = (typeof ERRORS)[number] | "network" | "no_wallet_app" | "rejected";
const KNOWN = new Set<string>(ERRORS);

export type Result<T> = { ok: true; data: T; error?: undefined } | { ok: false; data?: undefined; error: HeritageError };

export type ChainId = "cronos" | "polygon" | "ethereum" | "bitcoin";
export interface Chain { id: ChainId; name: string; family: "evm" | "btc"; chainId: number | null; explorer: string; enabled: boolean }
export type Kind = "land" | "house" | "car" | "asset" | "tower" | "planet";
export interface Collection { id: number; chain: ChainId; contract: string; name: string; kind: Kind; swapTide: number; allowPlot: boolean; note: string | null; enabled?: boolean; swapped?: number;
  /** Listed collections: only these tokens swap, each to its own item. */
  listed?: boolean; items?: ListedItem[] | null }
/** One listed token and what it becomes: an island of its own, an island with a villa, or Tide. */
export interface ListedItem { tokenId: string; title: string; gives: "island" | "house" | "tide" | "companion"; tide: number; tiles: number; place: string | null; taken: boolean; image?: string | null; about?: string | null }
/** An AI companion of mine: a NICS AI Agent swapped in. image is an IPFS CID. */
export interface Companion { token: string; name: string; pantheon: string | null; domain: string | null; image: string | null; since: string }
export const ipfsImage = (cid: string | null | undefined) => (cid ? `https://dweb.link/ipfs/${cid}` : null);
export type SwapStatus = "open" | "done" | "rejected" | "cancelled";
export interface Swap {
  id: number; collectionId: number; collection: string; chain: ChainId; contract: string; tokenId: string; choice: "plot" | "tide" | "apartment" | "planet" | "item";
  status: SwapStatus; fee: number; plotId: number | null; plotAddress: string | null; tide: number; reason: string | null;
  owner: string | null; createdAt: string; doneAt: string | null; resident?: string;
  apartment?: { tower: TowerId; towerName: string; floor: number; number: string; type: string } | null;
}
export type TowerId = "first-light" | "second-light";
/** An apartment of my own, with what it has earned so far. */
export interface MyApartment {
  tower: TowerId; towerName: string; tokenId: number; floor: number; number: string; type: string; view: string | null;
  area: number | null; bedrooms: number | null; rooms: number | null; image: string | null; rate: number; pending: number; ownedAt: string;
}
/** [token, floor, number, type, view, area, bedrooms, owner name or null, mine] */
export type ApartmentRow = [number, number, string, string, string | null, number | null, number | null, string | null, boolean];
export interface TowerView {
  tower: { id: TowerId; name: string; plotId: number | null; contract: string; collectionId: number; floors: number | null; lowest: number | null; owned: number; income: number };
  apartments: ApartmentRow[];
}
export interface HeritageInfo {
  open: boolean; fee: number; vault: string | null; district: string; reserve: number; swapped: number;
  chains: Chain[]; collections: Collection[];
}
export interface HeritageMe extends HeritageInfo {
  wallets: { family: "evm" | "btc"; address: string; linkedAt: string }[];
  swaps: Swap[];
  apartments: MyApartment[];
  companions?: Companion[];
  balance: number;
  /** Tide that may pay a swap fee (Tide received from swaps cannot). */
  feeFree: number;
}
export interface HeritageAdmin {
  vault: string | null; district: string; fee: number; open: boolean; reserve: number; wallets: number;
  chains: Chain[]; collections: Collection[]; swaps: Swap[];
}

async function call<T>(body: Record<string, unknown>): Promise<Result<T>> {
  try {
    const res = await fetch(HERITAGE_ENDPOINT, {
      method: "POST",
      // text/plain keeps this a "simple" request: no CORS preflight.
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => null)) as (Record<string, unknown> & { ok?: boolean; error?: string }) | null;
    if (!data || typeof data !== "object") return { ok: false, error: "network" };
    if (data.ok) return { ok: true, data: data as unknown as T };
    return { ok: false, error: KNOWN.has(String(data.error)) ? (data.error as HeritageError) : "network" };
  } catch {
    return { ok: false, error: "network" };
  }
}

export const fetchHeritageInfo = () => call<HeritageInfo>({ action: "info" });
export const fetchHeritageMe = (session: string) => call<HeritageMe>({ action: "me", session });
export const linkChallenge = (session: string, address: string) => call<{ message: string }>({ action: "link_challenge", session, address });
export const linkWallet = (session: string, message: string, signature: string) => call<{ address: string }>({ action: "link", session, message, signature });
export const unlinkWallet = (session: string, address: string) => call<{ address: string }>({ action: "unlink", session, address });
export const loginChallenge = (address: string) => call<{ message: string }>({ action: "login_challenge", address });
export const walletLogin = (message: string, signature: string) => call<{ session: string }>({ action: "wallet_login", message, signature });
export const startSwap = (session: string, collectionId: number, tokenId: string, choice: "plot" | "tide") =>
  call<{ swap: Swap }>({ action: "swap", session, collectionId, tokenId, choice });
export const confirmSwap = (session: string, swapId: number) => call<{ swap: Swap }>({ action: "confirm", session, swapId });
export const cancelSwap = (session: string, swapId: number) => call<{ swap: Swap }>({ action: "cancel", session, swapId });
export const fetchTower = (tower: TowerId, session?: string | null) => call<TowerView>({ action: "tower", tower, ...(session ? { session } : {}) });
export const collectApartments = (session: string) => call<{ gross: number; tax: number; net: number; balance: number }>({ action: "apt_collect", session });
export const heritageAdmin = (session: string, extra: Record<string, unknown> = {}) =>
  call<HeritageAdmin>({ action: "admin", session, ...extra });
