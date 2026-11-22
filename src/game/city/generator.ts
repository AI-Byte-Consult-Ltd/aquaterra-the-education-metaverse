/**
 * AquaTerra — radial city generator ("город-лучи").
 *
 * The whole city is described by a handful of numbers (CityParams). Streets
 * ("rays") start at the First Light Tower in the centre and run outwards;
 * ring canals cut the city into quarters; the coast is irregular; islands sit
 * in the ocean and are reached by bridges that continue a ray across the water.
 *
 * Every land tile next to a ray becomes part of a plot with a postal address
 * "Ray N, house M": odd numbers on the left side of the ray (looking outwards),
 * even numbers on the right, numbered from the tower outwards — like a real
 * street. The generator is pure and deterministic: the same params always give
 * the same city, so the server and the client can both build it.
 */

export type TileKind =
  | "ocean"
  | "shallow"
  | "beach"
  | "land"
  | "park"
  | "street"
  | "bridge"
  | "canal"
  | "plaza"
  | "tower"
  | "plot";

export interface CityParams {
  seed: number;
  /** Rays that start at the tower plaza. */
  primaryRays: number;
  /** Extra rays that branch off between primary rays, starting at the first canal. */
  branchRays: boolean;
  /** Radius (tiles) of the tower plaza. */
  plazaRadius: number;
  /** Radii (tiles) of the ring canals. */
  canalRadii: number[];
  /** Mean radius (tiles) of the mainland coast. */
  coastRadius: number;
  /** How much the coast wobbles, in tiles. */
  coastNoise: number;
  /** Number of islands in the ocean. */
  islands: number;
  /** Plot depth from the street edge, in tiles. */
  plotDepth: number;
  /** Plot frontage along the street, in tiles. */
  plotFrontage: number;
}

export const DEFAULT_CITY: CityParams = {
  seed: 20261122,
  primaryRays: 12,
  branchRays: true,
  plazaRadius: 6,
  canalRadii: [18, 34, 50],
  coastRadius: 62,
  coastNoise: 5,
  islands: 5,
  plotDepth: 4,
  plotFrontage: 3,
};

export type RingZone = "core" | "inner" | "middle" | "outer" | "coast" | "islands";

export interface Ray {
  /** Public number used in addresses: 1..N. */
  number: number;
  angle: number;
  startRadius: number;
  /** True if the ray continues over water to an island. */
  reachesIsland: boolean;
}

export interface Island {
  id: number;
  cx: number;
  cy: number;
  radius: number;
  ray: number;
}

export interface Plot {
  id: number;
  ray: number;
  house: number;
  side: "left" | "right";
  zone: RingZone;
  /** Tile indices (y * size + x). */
  tiles: number[];
  /** Tile used as the plot's anchor for labels and camera jumps. */
  anchor: { x: number; y: number };
  /** Distance from the tower in tiles. */
  distance: number;
  /** Touches a canal, beach, shallow water or ocean. */
  waterView: boolean;
  onIsland: boolean;
}

export interface City {
  params: CityParams;
  size: number;
  center: number;
  tiles: Uint8Array;
  /** Plot id per tile, -1 when the tile is not part of a plot. */
  plotOf: Int32Array;
  /** Ray number per street/bridge tile, 0 otherwise. */
  rayOf: Uint8Array;
  rays: Ray[];
  islands: Island[];
  plots: Plot[];
}

export const TILE_KINDS: TileKind[] = [
  "ocean",
  "shallow",
  "beach",
  "land",
  "park",
  "street",
  "bridge",
  "canal",
  "plaza",
  "tower",
  "plot",
];
const K = Object.fromEntries(TILE_KINDS.map((k, i) => [k, i])) as Record<TileKind, number>;

export const kindAt = (city: City, x: number, y: number): TileKind | null => {
  if (x < 0 || y < 0 || x >= city.size || y >= city.size) return null;
  return TILE_KINDS[city.tiles[y * city.size + x]];
};

