/*
 * AquaTerra visitor counter, without cookies. Backend: n8n "[76 PUBLIC] AquaTerra Visits"
 * (POST /webhook/aquaterra-visits), rules in server/visits/visits.sql.
 * The browser sends the page, the referrer host, utm_source, its time zone, language and device type.
 * The server builds a daily visitor key from ip + user agent and stores neither.
 */

export const VISITS_ENDPOINT = "https://n8n.aibyteconsult.com/webhook/aquaterra-visits";

export interface VisitCount { views: number; visitors: number; residents: number }
export interface VisitTop { key: string; visitors: number; views: number }
export interface VisitStats {
  today: VisitCount;
  week: VisitCount;
  month: VisitCount;
  own_week: number;
  since: string | null;
  days: { day: string; views: number; visitors: number }[];
  top: Partial<Record<"pages" | "sources" | "zones" | "devices" | "languages", VisitTop[]>>;
  recent: { at: string; path: string; source: string | null; tz: string | null; device: string | null; resident: boolean }[];
}

export type VisitsError = "session" | "forbidden" | "network";

const OWN_HOSTS = ["aquaterra.aibyteconsult.com", "localhost"];

export const deviceKind = (): "mobile" | "tablet" | "desktop" => {
  const ua = navigator.userAgent;
  if (/iPad|Tablet/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "tablet";
  if (/Mobi|Android|iPhone/i.test(ua)) return "mobile";
  return "desktop";
};

let firstHit = true;

/** One page view. Silent: a failed beacon never bothers the visitor. */
export const sendHit = (path: string, session: string | null) => {
  try {
    if (navigator.doNotTrack === "1" || (navigator as Navigator & { webdriver?: boolean }).webdriver) return;
    if (!/aquaterra\.aibyteconsult\.com$/.test(location.hostname)) return;
    let ref = "";
    if (firstHit && document.referrer) {
      try {
        const host = new URL(document.referrer).hostname.toLowerCase().replace(/^www\./, "");
        if (!OWN_HOSTS.includes(host)) ref = host;
      } catch { /* not a URL */ }
    }
    const src = firstHit ? new URLSearchParams(location.search).get("utm_source") ?? "" : "";
    firstHit = false;
    const body = JSON.stringify({
      action: "hit",
      path,
      ref,
      src,
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone ?? "",
      lang: (navigator.language || "").slice(0, 12),
      device: deviceKind(),
      session: session ?? "",
    });
    if (navigator.sendBeacon?.(VISITS_ENDPOINT, new Blob([body], { type: "text/plain;charset=UTF-8" }))) return;
    void fetch(VISITS_ENDPOINT, { method: "POST", headers: { "Content-Type": "text/plain;charset=UTF-8" }, body, keepalive: true }).catch(() => undefined);
  } catch { /* never break the page */ }
};

export const fetchVisitStats = async (session: string): Promise<{ ok: true; data: VisitStats } | { ok: false; error: VisitsError }> => {
  try {
    const res = await fetch(VISITS_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: JSON.stringify({ action: "stats", session }),
    });
    const data = (await res.json().catch(() => null)) as (VisitStats & { ok?: boolean; error?: string }) | null;
    if (data?.ok) return { ok: true, data };
    if (data?.error === "session" || data?.error === "forbidden") return { ok: false, error: data.error };
    return { ok: false, error: "network" };
  } catch {
    return { ok: false, error: "network" };
  }
};
