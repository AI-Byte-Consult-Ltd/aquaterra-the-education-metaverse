/**
 * Transport network of AquaTerra World: how a resident gets from one district
 * to another. It is read off the world map itself, so new lands from
 * expansions.ts bring their own harbours, roads and ferry lines.
 *
 *  - walk:  inside a district, free
 *  - car:   to a neighbouring district joined by a road
 *  - train: between railway stations
 *  - ferry: from a harbour to a harbour on another land (islands, Oceania)
 *  - plane: between airports
 *  - boat:  a water taxi called where there is water on the way and no
 *           bridge: across a river, to another islet, to a water plot.
 *           Nobody walks on water.
 *
 * The build writes this network to public/world/travel.json; the travel server
 * ("[66 PUBLIC] AquaTerra Travel") loads it and charges the fares. The site
 * only plans and animates the trip.
 */
import { KINDS, type Kind, type World } from "../world/generator";
import { MinHeap } from "../world/noise";

export type Mode = "walk" | "car" | "train" | "ferry" | "plane" | "boat";
/** Modes of the lines between districts (travel.json routes). */
export type TransitMode = "car" | "train" | "ferry" | "plane";
/** Modes that cost a fare. */
export type PaidMode = TransitMode | "boat";
export type HubKind = "station" | "airport" | "port";

export interface Hub {
  /** "station:16", "airport:3", "port:30": kind and district. Never changes. */
  id: string;
  kind: HubKind;
  district: number;
  name: string;
  x: number;
  y: number;
}

export interface Route {
  mode: TransitMode;
  /** District ids, a < b. Every route runs both ways. */
  a: number;
  b: number;
  /** Length in tiles along the road, the rails or the sea lane. */
  dist: number;
}

export interface Network {
  hubs: Hub[];
  routes: Route[];
}

export const HUB_FOR: Record<TransitMode, HubKind | null> = { car: null, train: "station", ferry: "port", plane: "airport" };

/** Fare rules: base + per 100 tiles, whole TIDE. The server keeps the live values; these are the starting ones. */
export type FareParams = Record<`${PaidMode}_base` | `${PaidMode}_per100`, number>;
export const DEFAULT_FARES: FareParams = {
  car_base: 2,
  car_per100: 8,
  train_base: 5,
  train_per100: 6,
  ferry_base: 8,
  ferry_per100: 10,
  plane_base: 30,
  plane_per100: 15,
  boat_base: 3,
  boat_per100: 15,
};

export const fare = (mode: Mode, dist: number, p: FareParams = DEFAULT_FARES): number =>
  mode === "walk" ? 0 : (p[`${mode}_base`] ?? DEFAULT_FARES[`${mode}_base`]) + Math.floor((dist * (p[`${mode}_per100`] ?? DEFAULT_FARES[`${mode}_per100`])) / 100 + 0.5);

/** Travel tax, the share of each fare that goes to the State Treasury (same rule as the server). */
export const travelTax = (amount: number, pct: number): number =>
  pct > 0 && amount > 0 ? Math.min(amount, Math.max(1, Math.round((amount * pct) / 100))) : 0;

/** Tiles per second on the map, for the trip animation only. */
export const SPEED: Record<Mode, number> = { walk: 10, car: 26, train: 45, ferry: 24, plane: 70, boat: 18 };

const K = Object.fromEntries(KINDS.map((k, i) => [k, i])) as Record<Kind, number>;
const SEA = new Set([K.deep, K.ocean, K.shallow]);
const WATER = new Set([K.deep, K.ocean, K.shallow, K.lake, K.river]);
const ROADLIKE = new Set([K.road, K.street, K.bridge, K.plaza]);
const RAIL = new Set([K.rail, K.railbridge, K.station]);

/** Step cost of a tile for each way of moving; Infinity: cannot pass. */
const COST: Record<Mode, (k: number) => number> = {
  walk: (k) => (ROADLIKE.has(k) || RAIL.has(k) ? 1 : k === K.tower ? 1 : k === K.land || k === K.beach || k === K.pier ? 1.6 : k === K.forest ? 2.2 : k === K.hill ? 3 : k === K.mountain || k === K.peak ? 6 : WATER.has(k) ? Infinity : 2),
  car: (k) => (ROADLIKE.has(k) ? 1 : RAIL.has(k) ? 3 : k === K.tower || k === K.runway || k === K.apron || k === K.terminal ? 2 : WATER.has(k) ? Infinity : 6),
  train: (k) => (RAIL.has(k) ? 1 : ROADLIKE.has(k) ? 2 : Infinity),
  ferry: (k) => (SEA.has(k) ? 1 : k === K.pier ? 1 : Infinity),
  plane: () => 1,
  // a water taxi: on the water, with a short walk to the shore at each end
  boat: (k) => (WATER.has(k) || k === K.pier ? 1 : k === K.beach ? 1.5 : k === K.mountain || k === K.peak ? 12 : 4),
};