/** mulberry32 — small, fast, deterministic PRNG. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Smooth periodic noise over an angle, built from a few seeded harmonics. */
function angularNoise(seed: number, harmonics = 5) {
  const r = rng(seed);
  const terms = Array.from({ length: harmonics }, (_, i) => ({
    k: i + 2,
    phase: r() * Math.PI * 2,
    amp: (r() * 0.6 + 0.4) / (i + 1),
  }));
  const norm = terms.reduce((s, t) => s + t.amp, 0);
  return (theta: number) => terms.reduce((s, t) => s + t.amp * Math.sin(t.k * theta + t.phase), 0) / norm;
}

const TAU = Math.PI * 2;
const wrapAngle = (a: number) => {
  let v = a % TAU;
  if (v > Math.PI) v -= TAU;
  if (v < -Math.PI) v += TAU;
  return v;
};

export function zoneFor(params: CityParams, distance: number, onIsland: boolean): RingZone {
  if (onIsland) return "islands";
  const [c1, c2, c3] = params.canalRadii;
  if (distance < (c1 ?? params.coastRadius)) return distance < params.plazaRadius * 2 ? "core" : "inner";
  if (distance < (c2 ?? params.coastRadius)) return "middle";
  if (distance < (c3 ?? params.coastRadius)) return "outer";
  return "coast";
}

