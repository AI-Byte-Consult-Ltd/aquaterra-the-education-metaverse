/*
 * AquaTerra Arcade: mini-games on plots. Backend: n8n workflow "[66 PUBLIC]
 * AquaTerra Arcade" (POST /webhook/aquaterra-arcade), which hands each request
 * to the Postgres function aquaterra_arcade() (server/arcade/*.sql). The server
 * builds every game, keeps the answers, scores the run and pays tickets and
 * prizes through the Tide ledger; this file only asks and shows.
 */

export const ARCADE_ENDPOINT = (import.meta.env.VITE_ARCADE_ENDPOINT as string | undefined) || "https://n8n.aibyteconsult.com/webhook/aquaterra-arcade";

export const TEMPLATES = ["quiz", "crystals", "maze", "range", "race"] as const;
export type Template = (typeof TEMPLATES)[number];
export type Difficulty = "easy" | "normal" | "hard";
export type QuizTopic = "mixed" | "elements" | "science" | "commonwealth" | "world" | "custom";

export type ArcadeError =
  | "session" | "forbidden" | "not_found" | "closed" | "not_here" | "attempts" | "insufficient" | "amount" | "title" | "questions"
  | "exists" | "busy" | "no_offer" | "days" | "self" | "run" | "done" | "quest" | "not_ready" | "template" | "difficulty" | "picked"
  | "action" | "network";

const KNOWN = new Set<string>([
  "session", "forbidden", "not_found", "closed", "not_here", "attempts", "insufficient", "amount", "title", "questions", "exists", "busy",
  "no_offer", "days", "self", "run", "done", "quest", "not_ready", "template", "difficulty", "picked", "action",
]);

export type Result<T> = { ok: true; data: T; error?: undefined } | { ok: false; data?: undefined; error: ArcadeError };

export interface MapAttraction {
  id: number;
  plotId: number;
  template: Template;
  title: string;
  ai: boolean;
  entryFee: number;
  /** Prize a winner can get now (never more than the pool holds). */
  prize: number;
}

export interface ArcadeLaws {
  entryTaxPct: number;
  prizeTaxPct: number;
  rentTaxPct: number;
  dailyPrizeCap: number;
}

export interface ArcadeMap {
  attractions: MapAttraction[];
  /** [plot id, TIDE a day, most days] */
  forRent: [number, number, number][];
  /** NICS AI's book of experience, newest first. */
  mind: { day: string; text: string }[];
  laws: ArcadeLaws;
}

export interface Attraction {
  id: number;
  plotId: number;
  template: Template;
  title: string;
  difficulty: Difficulty;
  entryFee: number;
  prize: number;
  pool: number;
  ai: boolean;
  operator: string;
  topic: QuizTopic | null;
  plays: number;
  wins: number;
  createdAt: string;
  rules: Record<string, number>;
  best?: { name: string; score: number }[];
  earned?: number;
}

export type Role = "owner" | "tenant" | "landlord" | null;

export interface PlotArcade {
  plotId: number;
  attraction: Attraction | null;
  rentOffer: { pricePerDay: number; maxDays: number } | null;
  rental: { tenant: string; endsAt: string; mine: boolean } | null;
  me: {
    role: Role;
    here: boolean;
    free: number;
    attemptsLeft: number | null;
    prizeHereToday: boolean | null;
    prizeLeftToday: number;
  } | null;
}

export interface QuizGame { questions: { q: string; options: string[] }[]; secondsEach: number; win: number }
export interface CrystalsGame { size: number; crystals: number; picks: number; win: number; seconds: number }
export interface MazeGame { size: number; seconds: number; cells: number[] }
export interface RangeGame { targets: number; window: number; gap: number; win: number; duration: number; schedule: { id: number; t: number; x: number; y: number }[] }
export interface RaceGame { rows: number; tick: number; rocks: [number, number[]][] }

export interface Run {
  run: number;
  template: Template;
  title: string;
  difficulty: Difficulty;
  practice: boolean;
  fee: number;
  game: QuizGame | CrystalsGame | MazeGame | RangeGame | RaceGame;
  deadline: string;
  startedAt: string;
}

export interface Quest { id: QuestId; need: number; reward: number; progress: number; claimed: boolean }
export type QuestId = "play4" | "explore3" | "lands2" | "win2" | "ai1" | "perfect";