/** Can a resident stand on this tile on foot? */
export const isWater = (k: number) => WATER.has(k);

const islesCache = new WeakMap<World, Int32Array>();

/**
 * Land a resident can walk across without getting wet: each land tile gets
 * the id of its piece of land (the smallest tile index in it, so ids stay the
 * same while the world grows elsewhere); water is -1. Bridges join land.
 */
export function isles(world: World): Int32Array {
  const hit = islesCache.get(world);
  if (hit) return hit;
  const n = world.size;
  const id = new Int32Array(n * n).fill(-1);
  const q: number[] = [];
  for (let s = 0; s < n * n; s++) {
    if (id[s] >= 0 || WATER.has(world.kind[s])) continue;
    id[s] = s;
    q.push(s);
    while (q.length) {
      const i = q.pop()!;
      const x = i % n;
      const y = (i - x) / n;
      if (x > 0 && id[i - 1] < 0 && !WATER.has(world.kind[i - 1])) (id[i - 1] = s), q.push(i - 1);
      if (x < n - 1 && id[i + 1] < 0 && !WATER.has(world.kind[i + 1])) (id[i + 1] = s), q.push(i + 1);
      if (y > 0 && id[i - n] < 0 && !WATER.has(world.kind[i - n])) (id[i - n] = s), q.push(i - n);
      if (y < n - 1 && id[i + n] < 0 && !WATER.has(world.kind[i + n])) (id[i + n] = s), q.push(i + n);
    }
  }
  islesCache.set(world, id);
  return id;
}

/**
 * The piece of land a point stands on. A harbour sits on the water at its
 * shore, so a water tile takes the land right next to it; open water is -1.
 * The travel server keeps the same ids (travel.json) and uses the same rule.
 */
export function isleAt(world: World, x: number, y: number): number {
  const n = world.size;
  const ix = Math.round(x);
  const iy = Math.round(y);
  if (ix < 0 || iy < 0 || ix >= n || iy >= n) return -1;
  const id = isles(world);
  if (id[iy * n + ix] >= 0) return id[iy * n + ix];
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
    const nx = ix + dx;
    const ny = iy + dy;
    if (nx >= 0 && ny >= 0 && nx < n && ny < n && id[ny * n + nx] >= 0) return id[ny * n + nx];
  }
  return -1;
}

/** Straight distance for a boat ride, whole tiles, at least 1 (same rule as the server). */
export const boatDist = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.max(1, Math.round(Math.hypot(Math.round(a.x) - Math.round(b.x), Math.round(a.y) - Math.round(b.y))));

/** Cheapest path on the tile grid (4 neighbours). Returns tile indices from start to goal, or null. */
export function tilePath(world: World, mode: Mode, from: number, to: number, maxCost = Infinity): number[] | null {
  const n = world.size;
  const N = n * n;
  if (from === to) return [from];
  const cost = COST[mode];
  const g = new Float64Array(N).fill(Infinity);
  const came = new Int32Array(N).fill(-1);
  const heap = new MinHeap();
  const tx = to % n;
  const ty = (to - tx) / n;
  g[from] = 0;
  heap.push(0, from);
  while (heap.size) {
    const i = heap.pop();
    if (i === to) break;
    const x = i % n;
    const y = (i - x) / n;
    const gi = g[i];
    if (gi > maxCost) return null;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
      const j = ny * n + nx;
      // the goal tile itself may be off the network (a town square, a plot): step on at a fixed price
      const c = j === to ? Math.min(cost(world.kind[j]), 4) : cost(world.kind[j]);
      if (c === Infinity) continue;
      const nd = gi + c;
      if (nd < g[j]) {
        g[j] = nd;
        came[j] = i;
        heap.push(nd + (Math.abs(nx - tx) + Math.abs(ny - ty)) * 0.999, j);
      }
    }
  }
  if (came[to] < 0) return null;
  const out = [to];
  for (let i = came[to]; i >= 0; i = came[i]) out.push(i);
  return out.reverse();
}

/** Tiles of open sea: water joined to the map's edge (not lakes, not rivers). */
export function openSea(world: World): Uint8Array {
  const n = world.size;
  const sea = new Uint8Array(n * n);
  const q: number[] = [];
  for (let k = 0; k < n; k++)
    for (const i of [k, (n - 1) * n + k, k * n, k * n + n - 1])
      if (!sea[i] && SEA.has(world.kind[i])) {
        sea[i] = 1;
        q.push(i);
      }
  while (q.length) {
    const i = q.pop()!;
    const x = i % n;
    const y = (i - x) / n;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
      const j = ny * n + nx;
      if (!sea[j] && SEA.has(world.kind[j])) {
        sea[j] = 1;
        q.push(j);
      }
    }
  }
  return sea;
}