export function generateCity(params: CityParams = DEFAULT_CITY): City {
  const islandReach = 26;
  const size = Math.ceil((params.coastRadius + params.coastNoise + islandReach + 8) * 2);
  const center = size / 2;
  const tiles = new Uint8Array(size * size);
  const plotOf = new Int32Array(size * size).fill(-1);
  const rayOf = new Uint8Array(size * size);
  const rand = rng(params.seed);
  const coast = angularNoise(params.seed ^ 0x9e3779b9);

  // --- rays -----------------------------------------------------------------
  const rays: Ray[] = [];
  const step = TAU / params.primaryRays;
  // Ray 1 points "north" on screen (up-right in isometric), numbering goes clockwise.
  const base = -Math.PI / 2;
  for (let i = 0; i < params.primaryRays; i++) {
    rays.push({ number: i + 1, angle: wrapAngle(base + i * step), startRadius: params.plazaRadius, reachesIsland: false });
  }
  if (params.branchRays && params.canalRadii.length > 0) {
    for (let i = 0; i < params.primaryRays; i++) {
      rays.push({
        number: params.primaryRays + i + 1,
        angle: wrapAngle(base + (i + 0.5) * step),
        startRadius: params.canalRadii[0],
        reachesIsland: false,
      });
    }
  }

  // --- islands: each sits on the extension of a ray ---------------------------
  const islands: Island[] = [];
  const candidates = [...rays].sort(() => rand() - 0.5);
  for (const ray of candidates) {
    if (islands.length >= params.islands) break;
    // keep islands apart
    if (islands.some((is) => Math.abs(wrapAngle(rays[is.ray - 1].angle - ray.angle)) < step * 1.4)) continue;
    const dist = params.coastRadius + params.coastNoise + 10 + rand() * 10;
    const radius = 6 + rand() * 5;
    islands.push({
      id: islands.length + 1,
      cx: center + Math.cos(ray.angle) * dist,
      cy: center + Math.sin(ray.angle) * dist,
      radius,
      ray: ray.number,
    });
    ray.reachesIsland = true;
  }
  const islandNoise = islands.map((is) => angularNoise(params.seed + is.id * 7919, 3));

  const coastAt = (theta: number) => params.coastRadius + coast(theta) * params.coastNoise;
  const islandAt = (x: number, y: number) => {
    for (let i = 0; i < islands.length; i++) {
      const is = islands[i];
      const dx = x - is.cx;
      const dy = y - is.cy;
      const d = Math.hypot(dx, dy);
      const edge = is.radius + islandNoise[i](Math.atan2(dy, dx)) * 2;
      if (d < edge) return { island: is, inner: edge - d };
      if (d < edge + 1.5) return { island: is, inner: edge - d };
    }
    return null;
  };

  const halfStreet = 0.75; // street is ~1.5 tiles wide
  const halfCanal = 0.9;

  // Nearest ray that exists at radius r.
  const nearestRay = (theta: number, r: number) => {
    let best: Ray | null = null;
    let bestOff = Infinity;
    for (const ray of rays) {
      if (r < ray.startRadius - 0.5) continue;
      const off = wrapAngle(theta - ray.angle);
      if (Math.abs(off) < Math.abs(bestOff)) {
        bestOff = off;
        best = ray;
      }
    }
    return best ? { ray: best, off: bestOff } : null;
  };

  // --- classify every tile ----------------------------------------------------
  type PlotKey = string;
  const plotTiles = new Map<PlotKey, { ray: Ray; side: "left" | "right"; idx: number; tiles: number[]; island: boolean; dsum: number }>();

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const dx = x + 0.5 - center;
      const dy = y + 0.5 - center;
      const r = Math.hypot(dx, dy);
      const theta = Math.atan2(dy, dx);
      const coastR = coastAt(theta);
      const isl = islandAt(x + 0.5, y + 0.5);

      // tower and plaza
      if (r < 2.6) {
        tiles[i] = K.tower;
        continue;
      }
      if (r < params.plazaRadius) {
        tiles[i] = K.plaza;
        continue;
      }

      const onMain = r < coastR;
      const onIsland = !onMain && isl !== null && isl.inner > 0;
      const near = nearestRay(theta, r);
      const perp = near ? Math.abs(Math.sin(near.off)) * r : Infinity; // distance to ray line
      const along = near ? Math.cos(near.off) * r : 0;
      const onRayLine = near !== null && perp < halfStreet && along > 0;

      // water
      if (!onMain && !onIsland) {
        const toward = near && near.ray.reachesIsland && onRayLine;
        // bridge continues the ray across water until it reaches its island
        if (toward) {
          const is = islands.find((s) => s.ray === near!.ray.number)!;
          const islandFar = Math.hypot(is.cx - center, is.cy - center);
          if (r < islandFar) {
            tiles[i] = K.bridge;
            rayOf[i] = near!.ray.number;
            continue;
          }
        }
        const depth = onMain ? 0 : isl ? -isl.inner : r - coastR;
        tiles[i] = depth < 2.5 ? K.shallow : K.ocean;
        continue;
      }

      // beach ring
      if (onMain && coastR - r < 1.4) {
        if (onRayLine) {
          tiles[i] = K.street;
          rayOf[i] = near!.ray.number;
        } else tiles[i] = K.beach;
        continue;
      }
      if (onIsland && isl!.inner < 1.2) {
        if (onRayLine && near!.ray.number === isl!.island.ray) {
          tiles[i] = K.street;
          rayOf[i] = near!.ray.number;
        } else tiles[i] = K.beach;
        continue;
      }

      // canals (mainland only) — a ray crossing a canal is a bridge
      if (onMain && params.canalRadii.some((c) => Math.abs(r - c) < halfCanal)) {
        if (onRayLine) {
          tiles[i] = K.bridge;
          rayOf[i] = near!.ray.number;
        } else tiles[i] = K.canal;
        continue;
      }

      if (onRayLine && (!onIsland || near!.ray.number === isl!.island.ray)) {
        tiles[i] = K.street;
        rayOf[i] = near!.ray.number;
        continue;
      }

      // plots along a ray
      const usableRay = near && (!onIsland || near.ray.number === isl!.island.ray);
      const fromStreet = perp - halfStreet;
      if (usableRay && along > 0 && fromStreet >= 0 && fromStreet < params.plotDepth) {
        // Plots never cross a canal: number them inside the band between canals.
        const side: "left" | "right" = near!.off < 0 ? "left" : "right";
        const idx = Math.floor((along - near!.ray.startRadius) / params.plotFrontage);
        const band = onIsland ? 99 : params.canalRadii.filter((c) => c < along).length;
        const key = `${near!.ray.number}:${side}:${band}:${idx}`;
        let entry = plotTiles.get(key);
        if (!entry) {
          entry = { ray: near!.ray, side, idx, tiles: [], island: onIsland, dsum: 0 };
          plotTiles.set(key, entry);
        }
        entry.tiles.push(i);
        entry.dsum += r;
        tiles[i] = K.plot;
        continue;
      }

      tiles[i] = K.park;
    }
  }

  // --- turn tile groups into numbered plots -----------------------------------
  // Tiny fragments (cut by a canal or the coast) are left as park.
  const minTiles = Math.max(3, Math.floor((params.plotDepth * params.plotFrontage) / 3));
  const groups = [...plotTiles.values()].filter((g) => {
    if (g.tiles.length >= minTiles) return true;
    for (const t of g.tiles) tiles[t] = K.park;
    return false;
  });

  // Number houses per ray & side by distance from the tower: 1, 3, 5… on the left, 2, 4, 6… on the right.
  const byRaySide = new Map<string, typeof groups>();
  for (const g of groups) {
    const k = `${g.ray.number}:${g.side}`;
    if (!byRaySide.has(k)) byRaySide.set(k, []);
    byRaySide.get(k)!.push(g);
  }

  const plots: Plot[] = [];
  const isWater = (k: number) => k === K.canal || k === K.ocean || k === K.shallow || k === K.beach;
  for (const [, list] of [...byRaySide.entries()].sort(([a], [b]) => a.localeCompare(b, "en", { numeric: true }))) {
    list.sort((a, b) => a.dsum / a.tiles.length - b.dsum / b.tiles.length);
    list.forEach((g, n) => {
      const id = plots.length;
      const house = g.side === "left" ? n * 2 + 1 : n * 2 + 2;
      let waterView = false;
      let ax = 0;
      let ay = 0;
      for (const t of g.tiles) {
        plotOf[t] = id;
        const x = t % size;
        const y = (t - x) / size;
        ax += x;
        ay += y;
        if (!waterView) {
          for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = x + ox;
            const ny = y + oy;
            if (nx >= 0 && ny >= 0 && nx < size && ny < size && isWater(tiles[ny * size + nx])) {
              waterView = true;
              break;
            }
          }
        }
      }
      // anchor = tile of the group closest to its centroid
      const cx = ax / g.tiles.length;
      const cy = ay / g.tiles.length;
      let anchor = { x: Math.round(cx), y: Math.round(cy) };
      let best = Infinity;
      for (const t of g.tiles) {
        const x = t % size;
        const y = (t - x) / size;
        const d = (x - cx) ** 2 + (y - cy) ** 2;
        if (d < best) {
          best = d;
          anchor = { x, y };
        }
      }
      const distance = g.dsum / g.tiles.length;
      plots.push({
        id,
        ray: g.ray.number,
        house,
        side: g.side,
        zone: zoneFor(params, distance, g.island),
        tiles: g.tiles,
        anchor,
        distance,
        waterView,
        onIsland: g.island,
      });
    });
  }

  return { params, size, center, tiles, plotOf, rayOf, rays, islands, plots };
}

/** Parse "Луч 3, дом 12", "Ray 3, house 12", "3/12", "3-12" → { ray, house }. */
export function parseAddress(input: string): { ray: number; house: number } | null {
  const nums = input.match(/\d+/g);
  if (!nums || nums.length < 2) return null;
  const ray = Number(nums[0]);
  const house = Number(nums[1]);
  if (!Number.isFinite(ray) || !Number.isFinite(house) || ray <= 0 || house <= 0) return null;
  return { ray, house };
}

export function findPlot(city: City, ray: number, house: number): Plot | undefined {
  return city.plots.find((p) => p.ray === ray && p.house === house);
}
