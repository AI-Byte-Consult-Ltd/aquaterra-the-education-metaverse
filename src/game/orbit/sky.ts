/*
 * The Orbit chart: bodies from the NFT metadata grouped into systems around the Sun.
 * Pure functions, no drawing state, so the layout is tested.
 */
import type { BodyRow } from "./api";

export interface Body {
  name: string;
  type: string;
  orbits: string;
  claims: number;
  owned: number;
  resources: string[];
  top: number;
  image: string | null;
}

export interface SkySystem {
  key: string;          // planet name, "Asteroid Belt" or "Outer"
  ring: number;         // 1 Mercury ... 10 Pluto, 11 outer objects
  kind: "planet" | "belt" | "outer";
  color: string;
  size: number;         // drawn radius at scale 1
  period: number;       // seconds per turn on the chart
  bodies: Body[];
  claims: number;
  owned: number;
}

const PLANETS: Record<string, { ring: number; color: string; size: number }> = {
  Mercury: { ring: 1, color: "#b8a99a", size: 4 },
  Venus: { ring: 2, color: "#e8c27a", size: 6 },
  Earth: { ring: 3, color: "#4f9fe8", size: 6.5 },
  Mars: { ring: 4, color: "#d8643c", size: 5 },
  Jupiter: { ring: 6, color: "#d9a066", size: 13 },
  Saturn: { ring: 7, color: "#e6cf8b", size: 11 },
  Uranus: { ring: 8, color: "#8fd8e0", size: 8.5 },
  Neptune: { ring: 9, color: "#4a6ee0", size: 8.5 },
  Pluto: { ring: 10, color: "#c9b7a3", size: 4 },
};
export const BELT = "Asteroid Belt";
export const OUTER = "Outer";

export const toBody = (r: BodyRow): Body => ({
  name: r[0], type: r[1], orbits: r[2], claims: r[3], owned: r[4], resources: r[5] ?? [], top: r[6], image: r[7],
});

/** Which system a body belongs to on the chart. */
export function systemOf(b: Pick<Body, "name" | "orbits">): string {
  if (PLANETS[b.orbits]) return b.orbits;
  if (PLANETS[b.name]) return b.name;                     // the planet itself
  if (/asteroid belt/i.test(b.orbits)) return BELT;
  return OUTER;                                           // centaurs, TNOs, comets, others of the Sun
}

export function buildSystems(rows: BodyRow[]): SkySystem[] {
  const by = new Map<string, Body[]>();
  for (const r of rows) {
    const b = toBody(r);
    const k = systemOf(b);
    if (!by.has(k)) by.set(k, []);
    by.get(k)!.push(b);
  }
  const out: SkySystem[] = [];
  for (const [key, bodies] of by) {
    const p = PLANETS[key];
    const ring = p ? p.ring : key === BELT ? 5 : 11;
    bodies.sort((a, b) => (a.name === key ? -1 : b.name === key ? 1 : b.claims - a.claims || a.name.localeCompare(b.name)));
    out.push({
      key, ring,
      kind: p ? "planet" : key === BELT ? "belt" : "outer",
      color: p ? p.color : key === BELT ? "#9a8f86" : "#a5b4fc",
      size: p ? p.size : 5,
      period: 40 * Math.pow(ring, 1.3),
      bodies,
      claims: bodies.reduce((s, b) => s + b.claims, 0),
      owned: bodies.reduce((s, b) => s + b.owned, 0),
    });
  }
  return out.sort((a, b) => a.ring - b.ring);
}

/** Radius of a ring on a chart of half-size `half`. */
export const ringRadius = (ring: number, half: number) => half * (0.12 + (ring / 11) * 0.82);

/** Where a system stands at time t (seconds). Stable start angle from its name. */
export function systemPos(s: SkySystem, t: number, half: number) {
  let h = 0;
  for (const c of s.key) h = (h * 31 + c.charCodeAt(0)) % 360;
  const a = (h / 180) * Math.PI + (t / s.period) * Math.PI * 2;
  const r = ringRadius(s.ring, half);
  return { x: Math.cos(a) * r, y: Math.sin(a) * r * 0.62, r };
}
