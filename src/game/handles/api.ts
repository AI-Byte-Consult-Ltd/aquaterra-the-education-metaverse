/*
 * AquaTerra @handles: every resident has a unique Latin handle (a-z, 0-9, _),
 * used to send Tide and shown next to names. Backend: n8n workflow
 * "[72 PUBLIC] AquaTerra Handles" (POST /webhook/aquaterra-handles), rules in
 * server/handles/handles.sql.
 */

export const HANDLES_ENDPOINT = "https://n8n.aibyteconsult.com/webhook/aquaterra-handles";

export type HandleError = "session" | "format" | "reserved" | "taken" | "too_soon" | "network";

export interface MyHandle {
  handle: string;
  /** true while the server made it from the name: the first own pick is free */
  auto: boolean;
  /** when the next change is allowed (null = now) */
  next: string | null;
}

export interface HandleMatch {
  handle: string;
  name: string;
}

type Result<T> = { ok: true; data: T; error?: undefined } | { ok: false; data?: undefined; error: HandleError; next?: string };
const KNOWN: HandleError[] = ["session", "format", "reserved", "taken", "too_soon"];

const call = async <T>(body: Record<string, string>): Promise<Result<T>> => {
  try {
    const res = await fetch(HANDLES_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => null)) as (Record<string, unknown> & { ok?: boolean; error?: string; next?: string }) | null;
    if (!data || typeof data !== "object") return { ok: false, error: "network" };
    if (data.ok) return { ok: true, data: data as T };
    return { ok: false, error: KNOWN.includes(data.error as HandleError) ? (data.error as HandleError) : "network", next: data.next };
  } catch {
    return { ok: false, error: "network" };
  }
};

/** Lower-case, without the leading @. */
export const normalizeHandle = (raw: string) => raw.trim().replace(/^@+/, "").toLowerCase();

/** 3–20 characters a-z, 0-9 and _, no _ at the ends and no double __. Reserved words are checked by the server. */
export const validHandle = (raw: string) => {
  const h = normalizeHandle(raw);
  return /^[a-z0-9_]{3,20}$/.test(h) && !/^_|_$|__/.test(h);
};

export const fetchMyHandle = (session: string) => call<MyHandle>({ action: "me", session });
export const checkHandle = (session: string, handle: string) => call<{ handle: string; free: boolean; mine?: boolean }>({ action: "check", session, handle: normalizeHandle(handle) });
export const setHandle = (session: string, handle: string) => call<MyHandle>({ action: "set", session, handle: normalizeHandle(handle) });
export const searchResidents = (session: string, q: string) => call<{ results: HandleMatch[] }>({ action: "search", session, q: q.trim() });
