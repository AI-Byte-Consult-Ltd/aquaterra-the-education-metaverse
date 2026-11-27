/*
 * Piers on plots by the water: jetty, pier, harbour. Rules live on the server
 * (server/build/piers.sql, reached through the build webhook). This file knows
 * where a pier stands on the map (the same on the site, in build-sites.json and
 * on the server), talks to the server and prices boats the way the server does.
 */
import { kindName, type Plot, type World } from "@/game/world/generator";
import { hasHouse } from "@/game/world/buildings";
import { BUILD_ENDPOINT } from "./api";

export type PierAccess = "private" | "public";
export type PierLevel = 1 | 2 | 3;

export interface Pier {
  plotId: number;
  level: PierLevel;
  access: PierAccess;
  /** Mooring fee for visitors, TIDE (public piers). */
  fee: number;
  /** Epoch seconds when the work in progress is done. */
  readyAt: number;
}

export interface PierRules {
  params: Record<string, number>;
  permitPct: number;
  recipe: Record<string, number>;
}

export interface MyPier {
  plotId: number;
  level: PierLevel;
  access: PierAccess;
  fee: number;
  trips: number;
  revenue: number;
  invested: number;
  readyAt: string;
}

export const PIER_NAMES = ["", "Jetty", "Pier", "Harbour"] as const;

/** Defaults shown before the server answers; the server's own numbers win. */
export const DEFAULT_PIER_RULES: PierRules = {
  params: {
    pier_cost_1: 300, pier_cost_2: 800, pier_cost_3: 2000,
    pier_hours_1: 1, pier_hours_2: 3, pier_hours_3: 6,
    pier_fee_cap_1: 2, pier_fee_cap_2: 5, pier_fee_cap_3: 10,
    pier_own_discount_pct: 50, pier_remove_cost: 20,
  },
  permitPct: 10,
  recipe: {},
};

const WATER = new Set(["deep", "ocean", "shallow", "lake", "river"]);
const isWaterTile = (world: World, i: number) => WATER.has(kindName(world, i));

export interface PierSite {
  /** The shore tile of the plot the pier starts from. */
  shore: number;
  dx: number;
  dy: number;
  /** Water tiles in a row from the shore (up to 4). */
  run: number;
}

const siteCache = new WeakMap<World, Map<number, PierSite | null>>();

/**
 * Where a pier of this plot stands: from the shore tile with the longest run of
 * open water in front of it (closest to the plot's middle when equal).
 * null when the plot does not touch the water, or is water or a mountain.
 */
export function pierSite(world: World, plot: Plot): PierSite | null {
  let cache = siteCache.get(world);
  if (!cache) siteCache.set(world, (cache = new Map()));
  if (cache.has(plot.id)) return cache.get(plot.id)!;
  let best: PierSite | null = null;
  let bestScore = -Infinity;
  if (hasHouse(plot)) {
    const n = world.size;
    for (const t of plot.tiles) {
      const x = t % n;
      const y = (t - x) / n;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        let run = 0;
        for (let k = 1; k <= 4; k++) {
          const xx = x + dx * k;
          const yy = y + dy * k;
          if (xx < 0 || yy < 0 || xx >= n || yy >= n || !isWaterTile(world, yy * n + xx)) break;
          run++;
        }
        if (!run) continue;
        const score = Math.min(run, 3) * 1000 - Math.hypot(x - plot.anchor.x, y - plot.anchor.y) * 10 - t * 1e-7;
        if (score > bestScore) {
          bestScore = score;
          best = { shore: t, dx, dy, run };
        }
      }
    }
  }
  cache.set(plot.id, best);
  return best;
}

export const isCoastal = (world: World, plot: Plot) => pierSite(world, plot) !== null;

/** Water tiles a pier of this level covers, with the deck and (for a harbour) the T-head. */
export function pierTiles(world: World, plot: Plot, level: number): { tile: number; head: boolean }[] {
  const s = pierSite(world, plot);
  if (!s) return [];
  const n = world.size;
  const x = s.shore % n;
  const y = (s.shore - x) / n;
  const len = Math.min(s.run, level);
  const out: { tile: number; head: boolean }[] = [];
  for (let k = 1; k <= len; k++) out.push({ tile: (y + s.dy * k) * n + (x + s.dx * k), head: k === len });
  if (level >= 3) {
    const ex = x + s.dx * len;
    const ey = y + s.dy * len;
    for (const sgn of [-1, 1]) {
      const xx = ex + s.dy * sgn;
      const yy = ey + s.dx * sgn;
      if (xx >= 0 && yy >= 0 && xx < n && yy < n && isWaterTile(world, yy * n + xx)) out.push({ tile: yy * n + xx, head: true });
    }
  }
  return out;
}

/** Water plots a harbour here would cover: the server refuses a pier over water someone else owns. */
export function pierWaters(world: World, plot: Plot): number[] {
  const ids = new Set<number>();
  for (const { tile } of pierTiles(world, plot, 3)) {
    const pid = world.plotOf[tile];
    if (pid >= 0 && world.plots[pid].water) ids.add(pid);
  }
  return [...ids].sort((a, b) => a - b);
}

// --- server -----------------------------------------------------------------------------------

