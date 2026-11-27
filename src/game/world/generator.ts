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
import { streetNamer } from "./names";
import { BIOMES, REGIONS, region, type Biome, type RegionSpec } from "./regions";
import { EXPANSIONS, LATE_FROM, MARGIN } from "./expansions";
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

export { BIOMES, type Biome } from "./regions";

export interface WorldParams {
  seed: number;
  size: number;
  /** Side of the square that holds the main continent; the rest of the map is open sea and Oceania. */
  landSize: number;
  districts: number;
  /** Island districts of Oceania, an archipelago south-east of the continent. */
  oceania: number;
  rivers: number;
  airports: number;
  /** How many lands from expansions.ts to raise (default: all). Earlier lands never change when later ones are added. */
  lands?: number;
}

export const DEFAULT_WORLD: WorldParams = { seed: 20261122, size: 440, landSize: 320, districts: 30, oceania: 4, rivers: 24, airports: 2 };

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
  /**
   * Postal address: "12 Coral Street" on a street, "Isle 7, Pearl Atolls" for an island of its own,
   * "Lot 4, Driftstone Isles" for land away from the streets, "Water Plot 27-14" for water.
   */
  address: string;
  number: number;
  /** Street of the address, -1 for an island plot. */
  road: number;
  district: number;
  tiles: number[];
  anchor: { x: number; y: number };
  /** Main landscape of the plot. */
  landscape: "meadow" | "forest" | "hillside" | "beachfront" | "island" | "mountain" | WaterLandscape;
  waterView: boolean;
  /** A plot of water (sea, lagoon or lake), not of land. */
  water: boolean;
  /** Straight-line distance to the tower in tiles. */
  distance: number;
}

export type WaterLandscape = "lagoon" | "shallows" | "sea" | "deepSea" | "lake";

/** Side of a water plot in tiles: the sea is cut on a fixed grid, so a water plot keeps its address as the world grows. */
export const WATER_CELL = 8;

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
  /** 0 the continent, 1 Oceania (sea and islands), 2 and up a land from expansions.ts. */
  zone: Uint8Array;
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
  /** Lands added later (expansions.ts): their zone value, whether their sea is lagoon-coloured, and their districts. */
  expansions: { name: string; zone: number; lagoon: boolean; districts: number[] }[];
}

export const kindName = (w: World, i: number): Kind => KINDS[w.kind[i]];

const WATER = new Set<number>([K.deep, K.ocean, K.shallow, K.lake, K.river]);
const isWater = (k: number) => WATER.has(k);
const BUILDABLE = new Set<number>([K.land, K.forest, K.hill, K.beach]);
const ROADLIKE = new Set<number>([K.road, K.street, K.bridge, K.plaza]);

