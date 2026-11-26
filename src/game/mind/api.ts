/*
 * City Mind: which NICS Language release lives in AquaTerra. Backend: n8n workflow
 * "[74 PUBLIC] AquaTerra City Mind" (POST /webhook/aquaterra-mind) hands each request to
 * aquaterra_mind() (server/mind/mind.sql). The model itself lives and trains in the NICS lab.
 * Its weights stay in a private bucket: answers are computed on the server, a browser only
 * ever receives the checked text.
 */
export const MIND_ENDPOINT = (import.meta.env.VITE_MIND_ENDPOINT as string | undefined) || "https://n8n.aibyteconsult.com/webhook/aquaterra-mind";

export interface MindRelease {
  version: number;
  modelId: string;
  step: number;
  params: number;
  status: "shadow" | "live" | "retired";
  weightsBytes: number;
  eval: Record<string, number | string>;
  exam: { total: number; passed: number; rate: number; at: string } | null;
  registeredAt: string;
  liveAt: string | null;
}

export interface MindStatus {
  live: MindRelease | null;
  releases: MindRelease[];
  data: { consenting: number; lines: number; week: number; sent: number; dropped: number; lastFetch: string | null };
  examMin: number;
}

export async function fetchMindStatus(): Promise<MindStatus | null> {
  try {
    const res = await fetch(MIND_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=UTF-8" }, // simple request, no CORS preflight
      body: JSON.stringify({ action: "status" }),
    });
    const d = await res.json();
    return d && d.ok ? (d as MindStatus) : null;
  } catch {
    return null;
  }
}

export type AskError = "session" | "no_live" | "too_many" | "topic" | "network";

/** Ask the live release on the server. `text` is the model's answer with {fact} labels, or null if it failed the checks. */
export async function askMind(session: string, topic: string, question: string): Promise<{ ok: true; version: number; text: string | null } | { ok: false; error: AskError }> {
  try {
    const res = await fetch(MIND_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: JSON.stringify({ action: "ask", session, topic, question }),
    });
    const d = await res.json();
    if (d && d.ok) return { ok: true, version: d.version, text: typeof d.text === "string" ? d.text : null };
    const e = String(d?.error || "network");
    return { ok: false, error: (["session", "no_live", "too_many", "topic"].includes(e) ? e : "network") as AskError };
  } catch {
    return { ok: false, error: "network" };
  }
}