/** How far from the town centre a harbour may be, in tiles. */
const PORT_RADIUS = 26;
/** Longest ferry crossing, in straight tiles. */
const FERRY_RANGE = 180;

const centreTile = (world: World, d: number) => {
  const c = world.districts[d];
  return c.capital ? (world.center + 5) * world.size + world.center : c.y * world.size + c.x;
};

/** Land of a district: 0 the continent, 1 Oceania, 2+ the lands of expansions.ts. */
export const landOf = (world: World, d: number) => world.zone[centreTile(world, d)];

/** Where a district's drop stands when it is "in town": the town square (for First Light, the plaza in front of the tower). */
export const districtCentre = (world: World, d: number) => {
  const i = centreTile(world, d);
  return { x: i % world.size, y: Math.floor(i / world.size) };
};

export function buildNetwork(world: World): Network {
  const n = world.size;
  const D = world.districts;
  const hubs: Hub[] = [];
  const routes: Route[] = [];
  const name = (d: number) => (D[d].capital ? "First Light" : D[d].name);

  // --- stations and airports, as the map has them
  for (const s of world.stations)
    hubs.push({ id: `station:${s.district}`, kind: "station", district: s.district, name: s.district === 0 ? "First Light Central Station" : `${name(s.district)} Station`, x: s.x, y: s.y });
  for (const a of world.airports) hubs.push({ id: `airport:${a.district}`, kind: "airport", district: a.district, name: a.name, x: a.x, y: a.y });

  // --- harbours: the open-sea shore nearest each town
  const sea = openSea(world);
  for (const d of D) {
    const c = centreTile(world, d.id);
    const cx = c % n;
    const cy = (c - cx) / n;
    let best = -1;
    let bd = Infinity;
    for (let y = Math.max(0, cy - PORT_RADIUS); y <= Math.min(n - 1, cy + PORT_RADIUS); y++)
      for (let x = Math.max(0, cx - PORT_RADIUS); x <= Math.min(n - 1, cx + PORT_RADIUS); x++) {
        const i = y * n + x;
        if (!sea[i]) continue;
        // a sea tile on this district's own shore
        let shore = false;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const j = (y + dy) * n + x + dx;
          if (x + dx >= 0 && y + dy >= 0 && x + dx < n && y + dy < n && !WATER.has(world.kind[j]) && world.district[j] === d.id) shore = true;
        }
        if (!shore) continue;
        const dd = Math.hypot(x - cx, y - cy);
        if (dd < bd) {
          bd = dd;
          best = i;
        }
      }
    if (best >= 0) hubs.push({ id: `port:${d.id}`, kind: "port", district: d.id, name: `${name(d.id)} Harbour`, x: best % n, y: Math.floor(best / n) });
  }
  const tile = (h: Hub) => h.y * n + h.x;
  const steps = (p: number[] | null) => (p ? p.length - 1 : null);
  const add = (mode: TransitMode, a: number, b: number, dist: number) => {
    const [lo, hi] = a < b ? [a, b] : [b, a];
    if (!routes.some((r) => r.mode === mode && r.a === lo && r.b === hi)) routes.push({ mode, a: lo, b: hi, dist: Math.max(1, Math.round(dist)) });
  };

  // --- roads: neighbouring districts whose roads meet
  const roadPairs = new Set<string>();
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      if (!ROADLIKE.has(world.kind[i])) continue;
      for (const j of [x + 1 < n ? i + 1 : -1, y + 1 < n ? i + n : -1]) {
        if (j < 0 || !ROADLIKE.has(world.kind[j])) continue;
        const a = world.district[i];
        const b = world.district[j];
        if (a < 0 || b < 0 || a === b) continue;
        roadPairs.add(a < b ? `${a}-${b}` : `${b}-${a}`);
      }
    }
  for (const key of [...roadPairs].sort()) {
    const [a, b] = key.split("-").map(Number);
    const p = steps(tilePath(world, "car", centreTile(world, a), centreTile(world, b)));
    add("car", a, b, p ?? Math.hypot(D[a].x - D[b].x, D[a].y - D[b].y) * 1.3);
  }

  // --- railway: every station to every other
  const stations = hubs.filter((h) => h.kind === "station");
  for (let i = 0; i < stations.length; i++)
    for (let j = i + 1; j < stations.length; j++) {
      const p = steps(tilePath(world, "train", tile(stations[i]), tile(stations[j])));
      if (p !== null) add("train", stations[i].district, stations[j].district, p);
    }

  // --- flights: every airport to every other
  const airports = hubs.filter((h) => h.kind === "airport");
  for (let i = 0; i < airports.length; i++)
    for (let j = i + 1; j < airports.length; j++)
      add("plane", airports[i].district, airports[j].district, Math.hypot(airports[i].x - airports[j].x, airports[i].y - airports[j].y));

  // --- ferries: each harbour sails to the nearest harbour of every other land in range
  const ports = hubs.filter((h) => h.kind === "port");
  const lands = [...new Set(ports.map((p) => landOf(world, p.district)))].sort((a, b) => a - b);
  const crossing = (p: Hub, q: Hub) => Math.hypot(p.x - q.x, p.y - q.y);
  for (const p of ports) {
    const lp = landOf(world, p.district);
    for (const l of lands) {
      if (l === lp) continue;
      const q = ports
        .filter((o) => landOf(world, o.district) === l && crossing(p, o) <= FERRY_RANGE)
        .sort((a, b) => crossing(p, a) - crossing(p, b))[0];
      if (!q) continue;
      const [lo, hi] = p.district < q.district ? [p.district, q.district] : [q.district, p.district];
      if (routes.some((r) => r.mode === "ferry" && r.a === lo && r.b === hi)) continue;
      const path = steps(tilePath(world, "ferry", tile(p), tile(q)));
      // a lane that has to sail far round a coast is no ferry line
      if (path !== null && path <= crossing(p, q) * 2 + 30) add("ferry", p.district, q.district, path);
    }
  }
  routes.sort((r, s) => r.mode.localeCompare(s.mode) || r.a - r.b || s.a - s.b || r.b - s.b);
  return { hubs, routes };
}

