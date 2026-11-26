/*
 * Orbit, the sky layer above AquaTerra. Backend: n8n workflow "[72 PUBLIC] AquaTerra Orbit"
 * (POST /webhook/aquaterra-orbit) hands each request to the Postgres function
 * aquaterra_orbit() (server/orbit/orbit.sql). Claims come home through the Heritage Port.
 */
export const ORBIT_ENDPOINT = (import.meta.env.VITE_ORBIT_ENDPOINT as string | undefined) || "https://n8n.aibyteconsult.com/webhook/aquaterra-orbit";

export type OrbitError = "session" | "not_found" | "mined_today" | "no_claims" | "nothing" | "units" | "too_little" | "action" | "network";
const KNOWN = new Set<string>(["session", "not_found", "mined_today", "no_claims", "nothing", "units", "too_little", "action"]);

export type Result<T> = { ok: true; data: T; error?: undefined } | { ok: false; data?: undefined; error: OrbitError };

/** [name, type, orbits, claims, owned, resources, top rarity 1..6, image] */
export type BodyRow = [string, string, string, number, number, string[], number, string | null];

export interface Sky {
  bodies: BodyRow[];
  total: number;
  owned: number;
  miners: number;
  mineUnits: number;
  collectionId: number | null;
}

/** [token, resource, rarity, owner name or null, mine] */
export type ClaimRow = [number, string, string, string | null, boolean];
export interface BodyView {
  name: string;
  claims: ClaimRow[];
  resources: { resource: string; claims: number; price: number }[];
}

export interface Claim {
  tokenId: number;
  name: string;
  type: string;
  orbits: string;
  resource: string;
  rarity: string;
  image: string | null;
  units: number;
  price: number;
  minedToday: boolean;
}
export interface Hold {
  resource: string;
  units: number;
  price: number;
  value: number;
}
export interface MyOrbit {
  claims: Claim[];
  hold: Hold[];
  log: { kind: "mine" | "sell"; resource: string; units: number; tide: number; at: string }[];
  balance: number;
  resetsAt: string;
  mined?: number;
  sold?: number;
  tide?: number;
  taxPct?: number;
}

async function call<T>(body: Record<string, unknown>): Promise<Result<T>> {
  try {
    const res = await fetch(ORBIT_ENDPOINT, {
      method: "POST",
      // text/plain keeps this a "simple" request: no CORS preflight.
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => null)) as (Record<string, unknown> & { ok?: boolean; error?: string }) | null;
    if (!data || typeof data !== "object") return { ok: false, error: "network" };
    if (data.ok) return { ok: true, data: data as unknown as T };
    return { ok: false, error: KNOWN.has(String(data.error)) ? (data.error as OrbitError) : "network" };
  } catch {
    return { ok: false, error: "network" };
  }
}

export const fetchSky = () => call<Sky>({ action: "sky" });
export const fetchBody = (name: string, session: string | null) => call<BodyView>({ action: "body", name, ...(session ? { session } : {}) });
export const fetchMyOrbit = (session: string) => call<MyOrbit>({ action: "me", session });
export const mineAll = (session: string) => call<MyOrbit>({ action: "mine", session });
export const sellResource = (session: string, resource: string, units?: number) =>
  call<MyOrbit>({ action: "sell", session, resource, ...(units ? { units } : {}) });

/** ipfs://cid/file → a public gateway URL. */
export const ipfsUrl = (u: string | null | undefined) =>
  !u ? null : u.startsWith("ipfs://") ? "https://gateway.pinata.cloud/ipfs/" + u.slice(7).split("/").map(encodeURIComponent).join("/") : u;
