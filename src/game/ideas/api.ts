/*
 * Ideas board: residents write NICS AI ideas for how AquaTerra should grow.
 * Same webhook as NICS dialogs (n8n "[66 PUBLIC] AquaTerra NICS Dialog"), rules in
 * server/nics/ideas.sql. NICS AI files each idea under a topic, remembers similar
 * ideas, and passes it to the Council of First Light, who decide on it.
 */
import { NICS_ENDPOINT } from "@/game/nics/api";

export const IDEA_TOPICS = ["tech", "economy", "building", "transport", "nature", "governance", "play", "nics", "other"] as const;
export type IdeaTopic = (typeof IDEA_TOPICS)[number];
export const IDEA_STATUSES = ["open", "accepted", "in_dev", "done", "rejected"] as const;
export type IdeaStatus = (typeof IDEA_STATUSES)[number];
export type IdeaFilter = IdeaStatus | "all" | "mine";

export type IdeaError =
  | "session" | "title" | "body" | "limit" | "duplicate" | "category" | "not_found" | "own" | "closed"
  | "council" | "status" | "note" | "action" | "network";

export interface Idea {
  id: number;
  at: string;
  category: IdeaTopic;
  title: string;
  body: string;
  words: string[];
  similar: number[];
  status: IdeaStatus;
  councilNote: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  author: string | null;
  supports: number;
  mine: boolean;
  supported: boolean;
}

export interface IdeasBoard {
  signedIn: boolean;
  council: boolean;
  perDay: number;
  leftToday: number;
  counts: Record<IdeaStatus | "all" | "residents", number>;
  topics: { topic: IdeaTopic; ideas: number }[];
  words: { word: string; ideas: number }[];
  ideas: Idea[];
}

type Res<T> = { ok: true; data: T } | { ok: false; error: IdeaError };

const call = async <T>(body: Record<string, unknown>): Promise<Res<T>> => {
  try {
    const res = await fetch(NICS_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => null)) as (Record<string, unknown> & { ok?: boolean; error?: string }) | null;
    if (!data || typeof data !== "object") return { ok: false, error: "network" };
    return data.ok ? { ok: true, data: data as T } : { ok: false, error: (String(data.error || "network") as IdeaError) };
  } catch {
    return { ok: false, error: "network" };
  }
};

export const fetchIdeas = (session: string | null, status: IdeaFilter) => call<IdeasBoard>({ action: "ideas", session: session ?? "", status });
export const submitIdea = (session: string, title: string, body: string, category: IdeaTopic | "auto", lang: string) =>
  call<{ idea: Idea }>({ action: "idea_submit", session, title, body, category, lang });
export const supportIdea = (session: string, id: number) => call<{ idea: Idea }>({ action: "idea_support", session, id: String(id) });
export const withdrawIdea = (session: string, id: number) => call<{ deleted: number }>({ action: "idea_withdraw", session, id: String(id) });
export const decideIdea = (session: string, id: number, status: IdeaStatus, note: string) =>
  call<{ idea: Idea }>({ action: "idea_decide", session, id: String(id), status, note });
