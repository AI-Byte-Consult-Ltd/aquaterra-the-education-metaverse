/*
 * The AquaTerra Commonwealth. Backend: n8n workflow "[63 PUBLIC] AquaTerra
 * Governance" (POST /webhook/aquaterra-governance), which hands each request to
 * the Postgres function aquaterra_gov() (server/governance/*.sql). Every rule
 * (who may vote, quorums, majorities, elections, NICS AI's vote) is decided
 * there; this file only asks and shows.
 */

export const GOV_ENDPOINT = (import.meta.env.VITE_GOV_ENDPOINT as string | undefined) || "https://n8n.aibyteconsult.com/webhook/aquaterra-governance";

export type GovError =
  | "session" | "forbidden" | "not_found" | "closed" | "not_eligible" | "no_name" | "no_home" | "cooldown" | "office" | "too_many"
  | "kind" | "title" | "body" | "district" | "param" | "amount" | "address" | "floors" | "name" | "post" | "citizen" | "choice"
  | "funds" | "ledger" | "action" | "network";

const KNOWN = new Set<GovError>([
  "session", "forbidden", "not_found", "closed", "not_eligible", "no_name", "no_home", "cooldown", "office", "too_many",
  "kind", "title", "body", "district", "param", "amount", "address", "floors", "name", "post", "citizen", "choice", "funds", "ledger", "action",
]);

export type Result<T> = { ok: true; data: T; error?: undefined } | { ok: false; data?: undefined; error: GovError };

export type Body = "council" | "assembly" | "mayors" | "district" | "referendum" | "nomination" | "ballot";
export type Rule = "majority" | "3/5" | "2/3" | "council" | "advisory";
export type Kind =
  | "resolution" | "set_param" | "budget" | "building" | "skyscraper" | "new_district" | "district_merge" | "district_split"
  | "strategy" | "charter" | "appoint_director" | "dismiss" | "election";
export type Status = "signatures" | "voting" | "passed" | "rejected" | "expired" | "withdrawn" | "closed";
export type Post = "president" | "treasury" | "works" | "civic";

export interface Tally {
  body: Body;
  rule: Rule;
  electorate: number;
  yes: number;
  no: number;
  abstain: number;
  quorum: number;
  need: number | null;
  passing: boolean;
  decided: boolean;
}

export interface StageResult extends Partial<Tally> {
  body: Body;
  passed?: boolean;
  skipped?: boolean;
  unopposed?: boolean;
  winners?: string[];
  candidates?: { name: string; votes: number }[];
  at: string;
}

export interface Proposal {
  id: number;
  kind: Kind;
  title: string;
  body: string;
  payload: Record<string, string | number | number[] | null>;
  author: string | null;
  status: Status;
  stage: number;
  stages: { body: Body; rule?: Rule }[];
  stageBody: Body | null;
  stageEnds: string | null;
  results: StageResult[];
  outcome: string | null;
  createdAt: string;
  closedAt: string | null;
  tally: Tally | null;
  signatures: { count: number; needed: number } | null;
  candidates: number | null;
  me: { canVote: boolean; vote: string | null; signed: boolean; canSign: boolean; stood: boolean; isAuthor: boolean } | null;
  rollCall?: { stage: number; name: string; ai: boolean; choice: string; reason: string | null; at: string }[];
  candidateList?: { n: number; name: string; statement: string; votes: number | null }[];
}

export interface Param {
  key: string;
  value: number;
  min: number;
  max: number;
  label: string;
  updatedAt: string;
}

export interface StateInfo {
  citizens: number;
  residents: number;
  districts: number;
  council: {
    seats: number;
    filled: number;
    need: number;
    members: { seat: number; name: string; title: string; kind: "human" | "ai"; joinedAt: string | null; termEnds: string | null }[];
  };
  assembly: {
    total: number;
    districtSeats: number;
    districtSeatsOpen: number;
    guildSeats: number;
    lotSeats: number;
    lotDrawn: number;
    seated: number;
    founding: boolean;
    foundingUntil: number;
    members: { name: string; kind: "district" | "lot" | "guild"; district: string | null; termEnds: string | null }[];
  };
  directorate: { post: Post; title: string; holder: string | null; termEnds: string | null }[];
  mayors: number;
  treasury: number;
  ledgerLive: boolean;
  signaturesNeeded: number;
  open: number;
  params: Param[];
}

export interface DistrictInfo {
  id: number;
  name: string;
  land: string;
  biome: string;
  capital: boolean;
  governedBy: string | null;
  adminName: string | null;
  residents: number;
  totalResidents: number | null;
  mayor: string | null;
  seat: { id: number; holder: string | null; termEnds: string | null } | null;
}