export function generateWorld(params: WorldParams = DEFAULT_WORLD): World {
  const { size, seed } = params;
  const L = params.landSize;
  const N = size * size;
  // the continent keeps its shape whatever the map size; extra room goes to the south-east sea
  const off = Math.min(10, Math.floor((size - L) / 2));
  const center = Math.floor(L / 2) + off;
  const zone = new Uint8Array(N);
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
  // Oceania: a wide lagoon of countless small islands, a few larger ones and atolls
  const oceRand = rng(seed + 89);
  const OCE = { x: 1.2, y: 1.18, r: 0.5 };
  const oceWarp = fbm(seed + 91, 3);
  const isle = valueNoise(seed + 93);
  const isle2 = valueNoise(seed + 95);
  // larger islands of four kinds: mountainous, flat, forested and ring-shaped atolls
  const bigIsles = Array.from({ length: 16 }, (_, k) => {
    const a = oceRand() * Math.PI * 2;
    const r = Math.sqrt(oceRand()) * OCE.r * 0.82;
    const type = (["mountain", "flat", "forest", "atoll"] as const)[k % 4];
    const s = 0.02 + oceRand() * 0.035;
    const h = type === "mountain" ? 0.6 + oceRand() * 0.35 : type === "flat" ? 0.09 + oceRand() * 0.05 : type === "forest" ? 0.2 + oceRand() * 0.12 : 0.1;
    return { x: OCE.x + Math.cos(a) * r, y: OCE.y + Math.sin(a) * r, s, h, atoll: type === "atoll" };
  });
  const oceMask = new Float32Array(N);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = ((x - off) / L) * 2 - 1;
      const ny = ((y - off) / L) * 2 - 1;
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
      h += detail((x - off) / 6, (y - off) / 6) * 0.025;
      if (params.oceania > 0) {
        const od = Math.hypot((nx - OCE.x) * 1.15, ny - OCE.y) + oceWarp(nx * 2.5, ny * 2.5) * 0.12;
        const m = Math.min(1, Math.max(0, (OCE.r - od) / 0.12));
        if (m > 0) {
          oceMask[idx(x, y)] = m;
          // a shallow shelf; small islands where fine noise peaks, denser towards the middle
          const t = isle(x / 3.2, y / 3.2) * 0.65 + isle2(x / 9, y / 9) * 0.35;
          const thr = 0.42 - 0.12 * m;
          let oh = t > thr ? 0.004 + (t - thr) * 0.5 : -0.02 - (thr - t) * 0.08;
          for (const b of bigIsles) {
            const di = Math.hypot(nx - b.x, ny - b.y);
            const bump = b.atoll ? Math.exp(-(((di - b.s * 1.4) / (b.s * 0.45)) ** 2)) : Math.exp(-((di / b.s) ** 2));
            if (bump > 0.1) oh = Math.max(oh, b.h * bump - 0.04 + isle(x / 4, y / 4) * 0.03);
          }
          h = h * (1 - m) + Math.max(h, oh) * m;
        }
      }
      // flat, safe ground for the capital around the tower
      const dc = Math.hypot(nx, ny);
      if (oceMask[idx(x, y)] > 0.3) zone[idx(x, y)] = 1;
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
  const districts: District[] = [{ id: 0, name: REGIONS.metropolis.names[0], biome: "metropolis", x: center, y: center, capital: true }];
  const landCandidates: number[] = [];
  // continental towns, in the continent's own tile order so the mainland is the same at any map size
  for (let ly = 0; ly < L; ly++)
    for (let lx = 0; lx < L; lx++) {
      const i = idx(lx + off, ly + off);
      if (height[i] > 0.03 && height[i] < 0.5 && !zone[i]) landCandidates.push(i);
    }
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
    const lat = ((d.y - off) / L) * 2 - 1; // -1 north … 1 south
    const m = moist(((d.x - off) / L) * 3, ((d.y - off) / L) * 3);
    const alt = height[idx(d.x, d.y)];
    return { d, lat, m, alt };
  });
  // Each district ranks the climates that fit its latitude, moisture and altitude;
  // a cap per climate keeps the world varied (frozen north next to jungle and dunes).
  const cap = Math.ceil((districts.length - 1) / 7);
  const count: Partial<Record<Biome, number>> = {};
  const site = (s: (typeof scored)[number]) => ({ lat: s.lat, moist: s.m, alt: s.alt, dist: Math.hypot(s.d.x - center, s.d.y - center) });
  const taken = new Set<(typeof scored)[number]>();
  // landmark districts first, in table order: each takes the best-scoring free sites
  for (const b of BIOMES) {
    const lm = (region(b) as RegionSpec).landmark;
    if (!lm) continue;
    const ranked = scored
      .filter((s) => !taken.has(s))
      .map((s) => ({ s, v: lm.score(site(s)) }))
      .filter((o) => o.v > -Infinity)
      .sort((a, c) => c.v - a.v)
      .slice(0, lm.count);
    for (const { s } of ranked) {
      s.d.biome = b;
      taken.add(s);
      count[b] = (count[b] ?? 0) + 1;
    }
  }
  // the rest share out the climates by fit, with a cap per climate so the world stays varied
  const climates = BIOMES.filter((b) => (region(b) as RegionSpec).fit);
  for (const s of [...scored].sort(() => rand() - 0.5)) {
    if (taken.has(s)) continue;
    const prefs = climates.map((b) => ({ b, v: (region(b) as RegionSpec).fit!(site(s)) + rand() * 0.25 })).sort((a, c) => c.v - a.v);
    const pick = prefs.find((p) => (count[p.b] ?? 0) < cap) ?? prefs[0];
    s.d.biome = pick.b;
    count[pick.b] = (count[pick.b] ?? 0) + 1;
  }
  for (const d of districts.slice(1)) {
    const list = REGIONS[d.biome].names;
    const n = used[d.biome] ?? 0;
    used[d.biome] = n + 1;
    d.name = n < list.length ? list[n] : `${list[n % list.length]} ${["East", "West", "North", "South"][Math.floor(n / list.length) % 4]}`;
  }
  // Oceania's island towns, on its larger islands
  const oceaniaFrom = districts.length;
  {
    const cands: number[] = [];
    for (let i = 0; i < N; i++) if (zone[i] && height[i] > 0.04) cands.push(i);
    for (let tries = 0; tries < 4000 && districts.length - oceaniaFrom < params.oceania && cands.length; tries++) {
      const i = cands[Math.floor(rand() * cands.length)];
      const x = i % size;
      const y = (i - x) / size;
      if (districts.some((d) => Math.hypot(d.x - x, d.y - y) < 26)) continue;
      const k = districts.length - oceaniaFrom;
      const names = REGIONS.oceania.names;
      districts.push({ id: districts.length, name: names[k % names.length], biome: "oceania", x, y, capital: false });
    }
  }
  // assign tiles: nearest centre in a noise-warped metric, so borders are irregular
  const bx = fbm(seed + 131, 3);
  const by = fbm(seed + 137, 3);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = idx(x, y);
      if (height[i] < 0) continue;
      const px = x + bx((x - off) / 35, (y - off) / 35) * 24;
      const py = y + by((x - off) / 35, (y - off) / 35) * 24;
      let best = 0;
      let bd = Infinity;
      for (const d of districts) {
        if ((d.biome === "oceania") !== (zone[i] === 1) && districts.length > oceaniaFrom) continue;
        const dd = (d.x - px) ** 2 + (d.y - py) ** 2;
        // regions with a small "area" factor claim more ground (capital, great forest, great desert…)
        const weight = region(d.biome).area;
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
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = idx(x, y);
      if (kind[i] !== K.land && kind[i] !== K.hill) continue;
      if (dist2c(x, y) < 18) continue;
      if (forestN((x - off) / 22, (y - off) / 22) > region(biomeAt(i)).forest) kind[i] = K.forest;
    }
  }

  // --- 4. lakes -------------------------------------------------------------------------
  const lakeN = fbm(seed + 173, 3);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = idx(x, y);
      const k = kind[i];
      if ((k !== K.land && k !== K.forest) || zone[i] || height[i] < 0.08 || height[i] > 0.38 || dist2c(x, y) < 24) continue;
      const bonus = region(biomeAt(i)).lakes;
      if (lakeN((x - off) / 14, (y - off) / 14) + bonus > 0.5) kind[i] = K.lake;
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
  // the airport district gets the big international airport, the others a regional one
  const hub = districts.find((d) => d.biome === "airport");
  for (let a = 0; a < params.airports; a++) {
    const RUNWAY = a === 0 && hub ? 34 : 22;
    let best: { x: number; y: number; horiz: boolean; score: number } | null = null;
    for (let tries = 0; tries < 5000; tries++) {
      // the hub airport scans every spot around its district's town; regional ones search at random
      const HUB_SPOTS = 31 * 31 * 2;
      if (a === 0 && hub && tries === HUB_SPOTS && best) break;
      const atHub = a === 0 && !!hub && tries < HUB_SPOTS;
      let horiz = rand() < 0.5;
      let x0 = Math.floor(rand() * (size - RUNWAY - 8)) + 4;
      let y0 = Math.floor(rand() * (size - RUNWAY - 8)) + 4;
      if (atHub && hub) {
        horiz = tries % 2 === 0;
        const cell = Math.floor(tries / 2);
        x0 = hub.x - Math.floor(RUNWAY / 2) + ((cell % 31) - 15) * 2;
        y0 = hub.y - Math.floor(RUNWAY / 2) + (Math.floor(cell / 31) - 15) * 2;
        if (x0 < 4 || y0 < 4 || x0 + RUNWAY + 4 > size || y0 + RUNWAY + 4 > size) continue;
        if (Math.hypot(x0 + RUNWAY / 2 - hub.x, y0 + RUNWAY / 2 - hub.y) < 6) continue; // leave the town square
      }
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
          if (!(k === K.land || k === K.forest || k === K.beach || (atHub && (k === K.hill || k === K.river)))) {
            ok = false;
            break;
          }
          const hh = height[idx(x, y)];
          hs += hh;
          hmin = Math.min(hmin, hh);
          hmax = Math.max(hmax, hh);
        }
      if (!ok || hmax - hmin > (atHub ? 0.3 : 0.2)) continue;
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
        kind[i] = b2 < 2 ? K.runway : b2 >= 3 && Math.abs(a2 - RUNWAY / 2) < (RUNWAY > 30 ? 7 : 3) ? (b2 >= 4 ? K.terminal : K.apron) : K.apron;
      }
    const ax = horiz ? x0 + RUNWAY / 2 : x0 + 5;
    const ay = horiz ? y0 + 5 : y0 + RUNWAY / 2;
    const did = district[idx(ax, ay)];
    airports.push({ name: `${districts[did]?.name ?? "AquaTerra"} ${a === 0 && hub ? "International Airport" : "Airport"}`, x: ax, y: ay, district: did });
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
    const j = 1 + (jitter((x - off) / 5, (y - off) / 5) + 1) * 0.35;
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
  // (a function, so that new lands can grow their own plots with their own random numbers)
  const plots: Plot[] = [];
  const makePlots = (pr: () => number, inArea: (i: number) => boolean) => {
    // distance from streets through buildable land
    const MAXDEPTH = 6;
    const roadDist = new Int16Array(N).fill(-1);
    const roadNear = new Int32Array(N).fill(-1); // nearest road tile
    const queue: number[] = [];
    for (let i = 0; i < N; i++)
      if (inArea(i) && (kind[i] === K.road || kind[i] === K.street)) {
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
    for (let i = 0; i < N; i++) if (roadDist[i] > 0 && inArea(i)) buildable.push(i);
    for (let s = buildable.length - 1; s > 0; s--) {
      const j = Math.floor(pr() * (s + 1));
      [buildable[s], buildable[j]] = [buildable[j], buildable[s]];
    }
    for (const i of buildable) {
      const x = i % size;
      const y = (i - x) / size;
      const dTower = dist2c(x, y);
      let dTown = Infinity;
      for (const d of districts) if (!d.capital) dTown = Math.min(dTown, Math.hypot(d.x - x, d.y - y));
      const urban = Math.max(Math.exp(-((dTower / 30) ** 2)), 0.7 * Math.exp(-((dTown / 14) ** 2)));
      const variety = 0.55 + (sizeN((x - off) / 7, (y - off) / 7) + 1) * 0.6 + pr() * 0.5; // big and small plots side by side
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
    for (let i = 0; i < N; i++) if (inArea(i)) tileW[i] = 1 + pr() * 1.1;
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
          water: false,
          distance: Math.hypot(cx - center, cy - center),
        });
      }
    }
  };
  makePlots(rand, () => true);

  // --- 12. Oceania: every small island without a plot is a plot of its own ------------------
  const makeIsles = (inArea: (i: number) => boolean) => {
    const isleCount = new Map<number, number>();
    const seenIsle = new Uint8Array(N);
    for (let i0 = 0; i0 < N; i0++) {
      if (!inArea(i0) || seenIsle[i0] || plotOf[i0] >= 0 || !BUILDABLE.has(kind[i0])) continue;
      const comp: number[] = [i0];
      seenIsle[i0] = 1;
      for (let q = 0; q < comp.length; q++) {
        const x = comp[q] % size;
        const y = (comp[q] - x) / size;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          if (!inb(x + dx, y + dy)) continue;
          const j = idx(x + dx, y + dy);
          if (seenIsle[j] || plotOf[j] >= 0 || !BUILDABLE.has(kind[j])) continue;
          seenIsle[j] = 1;
          comp.push(j);
        }
      }
      if (comp.length < 2 || comp.length > 40) continue;
      let sx = 0;
      let sy = 0;
      for (const t of comp) {
        sx += t % size;
        sy += Math.floor(t / size);
      }
      const cx = sx / comp.length;
      const cy = sy / comp.length;
      const anchorT = comp.reduce((a, t) => (Math.hypot((t % size) - cx, Math.floor(t / size) - cy) < Math.hypot((a % size) - cx, Math.floor(a / size) - cy) ? t : a));
      const dId = district[anchorT];
      const number = (isleCount.get(dId) ?? 0) + 1;
      isleCount.set(dId, number);
      const id = plots.length;
      for (const t of comp) plotOf[t] = id;
      plots.push({
        id,
        address: `Isle ${number}, ${districts[dId]?.name ?? "Isles"}`,
        number,
        road: -1,
        district: dId,
        tiles: comp,
        anchor: { x: anchorT % size, y: Math.floor(anchorT / size) },
        landscape: "island",
        waterView: true,
        water: false,
        distance: Math.hypot(cx - center, cy - center),
      });
    }
  };
  makeIsles((i) => zone[i] === 1);

  // --- 13. new lands --------------------------------------------------------------------------
  const expansions = growLands();

  // New lands from expansions.ts, raised out of open sea after the whole world above is built.
  // Each uses only its own random numbers and touches only open sea, so nothing that already
  // existed changes: same tiles, districts, roads and plot addresses.
  function growLands(): World["expansions"] {
    const out: World["expansions"] = [];
    EXPANSIONS.slice(0, Math.min(LATE_FROM, params.lands ?? EXPANSIONS.length)).forEach((ex, k) => {
      const z = 2 + k;
      const er = rng((seed ^ (ex.seed * 2654435761)) >>> 0);
      const [x0, y0, x1, y1] = ex.area.map((v) => Math.max(0, Math.min(size - 1, v)));
      if (x1 - x0 < 24 || y1 - y0 < 24) return;
      const isOld = (i: number) => zone[i] !== 0 || (kind[i] !== K.deep && kind[i] !== K.ocean);
      // open sea kept around everything that already exists
      const near = new Int16Array(N).fill(-1);
      const q: number[] = [];
      for (let y = Math.max(0, y0 - MARGIN); y <= Math.min(size - 1, y1 + MARGIN); y++)
        for (let x = Math.max(0, x0 - MARGIN); x <= Math.min(size - 1, x1 + MARGIN); x++)
          if (isOld(idx(x, y))) {
            near[idx(x, y)] = 0;
            q.push(idx(x, y));
          }
      for (let h = 0; h < q.length; h++) {
        const cur = q[h];
        if (near[cur] >= MARGIN) continue;
        const x = cur % size;
        const y = (cur - x) / size;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
          if (!inb(x + dx, y + dy)) continue;
          const j = idx(x + dx, y + dy);
          if (near[j] >= 0) continue;
          near[j] = near[cur] + 1;
          q.push(j);
        }
      }
      const free = (i: number) => near[i] < 0;
      const inArea = (i: number) => zone[i] === z;

      // 1. shape: one ragged island, or an archipelago of islets and larger islands
      const S = ex.seed * 17;
      const base = fbm(S + 1, 5);
      const warpA = fbm(S + 2, 3);
      const warpB = fbm(S + 3, 3);
      const hills = ridged(S + 4, 4);
      const fine = valueNoise(S + 5);
      const fine2 = valueNoise(S + 6);
      const cx = (x0 + x1) / 2;
      const cy = (y0 + y1) / 2;
      const hw = (x1 - x0) / 2;
      const hh = (y1 - y0) / 2;
      const bigs = Array.from({ length: ex.shape === "archipelago" ? 18 : 0 }, (_, b) => {
        const type = (["mountain", "flat", "forest", "mountain", "atoll"] as const)[b % 5];
        const s = 3.5 + er() * 7;
        return {
          x: cx + (er() * 2 - 1) * hw * 0.72,
          y: cy + (er() * 2 - 1) * hh * 0.78,
          s,
          h: type === "mountain" ? 0.62 + er() * 0.36 : type === "flat" ? 0.1 + er() * 0.06 : type === "forest" ? 0.22 + er() * 0.14 : 0.1,
          atoll: type === "atoll",
        };
      });
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          const i = idx(x, y);
          if (!free(i)) continue;
          const u = (x - cx) / hw;
          const v = (y - cy) / hh;
          const od = Math.hypot(u, v) + warpA(u * 2.2, v * 2.2) * 0.14;
          const m = Math.min(1, Math.max(0, (0.98 - od) / 0.16));
          if (m <= 0) continue;
          let h: number;
          if (ex.shape === "island") {
            const wu = u + 0.3 * warpA(u * 1.6 + 4, v * 1.6 + 4);
            const wv = v + 0.3 * warpB(u * 1.6 - 6, v * 1.6 - 6);
            const d = Math.hypot(wu, wv);
            h = base(x / 26, y / 26) * 0.42 + 0.3 - 0.55 * d * d + fine(x / 5, y / 5) * 0.03;
            if (h > 0) h = 0.04 + h * 0.75 + Math.pow(hills(x / 30, y / 30), 3) * 0.16 * Math.min(1, h * 5);
            h = Math.min(h, 0.5);
            h = h * m - 0.2 * (1 - m);
          } else {
            const t = fine(x / 3.2, y / 3.2) * 0.65 + fine2(x / 9, y / 9) * 0.35;
            const thr = 0.42 - 0.12 * m;
            h = t > thr ? 0.004 + (t - thr) * 0.5 : -0.02 - (thr - t) * 0.08;
            const px = x + warpA(x / 12, y / 12) * 3.5;
            const py = y + warpB(x / 12, y / 12) * 3.5;
            for (const b of bigs) {
              const di = Math.hypot(px - b.x, py - b.y);
              const bump = b.atoll ? Math.exp(-(((di - b.s * 1.4) / (b.s * 0.45)) ** 2)) : Math.exp(-((di / b.s) ** 2));
              if (bump > 0.1) h = Math.max(h, b.h * bump - 0.04 + fine(x / 4, y / 4) * 0.03);
            }
            if (m < 1) h = Math.min(h, -0.02 - (1 - m) * 0.1);
          }
          if (ex.lagoon && m > 0.3) zone[i] = z;
          if (h <= -0.045) continue;
          height[i] = h;
          kind[i] = h < 0 ? K.shallow : h < 0.035 ? K.beach : h > 0.72 ? K.peak : h > 0.55 ? K.mountain : h > 0.4 ? K.hill : K.land;
          zone[i] = z;
        }
      // a shallow rim around every new coast
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          const i = idx(x, y);
          if (!free(i) || kind[i] !== K.ocean && kind[i] !== K.deep) continue;
          if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => inb(x + dx, y + dy) && zone[idx(x + dx, y + dy)] === z && height[idx(x + dx, y + dy)] >= 0)) {
            kind[i] = K.shallow;
            height[i] = -0.01;
            zone[i] = z;
          }
        }

      // 2. districts, with names that carry on each region's list
      const first = districts.length;
      const cands: number[] = [];
      let land = 0;
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          const i = idx(x, y);
          if (!inArea(i) || height[i] < 0) continue;
          land++;
          if (height[i] > 0.04 && height[i] < 0.5 && BUILDABLE.has(kind[i])) cands.push(i);
        }
      const minD = Math.max(14, Math.sqrt(land / Math.max(1, ex.districts.length)) * 0.7);
      for (let tries = 0; tries < 6000 && districts.length - first < ex.districts.length && cands.length; tries++) {
        const i = cands[Math.floor(er() * cands.length)];
        const x = i % size;
        const y = (i - x) / size;
        if (districts.slice(first).some((d) => Math.hypot(d.x - x, d.y - y) < minD)) continue;
        const b = ex.districts[districts.length - first];
        const list = REGIONS[b].names;
        let name = "";
        for (let n = used[b] ?? 0; ; n++) {
          name = n < list.length ? list[n] : `${list[n % list.length]} ${["East", "West", "North", "South"][Math.floor(n / list.length) % 4]}`;
          used[b] = n + 1;
          if (!districts.some((d) => d.name === name)) break;
        }
        districts.push({ id: districts.length, name, biome: b, x, y, capital: false });
      }
      const mine = districts.slice(first);
      if (!mine.length) return;
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          const i = idx(x, y);
          if (!inArea(i) || height[i] < 0 && kind[i] !== K.shallow) continue;
          const px = x + bx((x - off) / 35, (y - off) / 35) * 24;
          const py = y + by((x - off) / 35, (y - off) / 35) * 24;
          let best = mine[0].id;
          let bd = Infinity;
          for (const d of mine) {
            const dd = ((d.x - px) ** 2 + (d.y - py) ** 2) * region(d.biome).area;
            if (dd < bd) {
              bd = dd;
              best = d.id;
            }
          }
          district[i] = best;
        }

      // 3. forests, lakes and marsh ponds
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          const i = idx(x, y);
          if (!inArea(i) || (kind[i] !== K.land && kind[i] !== K.hill)) continue;
          const spec = region(districts[district[i]].biome);
          if (forestN((x - off) / 22, (y - off) / 22) > spec.forest) kind[i] = K.forest;
          if (!ex.lagoon && height[i] > 0.06 && height[i] < 0.38 && lakeN((x - off) / 14, (y - off) / 14) + spec.lakes > 0.5) kind[i] = K.lake;
        }
      for (const d of mine)
        for (let y = d.y - 1; y <= d.y + 1; y++) for (let x = d.x - 1; x <= d.x + 1; x++) if (inb(x, y) && !isWater(kind[idx(x, y)])) kind[idx(x, y)] = K.plaza;

      // 4. roads: highways between the towns, a bridge to the old world, streets around each town
      const own = (c: (i: number) => number) => (i: number) => (inArea(i) ? c(i) : Infinity);
      const inTree2 = new Set<number>([0]);
      while (inTree2.size < mine.length) {
        let pair: [number, number] | null = null;
        let bd = Infinity;
        for (const a of inTree2)
          for (let b = 0; b < mine.length; b++) {
            if (inTree2.has(b)) continue;
            const dd = Math.hypot(mine[a].x - mine[b].x, mine[a].y - mine[b].y);
            if (dd < bd) {
              bd = dd;
              pair = [a, b];
            }
          }
        if (!pair) break;
        inTree2.add(pair[1]);
        const p = astar(idx(mine[pair[0]].x, mine[pair[0]].y), idx(mine[pair[1]].x, mine[pair[1]].y), own(roadCost));
        if (p) layRoad(p, "highway");
      }
      {
        // the nearest town to an existing road gets a long bridge over the sea to it
        let link: { from: number; to: number; dd: number } | null = null;
        for (let i = 0; i < N; i++) {
          if (zone[i] !== 0 || (kind[i] !== K.road && kind[i] !== K.bridge)) continue;
          const x = i % size;
          const y = (i - x) / size;
          for (const d of mine) {
            const dd = Math.hypot(d.x - x, d.y - y);
            if (!link || dd < link.dd) link = { from: idx(d.x, d.y), to: i, dd };
          }
        }
        if (link) {
          const linkCost = (i: number) => {
            if (inArea(i)) return roadCost(i);
            const k2 = kind[i];
            if (k2 === K.road || k2 === K.bridge) return 0.3;
            return k2 === K.deep || k2 === K.ocean || k2 === K.shallow ? roadCost(i) : Infinity;
          };
          const p = astar(link.from, link.to, linkCost);
          if (p) layRoad(p, "highway", `${ex.name} Bridge`);
        }
      }
      for (const d of mine)
        for (let s = 0; s < 14; s++) {
          const ang = er() * Math.PI * 2;
          const r = 18 * (0.45 + er() * 0.55);
          const tx2 = Math.round(d.x + Math.cos(ang) * r);
          const ty2 = Math.round(d.y + Math.sin(ang) * r);
          if (!inb(tx2, ty2)) continue;
          const t = idx(tx2, ty2);
          if (!inArea(t) || !BUILDABLE.has(kind[t])) continue;
          const p = astar(idx(d.x, d.y), t, own(streetCost));
          if (p) layRoad(p, "street");
        }

      // 5. plots along the new streets, and islands of their own
      makePlots(er, inArea);
      makeIsles(inArea);
      out.push({ name: ex.name, zone: z, lagoon: !!ex.lagoon, districts: mine.map((d) => d.id) });
    });
    return out;
  }

  // --- 14. the rest of the land: lots away from the streets -----------------------------------
  // Every bit of land without a plot yet (open country, big islands, hills and mountains) is cut
  // into lots, zone by zone, each zone with its own random numbers. These come after every
  // street plot and island, so no earlier plot changes its id or address.
  const LOT_KINDS = new Set<number>([K.land, K.forest, K.hill, K.beach, K.mountain, K.peak]);
  const MOUNTAIN = new Set<number>([K.mountain, K.peak]);
  const lotCount = new Map<number, number>();
  const makeLots = (z: number) => {
    const pr = rng((seed ^ Math.imul(z + 1, 0x9e3779b1) ^ 0x5bd1e995) >>> 0);
    const cand: number[] = [];
    for (let i = 0; i < N; i++) if (zone[i] === z && plotOf[i] < 0 && LOT_KINDS.has(kind[i]) && district[i] >= 0) cand.push(i);
    if (!cand.length) return;
    const owner = new Int32Array(N).fill(-2);
    for (const i of cand) owner[i] = -1;
    const tileW = new Float32Array(N);
    for (const i of cand) tileW[i] = 1 + pr() * 1.1;
    const cost = new Float64Array(N).fill(Infinity);
    const seeds: { i: number; r: number }[] = [];
    let pending = cand;
    while (pending.length) {
      // seeds by dart throwing; leftovers of a round become seeds of the next one
      for (let s = pending.length - 1; s > 0; s--) {
        const j = Math.floor(pr() * (s + 1));
        [pending[s], pending[j]] = [pending[j], pending[s]];
      }
      const first = seeds.length;
      const grid = new Map<number, number[]>();
      const cell = 8;
      for (const i of pending) {
        const x = i % size;
        const y = (i - x) / size;
        const r = (MOUNTAIN.has(kind[i]) ? 4.6 : 3.3) * (0.75 + pr() * 0.6);
        const cx = Math.floor(x / cell);
        const cy = Math.floor(y / cell);
        let ok = true;
        for (let gx = cx - 1; gx <= cx + 1 && ok; gx++)
          for (let gy = cy - 1; gy <= cy + 1 && ok; gy++)
            for (const si of grid.get(gx * 10000 + gy) ?? []) {
              const t = seeds[si].i;
              if (Math.hypot((t % size) - x, Math.floor(t / size) - y) < Math.min(r, seeds[si].r) * 1.1) {
                ok = false;
                break;
              }
            }
        if (!ok) continue;
        const key = cx * 10000 + cy;
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key)!.push(seeds.length);
        seeds.push({ i, r });
      }
      const heap = new MinHeap();
      for (let n2 = first; n2 < seeds.length; n2++) {
        const t = seeds[n2].i;
        cost[t] = 0;
        owner[t] = n2;
        heap.push(0, t);
      }
      while (heap.size) {
        const cur = heap.pop();
        const o = owner[cur];
        const high = MOUNTAIN.has(kind[seeds[o].i]);
        const x = cur % size;
        const y = (cur - x) / size;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          if (!inb(x + dx, y + dy)) continue;
          const j = idx(x + dx, y + dy);
          if (owner[j] === -2 || (owner[j] >= 0 && owner[j] < first)) continue;
          // lots keep to the lowland or to the mountains
          const c = cost[cur] + tileW[j] * (MOUNTAIN.has(kind[j]) === high ? 1 : 2.5);
          if (c > seeds[o].r * 2.4 || c >= cost[j]) continue;
          cost[j] = c;
          owner[j] = o;
          heap.push(c, j);
        }
      }
      pending = pending.filter((i) => owner[i] === -1);
    }
    const groups = new Map<number, number[]>();
    for (const i of cand) {
      if (!groups.has(owner[i])) groups.set(owner[i], []);
      groups.get(owner[i])!.push(i);
    }
    // a lone tile joins a neighbouring lot
    for (const [o, tiles] of groups) {
      if (tiles.length !== 1) continue;
      const t = tiles[0];
      const x = t % size;
      const y = (t - x) / size;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (!inb(x + dx, y + dy)) continue;
        const o2 = owner[idx(x + dx, y + dy)];
        if (o2 < 0 || o2 === o || !groups.get(o2)?.length) continue;
        groups.get(o2)!.push(t);
        owner[t] = o2;
        groups.set(o, []);
        break;
      }
    }
    for (const [, tiles] of [...groups.entries()].sort((a, b) => a[0] - b[0])) {
      if (!tiles.length) continue;
      let sx = 0;
      let sy = 0;
      let waterView = false;
      const counts = new Map<number, number>();
      for (const t of tiles) {
        const x = t % size;
        const y = (t - x) / size;
        sx += x;
        sy += y;
        const k = MOUNTAIN.has(kind[t]) ? K.mountain : kind[t];
        counts.set(k, (counts.get(k) ?? 0) + 1);
        if (!waterView)
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [0, 2], [-2, 0], [0, -2]])
            if (inb(x + dx, y + dy) && isWater(kind[idx(x + dx, y + dy)])) {
              waterView = true;
              break;
            }
      }
      const cx = sx / tiles.length;
      const cy = sy / tiles.length;
      const anchorT = tiles.reduce((a, t) => ((t % size) - cx) ** 2 + (Math.floor(t / size) - cy) ** 2 < ((a % size) - cx) ** 2 + (Math.floor(a / size) - cy) ** 2 ? t : a);
      const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
      const dId = district[anchorT];
      const number = (lotCount.get(dId) ?? 0) + 1;
      lotCount.set(dId, number);
      const id = plots.length;
      for (const t of tiles) plotOf[t] = id;
      plots.push({
        id,
        address: `Lot ${number}, ${districts[dId].name}`,
        number,
        road: -1,
        district: dId,
        tiles,
        anchor: { x: anchorT % size, y: Math.floor(anchorT / size) },
        landscape: top === K.mountain ? "mountain" : top === K.forest ? "forest" : top === K.hill ? "hillside" : top === K.beach ? "beachfront" : "meadow",
        waterView,
        water: false,
        distance: Math.hypot(cx - center, cy - center),
      });
    }
  };
  for (let z = 0; z < 2 + expansions.length; z++) makeLots(z);

  // --- 15. water plots: the sea, lagoons and lakes on a fixed grid ---------------------------
  // A water plot is the water inside one WATER_CELL × WATER_CELL square, named by the square
  // ("Water Plot 27-14"), so it keeps its address whatever else changes. Rivers stay public.
  {
    const lagoonZones = new Set<number>([1, ...expansions.filter((e) => e.lagoon).map((e) => e.zone)]);
    const cols = Math.ceil(size / WATER_CELL);
    const cells = new Map<number, number[]>();
    for (let i = 0; i < N; i++) {
      const k = kind[i];
      if (plotOf[i] >= 0 || (k !== K.deep && k !== K.ocean && k !== K.shallow && k !== K.lake)) continue;
      const x = i % size;
      const y = (i - x) / size;
      const key = (Math.floor(y / WATER_CELL) * cols + Math.floor(x / WATER_CELL)) * 2 + (k === K.lake ? 1 : 0);
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key)!.push(i);
    }
    for (const [key, tiles] of [...cells.entries()].sort((a, b) => a[0] - b[0])) {
      if (tiles.length < 4) continue; // slivers between piers and the shore stay public
      const lake = key % 2 === 1;
      const c = (key - (key % 2)) / 2;
      const col = (c % cols) + 1;
      const row = Math.floor(c / cols) + 1;
      let sx = 0;
      let sy = 0;
      const counts = new Map<number, number>();
      const dCount = new Map<number, number>();
      let lagoon = 0;
      for (const t of tiles) {
        sx += t % size;
        sy += Math.floor(t / size);
        counts.set(kind[t], (counts.get(kind[t]) ?? 0) + 1);
        if (district[t] >= 0) dCount.set(district[t], (dCount.get(district[t]) ?? 0) + 1);
        if (lagoonZones.has(zone[t]) && kind[t] !== K.deep) lagoon++;
      }
      const cx = sx / tiles.length;
      const cy = sy / tiles.length;
      const anchorT = tiles.reduce((a, t) => ((t % size) - cx) ** 2 + (Math.floor(t / size) - cy) ** 2 < ((a % size) - cx) ** 2 + (Math.floor(a / size) - cy) ** 2 ? t : a);
      const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
      const dTop = [...dCount.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
      const landscape: WaterLandscape = lake ? "lake" : lagoon * 2 > tiles.length ? "lagoon" : top === K.shallow ? "shallows" : top === K.ocean ? "sea" : "deepSea";
      const id = plots.length;
      for (const t of tiles) plotOf[t] = id;
      plots.push({
        id,
        address: `${lake ? "Lake" : "Water"} Plot ${col}-${row}`,
        number: col,
        road: -1,
        // shallows and lakes belong to the district on their shore; open sea to none
        district: dTop && dTop[1] * 3 >= tiles.length ? dTop[0] : -1,
        tiles,
        anchor: { x: anchorT % size, y: Math.floor(anchorT / size) },
        landscape,
        waterView: true,
        water: true,
        distance: Math.hypot(cx - center, cy - center),
      });
    }
  }

  // --- 16. late lands: raised after the water plots ------------------------------------------
  // Lands from LATE_FROM on (expansions.ts) rise out of open sea after every plot above exists.
  // They take tiles only from open sea, cut away from the water plots of their squares (each
  // water plot keeps its id, address and at least four tiles of water), and all their own plots
  // come after the last plot that existed before, so no id the server knows ever moves.
  EXPANSIONS.slice(LATE_FROM, Math.max(LATE_FROM, params.lands ?? EXPANSIONS.length)).forEach((ex, j) => {
    const z = 2 + LATE_FROM + j;
    const er = rng((seed ^ (ex.seed * 2654435761)) >>> 0);
    const [x0, y0, x1, y1] = ex.area.map((v) => Math.max(0, Math.min(size - 1, v)));
    if (x1 - x0 < 24 || y1 - y0 < 24) return;
    // open sea kept around everything that already exists (water plots of open sea do not count)
    const isOld = (i: number) => (zone[i] !== 0 && !ex.openSea) || (kind[i] !== K.deep && kind[i] !== K.ocean);
    const near = new Int16Array(N).fill(-1);
    const q: number[] = [];
    for (let y = Math.max(0, y0 - MARGIN); y <= Math.min(size - 1, y1 + MARGIN); y++)
      for (let x = Math.max(0, x0 - MARGIN); x <= Math.min(size - 1, x1 + MARGIN); x++)
        if (isOld(idx(x, y))) {
          near[idx(x, y)] = 0;
          q.push(idx(x, y));
        }
    for (let h = 0; h < q.length; h++) {
      const cur = q[h];
      if (near[cur] >= MARGIN) continue;
      const x = cur % size;
      const y = (cur - x) / size;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        if (!inb(x + dx, y + dy)) continue;
        const t = idx(x + dx, y + dy);
        if (near[t] >= 0) continue;
        near[t] = near[cur] + 1;
        q.push(t);
      }
    }
    const free = (i: number) => near[i] < 0;
    const mine = (i: number) => zone[i] === z;

    // 1. shape: a chain of large islands with ragged coasts, deep harbour bays and mountains,
    //    reefs of islets between them
    const S = ex.seed * 17;
    const warpA = fbm(S + 2, 3);
    const warpB = fbm(S + 3, 3);
    const coast = fbm(S + 4, 4);
    const crest = ridged(S + 5, 4);
    const fine = valueNoise(S + 6);
    const fine2 = valueNoise(S + 7);
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    const hw = (x1 - x0) / 2;
    const hh = (y1 - y0) / 2;
    const count = Math.max(3, Math.round((x1 - x0) / 30));
    const bigs = Array.from({ length: ex.shape === "airport" ? 0 : count }, (_, b) => {
      const mountain = b % 3 !== 1;
      const r = Math.min(hh * 0.8, 9 + er() * 8);
      return {
        x: x0 + ((b + 0.5) / count) * (x1 - x0) + (er() * 2 - 1) * 6,
        y: cy + (er() * 2 - 1) * hh * 0.3,
        rx: r * (1 + er() * 0.5),
        ry: r * (0.75 + er() * 0.3),
        rot: er() * Math.PI,
        top: mountain ? 0.68 + er() * 0.3 : 0.3 + er() * 0.1,
        mountain,
        // harbour bays: deep inlets cut into the coast
        bays: Array.from({ length: 2 + Math.floor(er() * 2) }, () => ({ ang: er() * Math.PI * 2, w: 0.18 + er() * 0.2, depth: 0.55 + er() * 0.3 })),
      };
    });
    // an island airport (Hong Kong style): a dead flat platform reclaimed from the sea, two parallel
    // runways with the apron between them, the terminal at the town end, a few small hilly islands
    let field: { px0: number; py0: number; px1: number; py1: number; tx: number; ty: number } | null = null;
    if (ex.shape === "airport") {
      // 14 rows starting one row into a WATER_CELL square: no square of water plots is covered
      // whole, so every water plot under it keeps a row of sea (and no pond lands on the airfield)
      const PW = 66;
      const PH = 14;
      const px0 = Math.round(cx - PW / 2);
      const px1 = px0 + PW - 1;
      const py0 = Math.floor((cy - PH / 2) / WATER_CELL) * WATER_CELL + 1;
      const py1 = py0 + PH - 1;
      field = { px0, py0, px1, py1, tx: px0 + 58, ty: py0 + 7 };
      const isl = [
        { x: px0 - 5, y: py1 + 1, s: 5.5, h: 0.5 },
        { x: px0 + 22, y: py1 + 4, s: 4, h: 0.34 },
        { x: px1 + 5, y: py0 - 1, s: 5, h: 0.45 },
        { x: px0 + 40, y: py0 - 4, s: 3.2, h: 0.26 },
      ];
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          const i = idx(x, y);
          if (!free(i)) continue;
          let h = -1;
          const wx = x + warpA(x / 9, y / 9) * 2.5;
          const wy = y + warpB(x / 9, y / 9) * 2.5;
          for (const b of isl) {
            const bump = Math.exp(-((Math.hypot(wx - b.x, wy - b.y) / b.s) ** 2));
            if (bump > 0.1) h = Math.max(h, b.h * bump - 0.04 + fine(x / 4, y / 4) * 0.03 + Math.pow(crest(x / 8, y / 8), 2) * 0.08 * bump);
          }
          // straight sea walls, cut corners
          const cdx = Math.min(x - px0, px1 - x);
          const cdy = Math.min(y - py0, py1 - y);
          if (cdx >= 0 && cdy >= 0 && cdx + cdy >= 3) h = 0.06;
          if (h <= -0.045) continue;
          height[i] = h;
          kind[i] = h < 0 ? K.shallow : h < 0.035 ? K.beach : h > 0.72 ? K.peak : h > 0.55 ? K.mountain : h > 0.4 ? K.hill : K.land;
          zone[i] = z;
        }
      for (let y = py0; y <= py1; y++)
        for (let x = px0; x <= px0 + 50; x++) {
          const i = idx(x, y);
          if (!mine(i) || height[i] < 0) continue;
          const onRunway = x >= px0 + 3 && x <= px0 + 48 && (y === py0 + 1 || y === py0 + 2 || y === py1 - 2 || y === py1 - 1);
          const terminal = x >= px0 + 38 && y >= py0 + 5 && y <= py1 - 5;
          kind[i] = onRunway ? K.runway : terminal ? K.terminal : K.apron;
        }
    }
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const i = idx(x, y);
        if (field || !free(i)) continue;
        const u = (x - cx) / hw;
        const v = (y - cy) / hh;
        const m = Math.min(1, Math.max(0, (1 - Math.max(Math.abs(u), Math.abs(v)) - warpA(u * 3, v * 3) * 0.06) / 0.14));
        if (m <= 0) continue;
        // islets and reefs
        const t = fine(x / 3.1, y / 3.1) * 0.6 + fine2(x / 8, y / 8) * 0.4;
        let h = t > 0.47 ? 0.004 + (t - 0.47) * 0.35 : -0.02 - (0.47 - t) * 0.08;
        const px = x + warpA(x / 10, y / 10) * 4;
        const py = y + warpB(x / 10, y / 10) * 4;
        for (const b of bigs) {
          const dx = px - b.x;
          const dy = py - b.y;
          const ru = (dx * Math.cos(b.rot) + dy * Math.sin(b.rot)) / b.rx;
          const rv = (-dx * Math.sin(b.rot) + dy * Math.cos(b.rot)) / b.ry;
          let d = Math.hypot(ru, rv) + coast(x / 8, y / 8) * 0.42 + fine2(x / 2.5, y / 2.5) * 0.07;
          if (d > 1.6) continue;
          const ang = Math.atan2(rv, ru);
          for (const bay of b.bays) {
            let da = Math.abs(ang - bay.ang) % (Math.PI * 2);
            if (da > Math.PI) da = Math.PI * 2 - da;
            d += bay.depth * Math.exp(-((da / bay.w) ** 2)) * Math.min(1, Math.max(0, (d - 0.15) * 2.2));
          }
          if (d >= 1) {
            h = Math.max(h, -0.01 - (d - 1) * 0.12);
            continue;
          }
          const dome = 1 - d * d;
          let hb = 0.04 + dome * 0.22;
          if (b.mountain) hb += Math.pow(dome, 1.6) * (b.top - 0.26) * (0.55 + 0.45 * crest(x / 11, y / 11));
          else hb = Math.min(hb + Math.pow(dome, 2) * (b.top - 0.26) * crest(x / 14, y / 14), b.top);
          h = Math.max(h, hb + fine(x / 4, y / 4) * 0.02);
        }
        if (m < 1) h = Math.min(h, -0.02 - (1 - m) * 0.1);
        if (ex.lagoon && m > 0.3) zone[i] = z;
        if (h <= -0.045) continue;
        height[i] = h;
        kind[i] = h < 0 ? K.shallow : h < 0.035 ? K.beach : h > 0.72 ? K.peak : h > 0.55 ? K.mountain : h > 0.4 ? K.hill : K.land;
        zone[i] = z;
      }
    // a shallow rim around every new coast
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const i = idx(x, y);
        if (!free(i) || (kind[i] !== K.ocean && kind[i] !== K.deep)) continue;
        if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => inb(x + dx, y + dy) && zone[idx(x + dx, y + dy)] === z && height[idx(x + dx, y + dy)] >= 0)) {
          kind[i] = K.shallow;
          height[i] = -0.01;
          zone[i] = z;
        }
      }

    // 2. districts (centres only: no towns), names carry on each region's list
    const first = districts.length;
    const cands: number[] = [];
    let land = 0;
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const i = idx(x, y);
        if (!mine(i) || height[i] < 0) continue;
        land++;
        if (height[i] > 0.05 && height[i] < 0.4) cands.push(i);
      }
    // the airport's town stands on the platform, by the terminal
    if (field && mine(idx(field.tx, field.ty))) cands.splice(0, cands.length, idx(field.tx, field.ty));
    const minD = Math.max(14, Math.sqrt(land / Math.max(1, ex.districts.length)) * 0.8);
    for (let tries = 0; tries < 6000 && districts.length - first < ex.districts.length && cands.length; tries++) {
      const i = cands[Math.floor(er() * cands.length)];
      const x = i % size;
      const y = (i - x) / size;
      if (districts.slice(first).some((d) => Math.hypot(d.x - x, d.y - y) < minD * (1 - tries / 12000))) continue;
      const b = ex.districts[districts.length - first];
      const list = REGIONS[b].names;
      let name = "";
      for (let n = used[b] ?? 0; ; n++) {
        name = n < list.length ? list[n] : `${list[n % list.length]} ${["East", "West", "North", "South"][Math.floor(n / list.length) % 4]}`;
        used[b] = n + 1;
        if (!districts.some((d) => d.name === name)) break;
      }
      districts.push({ id: districts.length, name, biome: b, x, y, capital: false });
    }
    const own = districts.slice(first);
    if (!own.length) return;
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const i = idx(x, y);
        if (!mine(i) || (height[i] < 0 && kind[i] !== K.shallow)) continue;
        const px = x + bx((x - off) / 35, (y - off) / 35) * 24;
        const py = y + by((x - off) / 35, (y - off) / 35) * 24;
        let best = own[0].id;
        let bd = Infinity;
        for (const d of own) {
          const dd = (d.x - px) ** 2 + (d.y - py) ** 2;
          if (dd < bd) {
            bd = dd;
            best = d.id;
          }
        }
        district[i] = best;
      }

    // the airport town: its square, and a road from it to the terminal; the airport on the map
    if (field && own[0].x === field.tx && own[0].y === field.ty) {
      const { px0, tx, ty } = field;
      for (let y = ty - 1; y <= ty + 1; y++) for (let x = tx - 1; x <= tx + 1; x++) if (mine(idx(x, y)) && height[idx(x, y)] >= 0) kind[idx(x, y)] = K.plaza;
      const path: number[] = [];
      for (let x = tx - 2; x >= px0 + 51; x--) path.push(idx(x, ty));
      if (path.every((i) => mine(i) && height[i] >= 0)) layRoad(path, "street", `${own[0].name} Airport Road`);
      airports.push({ name: `${own[0].name} International Airport`, x: px0 + 44, y: ty, district: own[0].id });
    }

    // 3. palms along the shores and on the slopes, lakes in the valleys; open lowland stays
    //    fields and meadows (the renderer draws the fields); none at an airport
    const palmN = fbm(S + 8, 3);
    const lakeM = fbm(S + 9, 3);
    const shore = new Int16Array(N).fill(-1);
    const sq: number[] = [];
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const i = idx(x, y);
        if (mine(i) && height[i] < 0) {
          shore[i] = 0;
          sq.push(i);
        }
      }
    for (let h = 0; h < sq.length; h++) {
      const cur = sq[h];
      if (shore[cur] >= 6) continue;
      const x = cur % size;
      const y = (cur - x) / size;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (!inb(x + dx, y + dy)) continue;
        const t = idx(x + dx, y + dy);
        if (shore[t] >= 0 || !mine(t)) continue;
        shore[t] = shore[cur] + 1;
        sq.push(t);
      }
    }
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const i = idx(x, y);
        if (field || !mine(i) || (kind[i] !== K.land && kind[i] !== K.hill)) continue;
        const s = shore[i] < 0 ? 9 : shore[i];
        const pn = palmN(x / 7, y / 7);
        if ((s <= 1 && pn > -0.15) || (s === 2 && pn > 0.1) || (kind[i] === K.hill && pn > 0.15) || pn > 0.5) kind[i] = K.forest;
        if (s >= 4 && height[i] > 0.07 && height[i] < 0.3 && lakeM(x / 9, y / 9) > 0.36) kind[i] = K.lake;
      }

    // 4. water plots of the old sea give up the tiles the land rose from, but keep at least
    //    four tiles of water: where an island covers a whole square, its lowest tiles become a lake
    const SEA = new Set<number>([K.deep, K.ocean, K.shallow]);
    const PAVED = new Set<number>([K.runway, K.apron, K.terminal, K.road, K.street, K.plaza, K.bridge]);
    const touched = new Map<number, number[]>();
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const i = idx(x, y);
        const p = plotOf[i];
        if (p < 0 || !mine(i) || SEA.has(kind[i])) continue;
        if (!touched.has(p)) touched.set(p, []);
        touched.get(p)!.push(i);
      }
    for (const [p, gone] of touched) {
      const plot = plots[p];
      let keep = plot.tiles.filter((t) => SEA.has(kind[t]));
      if (keep.length < 4) {
        // the lowest tile of the square and its lowest neighbours in the square
        // (never on a runway, apron, terminal, road or square)
        const inPlot = new Set(plot.tiles);
        const ground = gone.filter((t) => !PAVED.has(kind[t]));
        const pond = new Set<number>(ground.length ? [ground.reduce((a, t) => (height[t] < height[a] ? t : a))] : []);
        while (pond.size + keep.length < 4) {
          let pick = -1;
          for (const t of pond) {
            const x = t % size;
            const y = (t - x) / size;
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
              const n2 = idx(x + dx, y + dy);
              if (inb(x + dx, y + dy) && inPlot.has(n2) && !pond.has(n2) && !SEA.has(kind[n2]) && !PAVED.has(kind[n2]) && (pick < 0 || height[n2] < height[pick])) pick = n2;
            }
          }
          if (pick < 0) break;
          pond.add(pick);
        }
        for (const t of pond) {
          kind[t] = K.lake;
          height[t] = Math.min(height[t], 0.05);
        }
        keep = plot.tiles.filter((t) => SEA.has(kind[t]) || pond.has(t));
      }
      for (const t of plot.tiles) if (!keep.includes(t)) plotOf[t] = -1;
      let sx = 0;
      let sy = 0;
      const counts = new Map<number, number>();
      let lagoon = 0;
      for (const t of keep) {
        sx += t % size;
        sy += Math.floor(t / size);
        counts.set(kind[t], (counts.get(kind[t]) ?? 0) + 1);
        if (mine(t) && kind[t] !== K.deep) lagoon++;
      }
      const pcx = sx / keep.length;
      const pcy = sy / keep.length;
      const anchorT = keep.reduce((a, t) => ((t % size) - pcx) ** 2 + (Math.floor(t / size) - pcy) ** 2 < ((a % size) - pcx) ** 2 + (Math.floor(a / size) - pcy) ** 2 ? t : a);
      const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
      plot.tiles = keep;
      plot.anchor = { x: anchorT % size, y: Math.floor(anchorT / size) };
      plot.distance = Math.hypot(pcx - center, pcy - center);
      plot.landscape = top === K.lake ? "lake" : ex.lagoon && lagoon * 2 > keep.length ? "lagoon" : top === K.shallow ? "shallows" : top === K.ocean ? "sea" : "deepSea";
    }
    // the rest of the sea in the land's squares turns lagoon-coloured too
    if (ex.lagoon)
      for (let i = 0; i < N; i++) {
        const p = plotOf[i];
        if (p >= 0 && mine(i) && plots[p].water && plots[p].landscape !== "lake" && !touched.has(p)) {
          let lagoon = 0;
          for (const t of plots[p].tiles) if (mine(t) && kind[t] !== K.deep) lagoon++;
          if (lagoon * 2 > plots[p].tiles.length) plots[p].landscape = "lagoon";
        }
      }

    // 5. lots on all the new land, then plots of the new lakes, all after every older plot
    expansions.push({ name: ex.name, zone: z, lagoon: !!ex.lagoon, districts: own.map((d) => d.id) });
    makeLots(z);
    const cols = Math.ceil(size / WATER_CELL);
    const cells = new Map<number, number[]>();
    for (let i = 0; i < N; i++) {
      if (!mine(i) || plotOf[i] >= 0 || kind[i] !== K.lake) continue;
      const x = i % size;
      const y = (i - x) / size;
      const key = Math.floor(y / WATER_CELL) * cols + Math.floor(x / WATER_CELL);
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key)!.push(i);
    }
    for (const [key, tiles] of [...cells.entries()].sort((a, b) => a[0] - b[0])) {
      if (tiles.length < 4) continue;
      const col = (key % cols) + 1;
      const row = Math.floor(key / cols) + 1;
      let sx = 0;
      let sy = 0;
      const dCount = new Map<number, number>();
      for (const t of tiles) {
        sx += t % size;
        sy += Math.floor(t / size);
        if (district[t] >= 0) dCount.set(district[t], (dCount.get(district[t]) ?? 0) + 1);
      }
      const pcx = sx / tiles.length;
      const pcy = sy / tiles.length;
      const anchorT = tiles.reduce((a, t) => ((t % size) - pcx) ** 2 + (Math.floor(t / size) - pcy) ** 2 < ((a % size) - pcx) ** 2 + (Math.floor(a / size) - pcy) ** 2 ? t : a);
      const dTop = [...dCount.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
      const id = plots.length;
      for (const t of tiles) plotOf[t] = id;
      plots.push({
        id,
        address: `Lake Plot ${col}-${row}`,
        number: col,
        road: -1,
        district: dTop ? dTop[0] : own[0].id,
        tiles,
        anchor: { x: anchorT % size, y: Math.floor(anchorT / size) },
        landscape: "lake",
        waterView: true,
        water: true,
        distance: Math.hypot(pcx - center, pcy - center),
      });
    }
  });

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
    zone,
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
    expansions,
  };
}

export function findPlotByAddress(world: World, query: string): Plot | undefined {
  const q = query.trim().toLowerCase().replace(/\s+/g, " ");
  const exact = world.plots.find((p) => p.address.toLowerCase() === q);
  if (exact) return exact;
  const m = q.match(/^(\d+)\s+(.+)$/);
  if (!m) return undefined;
  const num = Number(m[1]);
  const street = m[2];
  return world.plots.find((p) => p.road >= 0 && p.number === num && world.roads[p.road].name.toLowerCase() === street);
}
