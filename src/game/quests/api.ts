/*
 * Daily quests from NICS AI. Backend: n8n workflow "[71 PUBLIC] AquaTerra Quests"
 * (POST /webhook/aquaterra-quests) hands each request to the Postgres function
 * aquaterra_quests() (server/quests/quests.sql). NICS AI picks the quests and
 * rewards there from live data; this file only asks.
 */
export const QUESTS_ENDPOINT = (import.meta.env.VITE_QUESTS_ENDPOINT as string | undefined) || "https://n8n.aibyteconsult.com/webhook/aquaterra-quests";

export type QuestsError = "session" | "quest" | "not_ready" | "claimed" | "answered" | "choice" | "action" | "network";
const KNOWN = new Set<string>(["session", "quest", "not_ready", "claimed", "answered", "choice", "action"]);

export type Result<T> = { ok: true; data: T; error?: undefined } | { ok: false; data?: undefined; error: QuestsError };

interface QuestBase {
  reward: number;
  done: boolean;
  claimed: boolean;
}
export type Quest = QuestBase &
  (
    | { id: "visit"; district: number; districtName: string }
    | { id: "play"; arcade: number; title: string; plotId: number; address: string; districtName: string }
    | { id: "civic"; open: number }
    | { id: "ride"; mode: "train" | "ferry" | "plane" }
    | { id: "ask"; topic: "citizens" | "districts" | "council" | "treasury"; options: string[]; answered?: number; correct?: boolean; answer?: number }
  );

export interface QuestsView {
  day: string;
  quests: Quest[];
  pot: number;
  paid: number;
  potLeft: number;
  fund: number;
  note: string;
  taxPct: number;
  resetsAt: string;
  claimedToday: number;
  reward?: number;
  tax?: number;
  fundEmpty?: boolean;
  correct?: boolean;
}

export interface QuestDay {
  day: string;
  note: string;
  pot: number;
  paid: number;
  people: number;
}

async function call<T>(body: Record<string, unknown>): Promise<Result<T>> {
  try {
    const res = await fetch(QUESTS_ENDPOINT, {
      method: "POST",
      // text/plain keeps this a "simple" request: no CORS preflight.
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => null)) as (Record<string, unknown> & { ok?: boolean; error?: string }) | null;
    if (!data || typeof data !== "object") return { ok: false, error: "network" };
    if (data.ok) return { ok: true, data: data as unknown as T };
    return { ok: false, error: KNOWN.has(String(data.error)) ? (data.error as QuestsError) : "network" };
  } catch {
    return { ok: false, error: "network" };
  }
}

export const fetchQuests = (session: string | null) => call<QuestsView>({ action: "today", ...(session ? { session } : {}) });
export const claimQuest = (session: string, quest: Quest["id"]) => call<QuestsView>({ action: "claim", session, quest });
export const answerQuest = (session: string, choice: number) => call<QuestsView>({ action: "answer", session, choice });
export const fetchQuestJournal = () => call<{ days: QuestDay[] }>({ action: "journal" });
