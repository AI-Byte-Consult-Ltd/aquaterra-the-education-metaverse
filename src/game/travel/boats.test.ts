import { describe, expect, it } from "vitest";
import { DEFAULT_WORLD, generateWorld } from "../world/generator";
import { buildNetwork, districtCentre, isWater, isleAt, tilePath } from "./network";
import { tripMoves, tripSegments } from "./ui";
import type { NetworkInfo } from "./api";

const world = generateWorld(DEFAULT_WORLD);
const built = buildNetwork(world);
const net = {
  fares: {},
  hubs: built.hubs.map((h) => ({ ...h, price: 0, owner: null, mine: false, trips: 0, revenue: 0 })),
  routes: built.routes.map((r) => [r.mode, r.a, r.b, r.dist]),
} as unknown as NetworkInfo;
const n = world.size;

// a land plot on another islet than its town square, and a plot of open water
const islet = world.plots.find((p) => p.district >= 0 && isleAt(world, p.anchor.x, p.anchor.y) >= 0 && isleAt(world, p.anchor.x, p.anchor.y) !== isleAt(world, districtCentre(world, p.district).x, districtCentre(world, p.district).y))!;
const water = world.plots.find((p) => isleAt(world, p.anchor.x, p.anchor.y) < 0)!;

describe("nobody walks on water", () => {
  it("the continent is one piece of land; islets are others", () => {
    const c = districtCentre(world, 0);
    expect(isleAt(world, c.x, c.y)).toBeGreaterThanOrEqual(0);
    expect(islet).toBeTruthy();
  });

  it("a walk never steps on water", () => {
    const c = districtCentre(world, islet.district);
    expect(tilePath(world, "walk", c.y * n + c.x, islet.anchor.y * n + islet.anchor.x)).toBeNull();
    const home = world.plots.find((p) => p.district === 0)!;
    const p = tilePath(world, "walk", districtCentre(world, 0).y * n + districtCentre(world, 0).x, home.anchor.y * n + home.anchor.x)!;
    expect(p.slice(0, -1).some((i) => isWater(world.kind[i]))).toBe(false);
  });

  it("calls a paid boat to an islet and to a water plot, walks free on the same land", () => {
    const c = districtCentre(world, islet.district);
    const m = tripMoves(world, net, c, [], islet.anchor, islet.district);
    expect(m).toHaveLength(1);
    expect(m[0].mode).toBe("boat");
    expect(m[0].fare).toBeGreaterThanOrEqual(3);
    expect(tripMoves(world, net, water.anchor, [], islet.anchor, islet.district)[0].mode).toBe("boat");
    const home = world.plots.find((p) => p.district === 0 && isleAt(world, p.anchor.x, p.anchor.y) === isleAt(world, districtCentre(world, 0).x, districtCentre(world, 0).y))!;
    const w = tripMoves(world, net, districtCentre(world, 0), [], home.anchor, 0);
    expect(w.every((x) => x.mode === "walk" && x.fare === 0)).toBe(true);
  });

  it("the drop sails on water and walks on land in the animation", () => {
    const c = districtCentre(world, islet.district);
    const segs = tripSegments(world, net, c, [], islet.anchor, islet.district);
    expect(segs.some((s) => s.mode === "boat")).toBe(true);
    for (const s of segs.filter((x) => x.mode === "walk"))
      for (const p of s.pts.slice(1, -1)) expect(isWater(world.kind[Math.round(p.y) * n + Math.round(p.x)])).toBe(false);
  });
});