export interface RunResult {
  score: number;
  maxScore: number;
  won: boolean;
  /** Gross prize; the winner receives prize − tax. */
  prize: number;
  tax: number;
  practice: boolean;
  /** Quiz: index of the right option for each question. Crystals: where they were. */
  review: number[] | null;
  detail: { crash?: number; seconds?: number; reason?: string };
  quests: Quest[];
}

export interface Ranking {
  since: string;
  top: { place: number; name: string; points: number; plays: number; wins: number; districts: number; me: boolean }[];
  me: { place: number; points: number } | null;
}

export interface ArcadeMe {
  quests: Quest[];
  ranking: Ranking;
  today: { plays: number; prizeWon: number; cap: number };
  operating: Attraction[];
  rentals: { plotId: number; endsAt: string; as: "tenant" | "owner"; other: string; paid: number }[];
  offers: { plotId: number; pricePerDay: number; maxDays: number }[];
  recent: { title: string; template: Template; plotId: number; score: number; maxScore: number; won: boolean; prize: number; at: string }[];
}

export interface CustomQuestion { q: string; answer: string; wrong: [string, string, string] }

export interface PlaceInput {
  plotId: number;
  template: Template;
  title: string;
  difficulty: Difficulty;
  entryFee: number;
  prize: number;
  deposit: number;
  topic?: QuizTopic;
  questions?: CustomQuestion[];
}

const call = async <T>(body: Record<string, unknown>): Promise<Result<T>> => {
  try {
    const res = await fetch(ARCADE_ENDPOINT, {
      method: "POST",
      // text/plain keeps this a "simple" request: no CORS preflight.
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => null)) as (Record<string, unknown> & { ok?: boolean; error?: string }) | null;
    if (!data || typeof data !== "object") return { ok: false, error: "network" };
    if (data.ok) return { ok: true, data: data as T };
    return { ok: false, error: KNOWN.has(String(data.error)) ? (data.error as ArcadeError) : "network" };
  } catch {
    return { ok: false, error: "network" };
  }
};

export const fetchArcadeMap = () => call<ArcadeMap>({ action: "map" });
export const fetchPlotArcade = (session: string | null, plotId: number) => call<PlotArcade>({ action: "plot", session: session ?? "", plotId });
export const fetchArcadeMe = (session: string) => call<ArcadeMe>({ action: "me", session });
export const placeAttraction = (session: string, input: PlaceInput) => call<{ attraction: Attraction }>({ action: "place", session, ...input });
export const updateAttraction = (session: string, id: number, patch: Partial<Pick<Attraction, "title" | "difficulty" | "entryFee" | "prize">>) =>
  call<{ attraction: Attraction }>({ action: "update", session, id, ...patch });
export const topUp = (session: string, id: number, amount: number) => call<{ attraction: Attraction }>({ action: "topup", session, id, amount });
export const closeAttraction = (session: string, id: number) => call<{ closed: number; refund: number }>({ action: "close", session, id });
export const startRun = (session: string, id: number) => call<Run>({ action: "start", session, id });
export const pickCell = (session: string, run: number, cell: number) =>
  call<{ cell: number; hit: boolean; near: number | null; found: number; picksLeft: number }>({ action: "move", session, run, cell });
export const finishRun = (session: string, run: number, play: { answers?: number[]; path?: string; hits?: [number, number][]; switches?: [number, number][] }) =>
  call<RunResult>({ action: "finish", session, run, ...play });
export const claimQuest = (session: string, quest: QuestId) => call<{ reward: number; quests: Quest[] }>({ action: "claim_quest", session, quest });
export const offerRent = (session: string, plotId: number, pricePerDay: number, maxDays: number) =>
  call<{ plotId: number }>({ action: "rent_offer", session, plotId, pricePerDay, maxDays });
export const cancelRent = (session: string, plotId: number) => call<{ plotId: number }>({ action: "rent_cancel", session, plotId });
export const rentPlot = (session: string, plotId: number, days: number) =>
  call<{ plotId: number; days: number; paid: number; tax: number; endsAt: string }>({ action: "rent", session, plotId, days });

/** The same split the server makes: tax rounded to the nearest coin. */
export const taxOf = (amount: number, pct: number) => Math.round((amount * pct) / 100);
