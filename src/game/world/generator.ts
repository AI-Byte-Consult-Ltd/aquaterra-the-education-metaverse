/**
 * AquaTerra World generator.
 *
 * Builds a large organic world from a seed: an irregular main continent and
 * islands, mountains and cliffs, forests, lakes and rivers that run downhill to
 * the sea; climate districts of very different character side by side (frozen
 * north, deserts, jungle, marshes, volcanic ridges…); towns linked by highways,
 * bridges and railways; airports, piers and local streets; and land plots of
 * irregular, all-different shapes along the streets, each with a postal
 * address like "12 Coral Street". The First Light Tower stands in the centre.
 *
 * The generator is pure and deterministic: the same seed gives the same world.
 */
import { DISTRICT_NAMES, streetNamer } from "./names";
import { MinHeap, fbm, ridged, rng, valueNoise } from "./noise";

export const KINDS = [
  "deep",
  "ocean",
  "shallow",
  "lake",
  "river",
  "beach",
  "land",
  "forest",
  "hill",
  "mountain",
  "peak",
  "road",
  "street",
  "bridge",
  "rail",
  "railbridge",
  "station",
  "runway",
  "apron",
  "terminal",
  "pier",
  "plaza",
  "tower",
] as const;
export type Kind = (typeof KINDS)[number];
const K = Object.fromEntries(KINDS.map((k, i) => [k, i])) as Record<Kind, number>;

export const BIOMES = [
  "metropolis",
  "temperate",
  "tundra",
  "desert",
  "jungle",
  "savanna",
  "wetland",
  "volcanic",
  "autumn",
  "blossom",
] as const;
export type Biome = (typeof BIOMES)[number];

export interface WorldParams {
  seed: number;
  size: number;
  districts: number;
  rivers: number;
  airports: number;
}

export const DEFAULT_WORLD: WorldParams = { seed: 20261122, size: 320, districts: 30, rivers: 24, airports: 2 };

export interface District {
  id: number;
  name: string;
  biome: Biome;
  /** Town centre tile. */
  x: number;
  y: number;
  capital: boolean;
}

export interface Road {
  id: number;
  name: string;
  kind: "highway" | "avenue" | "street";
  /** Middle tile of the road, for its label. */
  mid: { x: number; y: number };
}

export interface Plot {
  id: number;
  /** Postal address, e.g. "12 Coral Street". */
  address: string;
  number: number;
  road: number;
  district: number;
  tiles: number[];
  anchor: { x: number; y: number };
  /** Main landscape of the plot. */
  landscape: "meadow" | "forest" | "hillside" | "beachfront";
  waterView: boolean;
  /** Straight-line distance to the tower in tiles. */
  distance: number;
}

export interface Airport {
  name: string;
  x: number;
  y: number;
  district: number;
}

export interface World {
  params: WorldParams;
  size: number;
  center: number;
  kind: Uint8Array;
  /** Terrain height: < 0 water, 0..1 land. */
  height: Float32Array;
  /** District id per tile, -1 for open water. */
  district: Int16Array;
  /** Plot id per tile, -1 if none. */
  plotOf: Int32Array;
  /** Road id per road/street/bridge tile, -1 otherwise. */
  roadOf: Int32Array;
  districts: District[];
  roads: Road[];
  plots: Plot[];
  airports: Airport[];
  stations: { x: number; y: number; district: number }[];
  stats: { roadTiles: number; railTiles: number; bridgeTiles: number; riverTiles: number; landTiles: number };
}

export const kindName = (w: World, i: number): Kind => KINDS[w.kind[i]];

const WATER = new Set<number>([K.deep, K.ocean, K.shallow, K.lake, K.river]);
const isWater = (k: number) => WATER.has(k);
const BUILDABLE = new Set<number>([K.land, K.forest, K.hill, K.beach]);
const ROADLIKE = new Set<number>([K.road, K.street, K.bridge, K.plaza]);

