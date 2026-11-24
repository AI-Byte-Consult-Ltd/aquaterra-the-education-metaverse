/*
 * NICS AI dialog backend: n8n "[66 PUBLIC] AquaTerra NICS Dialog"
 * (POST /webhook/aquaterra-nics), which hands each request to the Postgres
 * function aquaterra_nics() (server/nics/nics.sql).
 *
 * Live answers from NICS Language go through a queue on the server: the game
 * key lives only there, never in this bundle. The browser asks, then polls
 * for the answer; after ANSWER_WAIT_MS it keeps the prepared phrase.
 * The switch is the server's `queue_enabled` setting (off until the queue exists),
 * and LIVE_MODEL_CLIENT below can also keep it off from the site side.
 */
import type { Language } from "@/i18n/translations";
import type { Facts, Topic } from "./topics";

export const NICS_ENDPOINT = (import.meta.env.VITE_NICS_ENDPOINT as string | undefined) || "https://n8n.aibyteconsult.com/webhook/aquaterra-nics";

/** Site-side switch for live model answers. The server must also have the queue on. */
export const LIVE_MODEL_CLIENT = true;
export const ANSWER_WAIT_MS = 12_000;
const POLL_MS = 1_500;

type Res<T> = { ok: true; data: T } | { ok: false; error: string };

const call = async <T>(body: Record<string, unknown>, signal?: AbortSignal): Promise<Res<T>> => {
  try {
    const res = await fetch(NICS_ENDPOINT, {
      method: "POST",
      // text/plain keeps this a "simple" request: no CORS preflight.
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: JSON.stringify(body),
      signal,
    });
    const data = (await res.json().catch(() => null)) as (Record<string, unknown> & { ok?: boolean; error?: string }) | null;
    if (!data || typeof data !== "object") return { ok: false, error: "network" };
    return data.ok ? { ok: true, data: data as T } : { ok: false, error: String(data.error || "network") };
  } catch {
    return { ok: false, error: "network" };
  }
};

export interface ConsentInfo {
  consent: boolean | null;
  termsVersion: string;
  queue: boolean;
}

export const fetchConsent = (session: string) => call<ConsentInfo>({ action: "consent", session });
export const fetchStatus = () => call<{ queue: boolean; termsVersion: string }>({ action: "status" });
export const setConsent = (session: string, consent: boolean) => call<{ consent: boolean }>({ action: "set_consent", session, consent });
export const forgetDialogs = (session: string) => call<{ deleted: number }>({ action: "forget", session });

export interface DialogLine {
  lang: Language;
  qtype: Topic;
  question: string;
  facts: Facts;
  answer: string;
  source: "phrase" | "model";
}

/** Stored only if the resident agreed; the server answers logged:false otherwise. */
export const logDialog = (session: string, line: DialogLine) =>
  call<{ logged: boolean; id?: number }>({ action: "log", session, ...line });
export const rateDialog = (session: string, id: number, rating: 1 | -1) => call<{ ok: true }>({ action: "rate", session, id, rating });

/**
 * Ask NICS Language. Resolves to its raw text, or null if the queue is off,
 * the model did not answer in time, or anything failed. The resident's text
 * goes as a separate quoted field; the facts go as key = value fields.
 */
export const askModel = async (session: string, req: { lang: Language; qtype: Topic; question: string; facts: Facts }, signal?: AbortSignal): Promise<string | null> => {
  if (!LIVE_MODEL_CLIENT) return null;
  const started = Date.now();
  const q = await call<{ queued: boolean; id?: string }>({ action: "ask", session, ...req }, signal);
  if (!q.ok || !q.data.queued || !q.data.id) return null;
  while (Date.now() - started < ANSWER_WAIT_MS) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    if (signal?.aborted) return null;
    const a = await call<{ ready: boolean; text?: string }>({ action: "answer", session, id: q.data.id }, signal);
    if (a.ok && a.data.ready) return typeof a.data.text === "string" ? a.data.text : null;
  }
  return null;
};
