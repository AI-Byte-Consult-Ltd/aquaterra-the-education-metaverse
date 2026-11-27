import { describe, expect, it } from "vitest";
import { DEFAULT_WORLD, generateWorld, kindName } from "@/game/world/generator";
import { hasHouse } from "@/game/world/buildings";
import { isCoastal, pierBoatFare, pierTiles, pierWaters, setPierIndex, DEFAULT_PIER_RULES } from "./piers";

const world = generateWorld(DEFAULT_WORLD);
const WATER = new Set(["deep", "ocean", "shallow", "lake", "river"]);

describe("piers", () => {
  const coastal = world.plots.filter((p) => isCoastal(world, p));
  it("many land plots by the water, none of them water or mountain", () => {
    expect(coastal.length).toBeGreaterThan(500);
    expect(coastal.every((p) => hasHouse(p))).toBe(true);
  });
  it("a pier stands on water only, longer with each level", () => {
    for (const p of coastal.slice(0, 300)) {
      const [a, b, c] = [1, 2, 3].map((l) => pierTiles(world, p, l));
      expect(a.length).toBe(1);
      expect(b.length).toBeGreaterThanOrEqual(a.length);
      expect(c.length).toBeGreaterThanOrEqual(b.length);
      for (const { tile } of c) expect(WATER.has(kindName(world, tile))).toBe(true);
      for (const id of pierWaters(world, p)) expect(world.plots[id].water).toBe(true);
    }
  });
  it("own pier halves the boat, a public pier adds its fee", () => {
    const [mine, theirs] = coastal;
    setPierIndex(world, new Map([
      [mine.id, { plotId: mine.id, level: 1, access: "private", fee: 0, readyAt: 0 }],
      [theirs.id, { plotId: theirs.id, level: 2, access: "public", fee: 4, readyAt: 0 }],
    ]), (id) => id === mine.id, DEFAULT_PIER_RULES);
    const far = { x: 0, y: 0 };
    expect(pierBoatFare(far, mine.anchor, 9)).toBe(5);
    expect(pierBoatFare(far, theirs.anchor, 9)).toBe(13);
    expect(pierBoatFare(far, { x: 1, y: 1 }, 9)).toBe(9);
  });
});