export interface Leg {
  mode: Mode;
  from: number;
  to: number;
  dist: number;
  fare: number;
}

export interface Plan {
  legs: Leg[];
  fare: number;
  /** Seconds on the map. */
  seconds: number;
}

/**
 * Best trips from one district to another: the cheapest one and, if it is
 * different, the fastest one. Empty if the district cannot be reached.
 */
export function planTrips(routes: Route[], from: number, to: number, fares: FareParams = DEFAULT_FARES): Plan[] {
  if (from === to) return [{ legs: [], fare: 0, seconds: 0 }];
  const adj = new Map<number, Route[]>();
  for (const r of routes) {
    adj.set(r.a, [...(adj.get(r.a) ?? []), r]);
    adj.set(r.b, [...(adj.get(r.b) ?? []), r]);
  }
  const best = (weight: (r: Route) => number): Plan | null => {
    const dist = new Map<number, number>([[from, 0]]);
    const back = new Map<number, Leg>();
    const heap = new MinHeap();
    heap.push(0, from);
    const done = new Set<number>();
    while (heap.size) {
      const d = heap.pop();
      if (done.has(d)) continue;
      done.add(d);
      if (d === to) break;
      for (const r of adj.get(d) ?? []) {
        const o = r.a === d ? r.b : r.a;
        const w = (dist.get(d) ?? 0) + weight(r);
        if (w < (dist.get(o) ?? Infinity)) {
          dist.set(o, w);
          back.set(o, { mode: r.mode, from: d, to: o, dist: r.dist, fare: fare(r.mode, r.dist, fares) });
          heap.push(w, o);
        }
      }
    }
    if (!back.has(to)) return null;
    const legs: Leg[] = [];
    for (let d = to; d !== from; d = back.get(d)!.from) legs.unshift(back.get(d)!);
    return { legs, fare: legs.reduce((s, l) => s + l.fare, 0), seconds: legs.reduce((s, l) => s + legSeconds(l.mode, l.dist), 0) };
  };
  const cheap = best((r) => fare(r.mode, r.dist, fares) + 0.01);
  const fast = best((r) => legSeconds(r.mode, r.dist) + 0.8);
  const out = [cheap, fast].filter((p): p is Plan => p !== null);
  if (out.length === 2 && out[0].legs.map((l) => l.mode + l.to).join() === out[1].legs.map((l) => l.mode + l.to).join()) out.pop();
  return out;
}

/** How long a leg takes on the map, seconds (animation only). */
export const legSeconds = (mode: Mode, dist: number) => Math.min(9, Math.max(1.5, dist / SPEED[mode] + (mode === "plane" ? 1.5 : mode === "walk" ? 0 : 0.6)));

/** Which districts can be reached from `from` at all. */
export function reachable(routes: Route[], from: number): Set<number> {
  const seen = new Set([from]);
  const q = [from];
  while (q.length) {
    const d = q.pop()!;
    for (const r of routes) {
      const o = r.a === d ? r.b : r.b === d ? r.a : -1;
      if (o >= 0 && !seen.has(o)) {
        seen.add(o);
        q.push(o);
      }
    }
  }
  return seen;
}