export function generateWorld(params: WorldParams = DEFAULT_WORLD): World {
  const { size, seed } = params;
  const N = size * size;
  const center = Math.floor(size / 2);
  const rand = rng(seed);
  const kind = new Uint8Array(N);
  const height = new Float32Array(N);
  const district = new Int16Array(N).fill(-1);
  const plotOf = new Int32Array(N).fill(-1);
  const roadOf = new Int32Array(N).fill(-1);
  const idx = (x: number, y: number) => y * size + x;
  const inb = (x: number, y: number) => x >= 0 && y >= 0 && x < size && y < size;
  const dist2c = (x: number, y: number) => Math.hypot(x - center, y - center);

  // --- 1. height map ------------------------------------------------------------
  const warpX = fbm(seed + 11, 4);
  const warpY = fbm(seed + 23, 4);
  const base = fbm(seed + 37, 6);
  const ridge = ridged(seed + 51, 5);
  const mountainMask = fbm(seed + 67, 3);
  const detail = valueNoise(seed + 79);
  // archipelago: islands scattered around the continent
  const islandRand = rng(seed + 83);
  const islands = Array.from({ length: 11 }, () => {
    const a = islandRand() * Math.PI * 2;
    const r = 0.62 + islandRand() * 0.28;
    return { x: Math.cos(a) * r, y: Math.sin(a) * r, s: 0.04 + islandRand() * 0.07, h: 0.35 + islandRand() * 0.35 };
  });
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = (x / size) * 2 - 1;
      const ny = (y / size) * 2 - 1;
      const wx = nx + 0.45 * warpX(nx * 1.3 + 5, ny * 1.3 + 5);
      const wy = ny + 0.45 * warpY(nx * 1.3 - 7, ny * 1.3 - 7);
      // continent shape: noisy, stretched, not a circle
      const d = Math.hypot(wx * 0.95, wy * 1.08);
      let h = base(wx * 2.1, wy * 2.1) * 0.85 + 0.34 - 1.05 * d * d;
      // mountain chains along ridges where the mask allows
      const mm = Math.max(0, mountainMask(nx * 1.6 + 3, ny * 1.6 - 2));
      for (const is of islands) {
        const di = Math.hypot(wx - is.x, wy - is.y);
        const bump = Math.exp(-((di / is.s) ** 2));
        if (bump > 0.08) h = Math.max(h, is.h * bump - 0.14 + base(wx * 4, wy * 4) * 0.12);
      }
      if (h > 0) h += Math.pow(ridge(nx * 2.6, ny * 2.6), 3) * mm * 1.25 * Math.min(1, h * 4);
      h += detail(x / 6, y / 6) * 0.025;
      // flat, safe ground for the capital around the tower
      const dc = Math.hypot(nx, ny);
      const w = Math.exp(-((dc / 0.11) ** 2));
      h = h * (1 - w) + 0.14 * w;
      height[idx(x, y)] = h;
    }
  }
  // normalise land to 0..1
  let maxH = 0;
  for (let i = 0; i < N; i++) maxH = Math.max(maxH, height[i]);
  for (let i = 0; i < N; i++) if (height[i] > 0) height[i] /= maxH;

  for (let i = 0; i < N; i++) {
    const h = height[i];
    kind[i] =
      h < -0.3 ? K.deep : h < -0.045 ? K.ocean : h < 0 ? K.shallow : h < 0.035 ? K.beach : h > 0.72 ? K.peak : h > 0.55 ? K.mountain : h > 0.4 ? K.hill : K.land;
  }

  // --- 2. districts (climate zones) ------------------------------------------------
  const districts: District[] = [{ id: 0, name: DISTRICT_NAMES.metropolis[0], biome: "metropolis", x: center, y: center, capital: true }];
  const landCandidates: number[] = [];
  for (let i = 0; i < N; i++) if (height[i] > 0.03 && height[i] < 0.5) landCandidates.push(i);
  for (let tries = 0; tries < 6000 && districts.length < params.districts; tries++) {
    const i = landCandidates[Math.floor(rand() * landCandidates.length)];
    const x = i % size;
    const y = (i - x) / size;
    const minD = 30;
    if (districts.some((d) => Math.hypot(d.x - x, d.y - y) < minD)) continue;
    districts.push({ id: districts.length, name: "", biome: "temperate", x, y, capital: false });
  }
  // climate from latitude, moisture and altitude, so neighbours differ a lot
  const moist = fbm(seed + 97, 3);
  const used: Partial<Record<Biome, number>> = {};
  const scored = districts.slice(1).map((d) => {
    const lat = (d.y / size) * 2 - 1; // -1 north … 1 south
    const m = moist((d.x / size) * 3, (d.y / size) * 3);
    const alt = height[idx(d.x, d.y)];
    return { d, lat, m, alt };
  });
  // Each district ranks the climates that fit its latitude, moisture and altitude;
  // a cap per climate keeps the world varied (frozen north next to jungle and dunes).
  const cap = Math.ceil((districts.length - 1) / 7);
  const count: Partial<Record<Biome, number>> = {};
  const fit = (b: Biome, lat: number, m: number, alt: number) => {
    switch (b) {
      case "tundra":
        return -lat * 2 + alt;
      case "desert":
        return lat * 1.5 - m * 1.5;
      case "jungle":
        return lat * 1.5 + m * 1.5;
      case "savanna":
        return lat * 0.8 - Math.abs(m) * 0.5 + 0.2;
      case "wetland":
        return m * 2 - alt * 2;
      case "volcanic":
        return alt * 3 - 1;
      case "autumn":
        return -lat * 0.8 + m * 0.5;
      case "blossom":
        return 0.3 - Math.abs(lat) + m * 0.6;
      case "temperate":
        return 0.2 - Math.abs(lat) * 0.5;
      default:
        return -9;
    }
  };
  // the two highest districts are volcanic ridges
  const volcanic = [...scored].sort((a, b) => b.alt - a.alt).slice(0, 2);
  for (const v of volcanic) v.d.biome = "volcanic";
  count.volcanic = volcanic.length;
  for (const s of [...scored].sort(() => rand() - 0.5)) {
    if (volcanic.includes(s)) continue;
    const prefs = (BIOMES.filter((b) => b !== "metropolis") as Biome[])
      .map((b) => ({ b, v: fit(b, s.lat, s.m, s.alt) + rand() * 0.25 }))
      .sort((a, b) => b.v - a.v);
    const pick = prefs.find((p) => (count[p.b] ?? 0) < cap) ?? prefs[0];
    s.d.biome = pick.b;
    count[pick.b] = (count[pick.b] ?? 0) + 1;
  }
  for (const d of districts.slice(1)) {
    const list = DISTRICT_NAMES[d.biome];
    const n = used[d.biome] ?? 0;
    used[d.biome] = n + 1;
    d.name = n < list.length ? list[n] : `${list[n % list.length]} ${["East", "West", "North", "South"][Math.floor(n / list.length) % 4]}`;
  }
  // assign tiles: nearest centre in a noise-warped metric, so borders are irregular
  const bx = fbm(seed + 131, 3);
  const by = fbm(seed + 137, 3);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = idx(x, y);
      if (height[i] < 0) continue;
      const px = x + bx(x / 35, y / 35) * 24;
      const py = y + by(x / 35, y / 35) * 24;
      let best = 0;
      let bd = Infinity;
      for (const d of districts) {
        const dd = (d.x - px) ** 2 + (d.y - py) ** 2 * (d.capital ? 1 : 1);
        const weight = d.capital ? 0.55 : 1; // capital district is a bit larger
        if (dd * weight < bd) {
          bd = dd * weight;
          best = d.id;
        }
      }
      district[i] = best;
    }
  }
  // shallow water and beaches next to land take the nearest district too (for addresses / colours)
  const biomeAt = (i: number): Biome => (district[i] >= 0 ? districts[district[i]].biome : "temperate");

  // --- 3. forests ----------------------------------------------------------------------
  const forestN = fbm(seed + 151, 4);
  const forestThreshold: Record<Biome, number> = {
    metropolis: 0.42,
    temperate: 0.08,
    tundra: 0.12,
    desert: 0.55,
    jungle: -0.25,
    savanna: 0.35,
    wetland: 0.15,
    volcanic: 0.4,
    autumn: -0.05,
    blossom: 0.05,
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = idx(x, y);
      if (kind[i] !== K.land && kind[i] !== K.hill) continue;
      if (dist2c(x, y) < 18) continue;
      if (forestN(x / 22, y / 22) > forestThreshold[biomeAt(i)]) kind[i] = K.forest;
    }
  }

  // --- 4. lakes -------------------------------------------------------------------------
  const lakeN = fbm(seed + 173, 3);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = idx(x, y);
      const k = kind[i];
      if ((k !== K.land && k !== K.forest) || height[i] < 0.08 || height[i] > 0.38 || dist2c(x, y) < 24) continue;
      const bonus = biomeAt(i) === "wetland" ? 0.12 : biomeAt(i) === "desert" ? -0.15 : 0;
      if (lakeN(x / 14, y / 14) + bonus > 0.5) kind[i] = K.lake;
    }
  }

  // --- 5. rivers: from the mountains downhill to water ---------------------------------
  let riverTiles = 0;
  const sources: number[] = [];
  for (let i = 0; i < N; i++) if (height[i] > 0.5 && kind[i] !== K.peak) sources.push(i);
  for (let r = 0; r < params.rivers && sources.length; r++) {
    let cur = sources[Math.floor(rand() * sources.length)];
    const path: number[] = [];
    const seen = new Set<number>();
    let reached = false;
    for (let step = 0; step < 400; step++) {
      path.push(cur);
      seen.add(cur);
      const x = cur % size;
      const y = (cur - x) / size;
      let next = -1;
      let nh = Infinity;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx2 = x + dx;
        const ny2 = y + dy;
        if (!inb(nx2, ny2)) continue;
        const j = idx(nx2, ny2);
        if (seen.has(j)) continue;
        const hh = height[j] + rand() * 0.004;
        if (hh < nh) {
          nh = hh;
          next = j;
        }
      }
      if (next < 0) break;
      if (isWater(kind[next])) {
        reached = true;
        break;
      }
      if (dist2c(next % size, Math.floor(next / size)) < 14) break; // keep the tower plaza dry
      // carve: rivers may cut through small rises
      if (height[next] > height[cur]) height[next] = height[cur] - 0.001;
      cur = next;
    }
    if (reached && path.length > 12) {
      for (const t of path.slice(2)) {
        if (kind[t] !== K.peak) {
          kind[t] = K.river;
          riverTiles++;
        }
      }
    }
  }

  // --- 6. tower and capital plaza ------------------------------------------------------
  for (let y = center - 6; y <= center + 6; y++)
    for (let x = center - 6; x <= center + 6; x++) {
      const d = Math.max(Math.abs(x - center), Math.abs(y - center));
      const i = idx(x, y);
      if (d <= 1) kind[i] = K.tower;
      else if (d <= 4) kind[i] = K.plaza;
      else if (isWater(kind[i]) || kind[i] === K.forest) kind[i] = K.land;
      height[i] = Math.max(height[i], 0.12);
    }
  // town squares
  for (const d of districts.slice(1)) {
    for (let y = d.y - 1; y <= d.y + 1; y++)
      for (let x = d.x - 1; x <= d.x + 1; x++) if (inb(x, y) && !isWater(kind[idx(x, y)])) kind[idx(x, y)] = K.plaza;
  }

  const airports: Airport[] = [];
  const airportGates: { gate: number; ax: number; ay: number }[] = [];
  // --- 9. airports ------------------------------------------------------------------------
  const RUNWAY = 22;
  for (let a = 0; a < params.airports; a++) {
    let best: { x: number; y: number; horiz: boolean; score: number } | null = null;
    for (let tries = 0; tries < 5000; tries++) {
      const horiz = rand() < 0.5;
      const x0 = Math.floor(rand() * (size - RUNWAY - 8)) + 4;
      const y0 = Math.floor(rand() * (size - RUNWAY - 8)) + 4;
      const w = horiz ? RUNWAY : 6;
      const h = horiz ? 6 : RUNWAY;
      if (Math.hypot(x0 - center, y0 - center) < 50) continue;
      if (airports.some((o) => Math.hypot(o.x - x0, o.y - y0) < 90)) continue;
      let ok = true;
      let hs = 0;
      let hmin = 1;
      let hmax = 0;
      for (let y = y0; y < y0 + h && ok; y++)
        for (let x = x0; x < x0 + w; x++) {
          const k = kind[idx(x, y)];
          if (!(k === K.land || k === K.forest || k === K.beach)) {
            ok = false;
            break;
          }
          const hh = height[idx(x, y)];
          hs += hh;
          hmin = Math.min(hmin, hh);
          hmax = Math.max(hmax, hh);
        }
      if (!ok || hmax - hmin > 0.2) continue;
      const score = hmax - hmin + hs / (w * h) * 0.2 + rand() * 0.02;
      if (!best || score < best.score) best = { x: x0, y: y0, horiz, score };
    }
    if (!best) continue;
    const { x: x0, y: y0, horiz } = best;
    const flat = height[idx(x0, y0)];
    for (let a2 = 0; a2 < RUNWAY; a2++)
      for (let b2 = 0; b2 < 6; b2++) {
        const x = horiz ? x0 + a2 : x0 + b2;
        const y = horiz ? y0 + b2 : y0 + a2;
        const i = idx(x, y);
        height[i] = flat;
        kind[i] = b2 < 2 ? K.runway : b2 >= 3 && a2 >= RUNWAY / 2 - 3 && a2 < RUNWAY / 2 + 3 ? (b2 >= 4 ? K.terminal : K.apron) : K.apron;
      }
    const ax = horiz ? x0 + RUNWAY / 2 : x0 + 5;
    const ay = horiz ? y0 + 5 : y0 + RUNWAY / 2;
    const did = district[idx(ax, ay)];
    airports.push({ name: `${districts[did]?.name ?? "AquaTerra"} Airport`, x: ax, y: ay, district: did });
    airportGates.push({ gate: idx(horiz ? ax : x0 + 6, horiz ? y0 + 6 : ay), ax, ay });
  }

  // --- 7. A* path finding ---------------------------------------------------------------
  const jitter = valueNoise(seed + 199);
  const astar = (from: number, to: number, cost: (i: number) => number): number[] | null => {
    const g = new Float64Array(N).fill(Infinity);
    const came = new Int32Array(N).fill(-1);
    const done = new Uint8Array(N);
    const heap = new MinHeap();
    const tx = to % size;
    const ty = (to - tx) / size;
    g[from] = 0;
    heap.push(0, from);
    while (heap.size) {
      const cur = heap.pop();
      if (cur === to) break;
      if (done[cur]) continue;
      done[cur] = 1;
      const x = cur % size;
      const y = (cur - x) / size;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx2 = x + dx;
        const ny2 = y + dy;
        if (!inb(nx2, ny2)) continue;
        const j = idx(nx2, ny2);
        const c = cost(j);
        if (!Number.isFinite(c)) continue;
        const ng = g[cur] + c;
        if (ng < g[j]) {
          g[j] = ng;
          came[j] = cur;
          heap.push(ng + (Math.abs(nx2 - tx) + Math.abs(ny2 - ty)) * 0.3, j);
        }
      }
    }
    if (!Number.isFinite(g[to])) return null;
    const path: number[] = [];
    for (let c = to; c !== -1; c = came[c]) path.push(c);
    return path.reverse();
  };

  const roads: Road[] = [];
  const roadPaths: number[][] = [];
  const roadIdx = new Int32Array(N).fill(-1);
  const namer = streetNamer(rng(seed + 211));
  const roadCost = (i: number) => {
    const k = kind[i];
    const x = i % size;
    const y = (i - x) / size;
    const j = 1 + (jitter(x / 5, y / 5) + 1) * 0.35;
    switch (k) {
      case K.road:
      case K.street:
      case K.bridge:
      case K.plaza:
        return 0.3;
      case K.land:
      case K.beach:
        return j;
      case K.forest:
        return 1.7 * j;
      case K.hill:
        return 3 * j;
      case K.mountain:
        return 9;
      case K.peak:
        return 40;
      case K.river:
        return 5;
      case K.lake:
        return 12;
      case K.shallow:
        return 6;
      case K.ocean:
        return 11;
      case K.deep:
        return 45;
      case K.rail:
      case K.station:
        return 2;
      case K.tower:
      case K.runway:
      case K.terminal:
        return Infinity;
      default:
        return 4;
    }
  };
  const layRoad = (path: number[], rkind: Road["kind"], name?: string) => {
    const id = roads.length;
    const m = path[Math.floor(path.length / 2)];
    roads.push({ id, name: name ?? namer(rkind), kind: rkind, mid: { x: m % size, y: Math.floor(m / size) } });
    roadPaths.push(path);
    for (let pi = 0; pi < path.length; pi++) {
      const t = path[pi];
      const k = kind[t];
      if (k === K.plaza || k === K.tower) continue;
      if (isWater(k)) kind[t] = K.bridge;
      else if (k === K.rail || k === K.station || k === K.road || k === K.bridge) {
        /* keep: crossing or shared segment */
      } else kind[t] = rkind === "street" ? K.street : K.road;
      if (roadOf[t] < 0) {
        roadOf[t] = id;
        roadIdx[t] = pi;
      }
    }
    return id;
  };

  // highways: a minimum spanning tree over the towns plus a few extra links
  const T = districts.length;
  const inTree = new Set<number>([0]);
  const edges: [number, number][] = [];
  while (inTree.size < T) {
    let best: [number, number] | null = null;
    let bd = Infinity;
    for (const a of inTree)
      for (let b = 0; b < T; b++) {
        if (inTree.has(b)) continue;
        const dd = Math.hypot(districts[a].x - districts[b].x, districts[a].y - districts[b].y);
        if (dd < bd) {
          bd = dd;
          best = [a, b];
        }
      }
    if (!best) break;
    inTree.add(best[1]);
    edges.push(best);
  }
  for (let a = 0; a < T; a++) {
    // add the second-nearest neighbour to create loops
    const near = districts
      .map((d, b) => ({ b, dd: Math.hypot(d.x - districts[a].x, d.y - districts[a].y) }))
      .filter((o) => o.b !== a)
      .sort((p, q) => p.dd - q.dd);
    const cand = near[1];
    if (cand && rand() < 0.45 && !edges.some(([p, q]) => (p === a && q === cand.b) || (p === cand.b && q === a))) edges.push([a, cand.b]);
  }
  const towerGate = idx(center, center + 5);
  for (const [a, b] of edges) {
    const from = a === 0 ? towerGate : idx(districts[a].x, districts[a].y);
    const to = b === 0 ? towerGate : idx(districts[b].x, districts[b].y);
    const p = astar(from, to, roadCost);
    if (p) layRoad(p, "highway");
  }

  // local streets: organic spurs out of each town, many more around the capital
  const streetCost = (i: number) => {
    const k = kind[i];
    if (isWater(k) || k === K.peak || k === K.tower || k === K.runway || k === K.terminal) return Infinity;
    if (k === K.mountain) return 12;
    return roadCost(i);
  };
  for (const d of districts) {
    const spurs = d.capital ? 40 : 12;
    const radius = d.capital ? 40 : 18;
    for (let s = 0; s < spurs; s++) {
      const ang = rand() * Math.PI * 2;
      const r = radius * (0.45 + rand() * 0.55);
      const tx2 = Math.round(d.x + Math.cos(ang) * r);
      const ty2 = Math.round(d.y + Math.sin(ang) * r);
      if (!inb(tx2, ty2)) continue;
      const t = idx(tx2, ty2);
      if (!BUILDABLE.has(kind[t])) continue;
      const startTile = d.capital ? idx(center + Math.round(Math.cos(ang) * 5), center + Math.round(Math.sin(ang) * 5)) : idx(d.x, d.y);
      const p = astar(startTile, t, streetCost);
      if (p) layRoad(p, d.capital && s < 8 ? "avenue" : "street");
    }
  }

  // airport roads
  for (const { gate, ax, ay } of airportGates) {
    const near = [...districts].sort((p, q) => Math.hypot(p.x - ax, p.y - ay) - Math.hypot(q.x - ax, q.y - ay))[0];
    if (!inb(gate % size, Math.floor(gate / size))) continue;
    const p = astar(gate, near.capital ? towerGate : idx(near.x, near.y), roadCost);
    if (p) layRoad(p, "highway", `${near.capital ? "First Light" : near.name} Airport Road`);
  }

  // --- 8. railway: capital to the far towns ---------------------------------------------
  const railCost = (i: number) => {
    const k = kind[i];
    switch (k) {
      case K.rail:
      case K.railbridge:
      case K.station:
        return 0.3;
      case K.land:
      case K.beach:
      case K.plaza:
        return 1.2;
      case K.forest:
        return 1.6;
      case K.hill:
        return 6;
      case K.mountain:
        return 28;
      case K.peak:
        return 90;
      case K.road:
      case K.street:
        return 2.5;
      case K.bridge:
        return 9;
      case K.river:
        return 4;
      case K.lake:
      case K.shallow:
        return 9;
      case K.ocean:
        return 16;
      case K.deep:
        return 70;
      case K.tower:
      case K.runway:
      case K.apron:
      case K.terminal:
        return Infinity;
      default:
        return 3;
    }
  };
  let railTiles = 0;
  const stations: World["stations"] = [];
  const byDistance = districts
    .slice(1)
    .map((d) => ({ d, dd: Math.hypot(d.x - center, d.y - center) }))
    .sort((a, b) => b.dd - a.dd);
  // pick far towns in different directions
  const railTargets: District[] = [];
  for (const { d } of byDistance) {
    const ang = Math.atan2(d.y - center, d.x - center);
    if (railTargets.every((o) => Math.abs(Math.atan2(Math.sin(ang - Math.atan2(o.y - center, o.x - center)), Math.cos(ang - Math.atan2(o.y - center, o.x - center)))) > 1.0))
      railTargets.push(d);
    if (railTargets.length >= 5) break;
  }
  const centralStation = idx(center - 6, center);
  for (const d of railTargets) {
    const p = astar(centralStation, idx(d.x + 2 < size ? d.x + 2 : d.x, d.y), railCost);
    if (!p) continue;
    for (const t of p) {
      const k = kind[t];
      if (k === K.road || k === K.street || k === K.bridge || k === K.plaza || k === K.station) continue; // level crossing
      kind[t] = isWater(k) ? K.railbridge : K.rail;
      railTiles++;
    }
    const end = p[p.length - 1];
    if (kind[end] === K.rail) kind[end] = K.station;
    stations.push({ x: end % size, y: Math.floor(end / size), district: d.id });
  }
  if (kind[centralStation] === K.rail || kind[centralStation] === K.land) kind[centralStation] = K.station;
  stations.unshift({ x: center - 6, y: center, district: 0 });

  // --- 10. piers in coastal towns -----------------------------------------------------------
  for (const d of districts) {
    // nearest shallow tile within 14 tiles
    let bestT = -1;
    let bd = Infinity;
    for (let y = d.y - 14; y <= d.y + 14; y++)
      for (let x = d.x - 14; x <= d.x + 14; x++) {
        if (!inb(x, y)) continue;
        const k = kind[idx(x, y)];
        if (k !== K.shallow) continue;
        const dd = Math.hypot(x - d.x, y - d.y);
        if (dd < bd) {
          bd = dd;
          bestT = idx(x, y);
        }
      }
    if (bestT < 0) continue;
    const px = bestT % size;
    const py = Math.floor(bestT / size);
    const sx = Math.sign(px - d.x) || 1;
    const sy = Math.sign(py - d.y) || 0;
    const [dx, dy] = Math.abs(px - d.x) >= Math.abs(py - d.y) ? [sx, 0] : [0, sy || 1];
    for (let s = 0; s < 4; s++) {
      const x = px + dx * s;
      const y = py + dy * s;
      if (!inb(x, y) || !isWater(kind[idx(x, y)])) break;
      kind[idx(x, y)] = K.pier;
    }
    const p = astar(bestT, d.capital ? towerGate : idx(d.x, d.y), streetCost);
    if (p) layRoad(p.slice(1), "street");
  }

  // --- 11. plots: irregular parcels grown from seeds along the streets ---------------------
  // distance from streets through buildable land
  const MAXDEPTH = 6;
  const roadDist = new Int16Array(N).fill(-1);
  const roadNear = new Int32Array(N).fill(-1); // nearest road tile
  const queue: number[] = [];
  for (let i = 0; i < N; i++)
    if (kind[i] === K.road || kind[i] === K.street) {
      roadDist[i] = 0;
      roadNear[i] = i;
      queue.push(i);
    }
  for (let q = 0; q < queue.length; q++) {
    const cur = queue[q];
    if (roadDist[cur] >= MAXDEPTH) continue;
    const x = cur % size;
    const y = (cur - x) / size;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx2 = x + dx;
      const ny2 = y + dy;
      if (!inb(nx2, ny2)) continue;
      const j = idx(nx2, ny2);
      if (roadDist[j] >= 0 || !BUILDABLE.has(kind[j])) continue;
      roadDist[j] = roadDist[cur] + 1;
      roadNear[j] = roadNear[cur];
      queue.push(j);
    }
  }
  // seeds by dart throwing: dense near the tower and towns, sparse in the countryside
  const sizeN = valueNoise(seed + 233);
  const seeds: { i: number; r: number }[] = [];
  const grid = new Map<number, number[]>();
  const cell = 6;
  const cellKey = (x: number, y: number) => Math.floor(x / cell) * 10000 + Math.floor(y / cell);
  const buildable: number[] = [];
  for (let i = 0; i < N; i++) if (roadDist[i] > 0) buildable.push(i);
  for (let s = buildable.length - 1; s > 0; s--) {
    const j = Math.floor(rand() * (s + 1));
    [buildable[s], buildable[j]] = [buildable[j], buildable[s]];
  }
  for (const i of buildable) {
    const x = i % size;
    const y = (i - x) / size;
    const dTower = dist2c(x, y);
    let dTown = Infinity;
    for (const d of districts) if (!d.capital) dTown = Math.min(dTown, Math.hypot(d.x - x, d.y - y));
    const urban = Math.max(Math.exp(-((dTower / 30) ** 2)), 0.7 * Math.exp(-((dTown / 14) ** 2)));
    const variety = 0.55 + (sizeN(x / 7, y / 7) + 1) * 0.6 + rand() * 0.5; // big and small plots side by side
    const r = (1.15 + (1 - urban) * 2.3) * variety;
    const cx = Math.floor(x / cell);
    const cy = Math.floor(y / cell);
    let ok = true;
    for (let gx = cx - 2; gx <= cx + 2 && ok; gx++)
      for (let gy = cy - 2; gy <= cy + 2 && ok; gy++) {
        const list = grid.get(gx * 10000 + gy);
        if (!list) continue;
        for (const si of list) {
          const sx2 = seeds[si].i % size;
          const sy2 = Math.floor(seeds[si].i / size);
          if (Math.hypot(sx2 - x, sy2 - y) < Math.min(r, seeds[si].r) * 1.1) {
            ok = false;
            break;
          }
        }
      }
    if (!ok) continue;
    const key = cellKey(x, y);
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key)!.push(seeds.length);
    seeds.push({ i, r });
  }
  // grow plots with randomised Dijkstra: organic, irregular borders
  const cost = new Float64Array(N).fill(Infinity);
  const owner = new Int32Array(N).fill(-1);
  const heap = new MinHeap();
  seeds.forEach((s, n) => {
    cost[s.i] = 0;
    owner[s.i] = n;
    heap.push(0, s.i);
  });
  const tileW = new Float32Array(N);
  for (let i = 0; i < N; i++) tileW[i] = 1 + rand() * 1.1;
  while (heap.size) {
    const cur = heap.pop();
    const o = owner[cur];
    const x = cur % size;
    const y = (cur - x) / size;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx2 = x + dx;
      const ny2 = y + dy;
      if (!inb(nx2, ny2)) continue;
      const j = idx(nx2, ny2);
      if (roadDist[j] <= 0) continue;
      const c = cost[cur] + tileW[j];
      if (c > seeds[o].r * 2.2) continue; // plots do not sprawl forever
      if (c < cost[j]) {
        cost[j] = c;
        owner[j] = o;
        heap.push(c, j);
      }
    }
  }
  const groups = new Map<number, number[]>();
  for (let i = 0; i < N; i++) {
    const o = owner[i];
    if (o < 0 || roadDist[i] <= 0) continue;
    if (!groups.has(o)) groups.set(o, []);
    groups.get(o)!.push(i);
  }

  // frontage: the plot tile closest to a street names the address
  type Draft = { tiles: number[]; road: number; along: number; side: number };
  const drafts: Draft[] = [];
  for (const tiles of groups.values()) {
    if (tiles.length < 2) continue;
    let front = tiles[0];
    for (const t of tiles) if (roadDist[t] < roadDist[front]) front = t;
    if (roadDist[front] > 2) continue; // must touch (or almost touch) a street
    const rt = roadNear[front];
    const road = roadOf[rt];
    if (road < 0) continue;
    const rx = rt % size;
    const ry = (rt - rx) / size;
    // position along the street, and which side of it the plot lies on
    const path = roadPaths[road];
    const pi = roadIdx[rt];
    const a = path[Math.max(0, pi - 1)];
    const b = path[Math.min(path.length - 1, pi + 1)];
    const dx = (b % size) - (a % size);
    const dy = Math.floor(b / size) - Math.floor(a / size);
    const fx = front % size;
    const fy = (front - fx) / size;
    const cross = dx * (fy - ry) - dy * (fx - rx);
    drafts.push({ tiles, road, along: pi + (cross > 0 ? 0.5 : 0), side: cross > 0 ? 1 : 0 });
  }
  const plots: Plot[] = [];
  const byRoad = new Map<number, Draft[]>();
  for (const d of drafts) {
    if (!byRoad.has(d.road)) byRoad.set(d.road, []);
    byRoad.get(d.road)!.push(d);
  }
  const waterSet = new Set<number>([K.deep, K.ocean, K.shallow, K.lake, K.river]);
  for (const [road, list] of [...byRoad.entries()].sort((a, b) => a[0] - b[0])) {
    list.sort((a, b) => a.along - b.along);
    let odd = 1;
    let even = 2;
    for (const d of list) {
      const number = d.side ? even : odd;
      if (d.side) even += 2;
      else odd += 2;
      const id = plots.length;
      let sx = 0;
      let sy = 0;
      let waterView = false;
      const counts: Record<string, number> = {};
      for (const t of d.tiles) {
        plotOf[t] = id;
        const x = t % size;
        const y = (t - x) / size;
        sx += x;
        sy += y;
        const kk = KINDS[kind[t]];
        counts[kk] = (counts[kk] ?? 0) + 1;
        if (!waterView)
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [0, 2], [-2, 0], [0, -2]]) {
            if (inb(x + dx, y + dy) && waterSet.has(kind[idx(x + dx, y + dy)])) {
              waterView = true;
              break;
            }
          }
      }
      const cx = sx / d.tiles.length;
      const cy = sy / d.tiles.length;
      let anchor = { x: Math.round(cx), y: Math.round(cy) };
      let bd = Infinity;
      for (const t of d.tiles) {
        const x = t % size;
        const y = (t - x) / size;
        const dd = (x - cx) ** 2 + (y - cy) ** 2;
        if (dd < bd) {
          bd = dd;
          anchor = { x, y };
        }
      }
      const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
      const landscape: Plot["landscape"] = top === "forest" ? "forest" : top === "hill" ? "hillside" : top === "beach" ? "beachfront" : "meadow";
      plots.push({
        id,
        address: `${number} ${roads[road].name}`,
        number,
        road,
        district: district[idx(anchor.x, anchor.y)],
        tiles: d.tiles,
        anchor,
        landscape,
        waterView,
        distance: Math.hypot(cx - center, cy - center),
      });
    }
  }

  // --- stats --------------------------------------------------------------------------------
  let roadTiles = 0;
  let bridgeTiles = 0;
  let landTiles = 0;
  for (let i = 0; i < N; i++) {
    const k = kind[i];
    if (k === K.road || k === K.street) roadTiles++;
    if (k === K.bridge || k === K.railbridge) bridgeTiles++;
    if (!isWater(k) && k !== K.pier && k !== K.bridge && k !== K.railbridge) landTiles++;
  }
  railTiles = 0;
  for (let i = 0; i < N; i++) if (kind[i] === K.rail || kind[i] === K.railbridge || kind[i] === K.station) railTiles++;
  // water tiles take the district of the nearest land for nothing else; keep -1 for open water
  for (let i = 0; i < N; i++) if (isWater(kind[i]) && kind[i] !== K.river && kind[i] !== K.lake) district[i] = -1;

  return {
    params,
    size,
    center,
    kind,
    height,
    district,
    plotOf,
    roadOf,
    districts,
    roads,
    plots,
    airports,
    stations,
    stats: { roadTiles, railTiles, bridgeTiles, riverTiles, landTiles },
  };
}

export function findPlotByAddress(world: World, query: string): Plot | undefined {
  const q = query.trim().toLowerCase().replace(/\s+/g, " ");
  const m = q.match(/^(\d+)\s+(.+)$/);
  if (!m) return undefined;
  const num = Number(m[1]);
  const street = m[2];
  return world.plots.find((p) => p.number === num && world.roads[p.road].name.toLowerCase() === street);
}
