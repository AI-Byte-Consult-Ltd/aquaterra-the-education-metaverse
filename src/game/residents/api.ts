/*
 * Avatars and the residents on the map. Backend: n8n workflow
 * "[71 PUBLIC] AquaTerra Residents" (POST /webhook/aquaterra-residents), which
 * hands each request to the Postgres function aquaterra_residents()
 * (server/residents/residents.sql). Only real residents are returned, never emails.
 */
import { isStyle, type Avatar, type AvatarStyle } from "./avatars";

export const RESIDENTS_ENDPOINT =
  (import.meta.env.VITE_RESIDENTS_ENDPOINT as string | undefined) || "https://n8n.aibyteconsult.com/webhook/aquaterra-residents";

export type ResidentsError = "session" | "style" | "hue" | "action" | "network";
const KNOWN = new Set<ResidentsError>(["session", "style", "hue", "action"]);
export type Result<T> = { ok: true; data: T; error?: undefined } | { ok: false; data?: undefined; error: ResidentsError };

export interface MyAvatar {
  /** null until the resident picks one: shown as the drop. */
  style: AvatarStyle | null;
  hue: number | null;
  visible: boolean;
}

export interface Resident {
  key: string;
  name: string;
  style: AvatarStyle;
  hue: number | null;
  x: number;
  y: number;
  district: number;
  online: boolean;
  council: boolean;
  /** Name of their AI companion (a NICS AI Agent), if any. */
  companion?: string | null;
}

export interface ResidentsMap {
  residents: Resident[];
  online: number;
  recent: number;
  avatar: MyAvatar;
  /** My AI companion, if any. */
  companion?: string | null;
}

const call = async <T>(body: Record<string, unknown>): Promise<Result<T>> => {
  try {
    const res = await fetch(RESIDENTS_ENDPOINT, {
      method: "POST",
      // text/plain keeps this a "simple" request: no CORS preflight.
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => null)) as (Record<string, unknown> & { ok?: boolean; error?: string }) | null;
    if (!data || typeof data !== "object") return { ok: false, error: "network" };
    if (data.ok) return { ok: true, data: data as T };
    return { ok: false, error: KNOWN.has(data.error as ResidentsError) ? (data.error as ResidentsError) : "network" };
  } catch {
    return { ok: false, error: "network" };
  }
};

export const fetchMyAvatar = (session: string) => call<{ avatar: MyAvatar }>({ action: "me", session });
export const saveAvatar = (session: string, a: Avatar, visible: boolean) =>
  call<{ avatar: MyAvatar }>({ action: "set_avatar", session, style: a.style, hue: a.hue, visible });
export const fetchResidents = (session: string) => call<ResidentsMap>({ action: "map", session });

/** The avatar to draw: a resident who has not picked one is the drop in their own colour. */
export const avatarOf = (a: { style: string | null; hue: number | null } | null | undefined, fallbackHue: number): Avatar => ({
  style: a && isStyle(a.style) ? a.style : "drop",
  hue: a && typeof a.hue === "number" ? a.hue : fallbackHue,
});

const CACHE = "aquaterra-avatar";
export const readCachedAvatar = (email: string): MyAvatar | null => {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE) || "null") as { email: string; avatar: MyAvatar } | null;
    return c && c.email === email ? c.avatar : null;
  } catch {
    return null;
  }
};
export const writeCachedAvatar = (email: string, avatar: MyAvatar) => {
  try {
    localStorage.setItem(CACHE, JSON.stringify({ email, avatar }));
  } catch {
    /* private window: fine */
  }
};
