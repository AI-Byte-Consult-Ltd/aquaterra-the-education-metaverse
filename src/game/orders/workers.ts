/*
 * Workers on the world map: NPC residents of homes walk to the companies and fields of the same owner.
 * Data: the public "staff" list of aquaterra_city() (no names), one entry per owner with jobs.
 */
import type { World } from "@/game/world/generator";
import { fetchCity } from "./api";

export interface StaffGroup { homes: [number, number][]; works: [number, number][] }
export interface Walker { key: string; from: { x: number; y: number }; to: { x: number; y: number }; far: boolean; phase: number }
/** Per plot: people living there, or workers there of how many jobs. */
export interface PlotStaff { people?: number; workers?: number; jobs?: number; output?: number }

const MAX_WALKERS = 320;
const FAR_TILES = 28;

let cache: Promise<StaffGroup[]> | null = null;
let cachedAt = 0;
/** One request for the map and the plot card, refreshed at most every minute. */
export function loadStaff(force = false): Promise<StaffGroup[]> {
  if (!cache || force || Date.now() - cachedAt > 60_000) {
    cachedAt = Date.now();
    cache = fetchCity().then((r) => (r.ok ? ((r.data as unknown as { staff?: StaffGroup[] }).staff ?? []) : []));
  }
  return cache;
}

const rand = (n: number) => {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
};

/** Who works where: homes fill the nearest workplaces first, as many people as the jobs need. */
export function staffPlan(world: World, groups: StaffGroup[]) {
  const perPlot = new Map<number, PlotStaff>();
  const walkers: Walker[] = [];
  const at = (id: number) => world.plots[id]?.anchor;
  for (const g of groups) {
    const people = g.homes.reduce((s, h) => s + h[1], 0);
    const jobs = g.works.reduce((s, w) => s + w[1], 0);
    const rate = jobs > 0 ? Math.min(1, people / jobs) : 0;
    for (const [id, n] of g.homes) perPlot.set(id, { ...perPlot.get(id), people: n });
    const left = new Map(g.homes.map(([id, n]) => [id, n]));
    for (const [wid, j] of g.works) {
      const need = Math.round(j * rate);
      perPlot.set(wid, { ...perPlot.get(wid), workers: need, jobs: j, output: jobs ? 0.5 + 0.5 * rate : 1 });
      const w = at(wid);
      if (!w) continue;
      let todo = need;
      const homes = [...left.entries()].filter(([, n]) => n > 0).sort((a, b) => {
        const pa = at(a[0]), pb = at(b[0]);
        return (pa ? Math.hypot(pa.x - w.x, pa.y - w.y) : 1e9) - (pb ? Math.hypot(pb.x - w.x, pb.y - w.y) : 1e9);
      });
      for (const [hid, n] of homes) {
        if (todo <= 0) break;
        const take = Math.min(n, todo);
        left.set(hid, n - take);
        todo -= take;
        const h = at(hid);
        if (!h) continue;
        const far = Math.hypot(h.x - w.x, h.y - w.y) > FAR_TILES;
        for (let i = 0; i < take && walkers.length < MAX_WALKERS; i++) {
          const k = hid * 7919 + wid * 31 + i;
          walkers.push({
            key: `${hid}-${wid}-${i}`,
            from: { x: h.x + 0.5 + (rand(k) - 0.5) * 1.2, y: h.y + 0.5 + (rand(k + 1) - 0.5) * 1.2 },
            to: { x: w.x + 0.5 + (rand(k + 2) - 0.5) * 2.4, y: w.y + 0.5 + (rand(k + 3) - 0.5) * 2.4 },
            far,
            phase: rand(k + 4),
          });
        }
      }
    }
  }
  return { perPlot, walkers };
}

/** Where a walker is now: home, on the way, at work (most of the time), on the way back. */
export function walkerAt(w: Walker, time: number) {
  const T = 120_000;
  const t = ((time / T + w.phase) % 1 + 1) % 1;
  if (w.far) {
    const a = t * Math.PI * 2;
    return { x: w.to.x + Math.cos(a) * 0.35, y: w.to.y + Math.sin(a * 2) * 0.2, moving: true };
  }
  const lerp = (u: number) => ({ x: w.from.x + (w.to.x - w.from.x) * u, y: w.from.y + (w.to.y - w.from.y) * u });
  if (t < 0.1) return { ...w.from, moving: false };
  if (t < 0.3) return { ...lerp((t - 0.1) / 0.2), moving: true };
  if (t < 0.8) {
    const a = (t - 0.3) * 40;
    return { x: w.to.x + Math.sin(a) * 0.3, y: w.to.y + Math.cos(a * 0.7) * 0.2, moving: true };
  }
  return { ...lerp(1 - (t - 0.8) / 0.2), moving: true };
}