export type PierError =
  | "session" | "not_found" | "not_owner" | "not_coastal" | "occupied" | "nothing_here" | "max_level" | "building"
  | "water_owned" | "insufficient" | "amount" | "param" | "network";
const KNOWN = new Set<string>(["session", "not_found", "not_owner", "not_coastal", "occupied", "nothing_here", "max_level", "building", "water_owned", "insufficient", "amount", "param"]);

type Result<T> = { ok: true; data: T; error?: undefined } | { ok: false; data?: undefined; error: PierError };

const call = async <T>(body: Record<string, unknown>): Promise<Result<T>> => {
  try {
    const res = await fetch(BUILD_ENDPOINT, { method: "POST", headers: { "Content-Type": "text/plain;charset=UTF-8" }, body: JSON.stringify(body) });
    const data = (await res.json().catch(() => null)) as (Record<string, unknown> & { ok?: boolean; error?: string }) | null;
    if (!data || typeof data !== "object") return { ok: false, error: "network" };
    if (data.ok) return { ok: true, data: data as T };
    return { ok: false, error: KNOWN.has(String(data.error)) ? (data.error as PierError) : "network" };
  } catch {
    return { ok: false, error: "network" };
  }
};

/** [plot id, level, access, fee, ready at] */
type PierRow = [number, PierLevel, PierAccess, number, number];
const toPier = ([plotId, level, access, fee, readyAt]: PierRow): Pier => ({ plotId, level, access, fee, readyAt });

export const fetchPiers = async () => {
  const r = await call<{ piers: PierRow[]; rules: PierRules }>({ action: "piers" });
  return r.ok ? { piers: new Map(r.data.piers.map((row) => [row[0], toPier(row)])), rules: r.data.rules } : null;
};
export const fetchMyPiers = (session: string) => call<{ mine: MyPier[]; rules: PierRules }>({ action: "pier_me", session });

type Done = { pier: PierRow | null; cost?: number; permit?: number; paid?: number; materialsSaved?: number; fee?: number };
export const buildPier = (session: string, plotId: number, access: PierAccess, fee: number) => call<Done>({ action: "pier_build", session, plotId, access, fee });
export const upgradePier = (session: string, plotId: number) => call<Done>({ action: "pier_upgrade", session, plotId });
export const setPier = (session: string, plotId: number, access: PierAccess, fee: number) => call<Done>({ action: "pier_set", session, plotId, access, fee });
export const removePier = (session: string, plotId: number) => call<Done>({ action: "pier_remove", session, plotId });

// --- boats --------------------------------------------------------------------------------------

/** Piers by the tile of their plot's anchor, as the travel server finds them: set by the world map. */
let byAnchor = new Map<string, { pier: Pier; mine: boolean }>();
let rulesNow: PierRules = DEFAULT_PIER_RULES;

export function setPierIndex(world: World, piers: Map<number, Pier>, mine: (plotId: number) => boolean, rules: PierRules) {
  const next = new Map<string, { pier: Pier; mine: boolean }>();
  const now = Date.now() / 1000;
  for (const p of piers.values()) {
    const plot = world.plots[p.plotId];
    if (!plot || p.readyAt > now) continue;
    next.set(`${plot.anchor.x},${plot.anchor.y}`, { pier: p, mine: mine(p.plotId) });
  }
  byAnchor = next;
  rulesNow = rules;
}

/** A boat between two points as the server charges it: your own pier halves it, a public pier adds its fee. */
export function pierBoatFare(a: { x: number; y: number }, b: { x: number; y: number }, base: number): number {
  const ends = [byAnchor.get(`${Math.round(a.x)},${Math.round(a.y)}`), byAnchor.get(`${Math.round(b.x)},${Math.round(b.y)}`)];
  let f = base;
  let fees = 0;
  const own = ends.some((e) => e?.mine);
  for (const e of ends) {
    if (!e || e.mine || e.pier.access !== "public") continue;
    fees += Math.min(e.pier.fee, rulesNow.params[`pier_fee_cap_${e.pier.level}`] ?? 0);
  }
  if (own) f = Math.ceil((f * (100 - Math.min(100, rulesNow.params.pier_own_discount_pct ?? 50))) / 100);
  return f + fees;
}

/** Cost of the next level and its permit, by the server's rule. */
export const pierStep = (level: number, rules: PierRules) => {
  const cost = rules.params[`pier_cost_${level}`] ?? 0;
  return { cost, permit: Math.round((cost * rules.permitPct) / 100), hours: rules.params[`pier_hours_${level}`] ?? 0, cap: rules.params[`pier_fee_cap_${level}`] ?? 0 };
};

/** What the map renderer draws for these piers (a preview pier can be added for the plot window). */
export function pierDraw(world: World, piers: Iterable<Pier>, now = Date.now() / 1000) {
  const out: { tiles: { tile: number; head: boolean }[]; level: number; pub: boolean; building: boolean }[] = [];
  for (const p of piers) {
    const plot = world.plots[p.plotId];
    if (!plot) continue;
    out.push({ tiles: pierTiles(world, plot, p.level), level: p.level, pub: p.access === "public", building: p.readyAt > now });
  }
  return out;
}