export interface CivicStatus {
  name: string | null;
  home: { district: number; name: string; governedBy: string; since: string; chosen: boolean; canMoveAt: string | null } | null;
  offices: { office: "council" | "deputy" | "mayor" | "director"; title: string; termEnds: string | null; seat?: number; post?: Post; district?: number }[];
  acting: Post[];
  official: boolean;
  toVote: number;
}

export interface LogEntry {
  id: number;
  at: string;
  kind: string;
  proposal: number | null;
  text: string;
}

export interface Laws {
  laws: { id: number; proposal: number; kind: Kind; title: string; body: string; inForce: boolean; enactedAt: string; endedAt: string | null }[];
  projects: { id: number; proposal: number; kind: Kind; title: string; status: "approved" | "built"; district: string | null; floors: number | null; address: string | null; approvedAt: string; builtAt: string | null }[];
  budget: { id: number; proposal: number; purpose: string; allocated: number; spent: number; district: string | null; createdAt: string }[];
  treasury: number;
  taxes: { kind: string; at: string; collected: number; payers: number }[];
}

type Req = Record<string, unknown>;

const call = async <T>(body: Req): Promise<Result<T>> => {
  try {
    const res = await fetch(GOV_ENDPOINT, {
      method: "POST",
      // text/plain keeps this a "simple" request: no CORS preflight.
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => null)) as (Record<string, unknown> & { ok?: boolean; error?: string }) | null;
    if (!data || typeof data !== "object") return { ok: false, error: "network" };
    if (data.ok) return { ok: true, data: data as T };
    return { ok: false, error: KNOWN.has(data.error as GovError) ? (data.error as GovError) : "network" };
  } catch {
    return { ok: false, error: "network" };
  }
};

const s = (session: string | null) => (session ? { session } : {});

export const fetchState = () => call<StateInfo>({ action: "state" });
export const fetchDistricts = () => call<{ seatAt: number; mayorAt: number; districts: DistrictInfo[] }>({ action: "districts" });
export const fetchProposals = (session: string | null, filter: string) => call<{ proposals: Proposal[] }>({ action: "proposals", filter, ...s(session) });
export const fetchProposal = (session: string | null, id: number) => call<{ proposal: Proposal }>({ action: "proposal", id, ...s(session) });
export const fetchLog = (before?: number) => call<{ entries: LogEntry[] }>({ action: "log", ...(before ? { before } : {}) });
export const fetchLaws = () => call<Laws>({ action: "laws" });
export const fetchCivic = (session: string) => call<CivicStatus & { ok: true }>({ action: "me", session });

export const setResidence = (session: string, district: number) => call<CivicStatus>({ action: "set_residence", session, district });
/** Sign-up without a choice: the citizen lives in the capital and may choose later without the 30-day wait. */
export const skipResidence = (session: string) => call<CivicStatus>({ action: "set_residence", session, skip: true });
export const propose = (session: string, kind: Kind, title: string, body: string, payload: Req) =>
  call<{ proposal: Proposal }>({ action: "propose", session, kind, title, body, payload });
export const sign = (session: string, id: number) => call<{ proposal: Proposal }>({ action: "sign", session, id });
export const withdraw = (session: string, id: number) => call<{ proposal: Proposal }>({ action: "withdraw", session, id });
export const vote = (session: string, id: number, choice: string, reason?: string) =>
  call<{ proposal: Proposal }>({ action: "vote", session, id, choice, ...(reason ? { reason } : {}) });
export const stand = (session: string, id: number, statement: string) => call<{ proposal: Proposal }>({ action: "stand", session, id, statement });
export const disburse = (session: string, line: number, to: string, amount: number, memo: string) =>
  call<{ ok: true }>({ action: "disburse", session, line, to, amount, memo });
export const markBuilt = (session: string, project: number) => call<{ ok: true }>({ action: "mark_built", session, project });
export const announce = (session: string, text: string) => call<{ ok: true }>({ action: "announce", session, text });

/** Bodies whose chambers stand on the plaza, and which stage bodies each one hosts. */
export const CHAMBERS = {
  council: ["council"],
  assembly: ["assembly"],
  mayors: ["mayors"],
  directorate: [],
  districts: ["district"],
  referendums: ["referendum"],
  elections: ["nomination", "ballot"],
} as const satisfies Record<string, readonly Body[]>;
export type Chamber = keyof typeof CHAMBERS;
export const isChamber = (c: string | undefined): c is Chamber => !!c && c in CHAMBERS;
