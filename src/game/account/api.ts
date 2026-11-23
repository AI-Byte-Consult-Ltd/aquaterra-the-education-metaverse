/*
 * AquaTerra World account: sign in with a one-time code sent to the email,
 * then a 180-day session kept in this browser. Backend: n8n workflow
 * "[62 PUBLIC] AquaTerra Account" (POST /webhook/aquaterra-account). The
 * server keeps only a hash of the session and of each code.
 */

export const ACCOUNT_ENDPOINT = "https://n8n.aibyteconsult.com/webhook/aquaterra-account";
const STORAGE_KEY = "aquaterra-account";

export interface Player {
  email: string;
  displayName: string | null;
  createdAt: string | null;
}

export interface StoredAccount {
  session: string;
  player: Player;
}

export type AccountError =
  | "email"
  | "code"
  | "wrong_code"
  | "too_many"
  | "mail_unavailable"
  | "session"
  | "name"
  | "network";

export type Result<T> = { ok: true; data: T; error?: undefined } | { ok: false; data?: undefined; error: AccountError };

const KNOWN: AccountError[] = ["email", "code", "wrong_code", "too_many", "mail_unavailable", "session", "name"];

const call = async <T>(body: Record<string, string>): Promise<Result<T>> => {
  try {
    const res = await fetch(ACCOUNT_ENDPOINT, {
      method: "POST",
      // text/plain keeps this a "simple" request: no CORS preflight.
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => null)) as (Record<string, unknown> & { ok?: boolean; error?: string }) | null;
    if (!data || typeof data !== "object") return { ok: false, error: "network" };
    if (data.ok) return { ok: true, data: data as T };
    const error = KNOWN.includes(data.error as AccountError) ? (data.error as AccountError) : "network";
    return { ok: false, error };
  } catch {
    return { ok: false, error: "network" };
  }
};

export const validEmail = (email: string) => /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,24}$/i.test(email.trim());

/** 3–24 characters: letters, digits, space, dot, dash, underscore; starts and ends with a letter or digit. */
export const validDisplayName = (name: string) => /^[A-Za-z0-9][A-Za-z0-9 ._-]{1,22}[A-Za-z0-9]$/.test(name.replace(/\s+/g, " ").trim());

const normalize = (email: string) => email.trim().toLowerCase();

export const requestCode = (email: string) => call<{ ok: true }>({ action: "send_code", email: normalize(email) });

export const verifyCode = (email: string, code: string) =>
  call<{ session: string; player: Player }>({ action: "verify", email: normalize(email), code: code.replace(/\D/g, "") });

export const fetchMe = (session: string) => call<{ player: Player }>({ action: "me", session });

export const saveDisplayName = (session: string, displayName: string) =>
  call<{ player: Player }>({ action: "profile", session, displayName: displayName.replace(/\s+/g, " ").trim() });

export const endSession = (session: string) => call<{ ok: true }>({ action: "logout", session });

export const readStored = (): StoredAccount | null => {
  try {
    const a = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null") as StoredAccount | null;
    return a && typeof a.session === "string" && /^[a-f0-9]{64}$/.test(a.session) && a.player?.email ? a : null;
  } catch {
    return null;
  }
};

export const writeStored = (a: StoredAccount | null) => {
  try {
    if (a) localStorage.setItem(STORAGE_KEY, JSON.stringify(a));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage blocked: the player signs in again next visit */
  }
};

export const STORAGE_EVENT_KEY = STORAGE_KEY;

/** Only same-site paths are allowed as a return address after sign-in. */
export const safeNext = (raw: string | null, fallback = "/world") =>
  raw && raw.startsWith("/") && !raw.startsWith("//") && !raw.startsWith("/login") ? raw : fallback;
