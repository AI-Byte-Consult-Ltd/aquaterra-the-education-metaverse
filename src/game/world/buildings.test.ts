import { describe, expect, it } from "vitest";
import { buildingsFor, STYLES } from "./buildings";
import { DEFAULT_WORLD, generateWorld } from "./generator";
import { worldStrings } from "./strings";

const world = generateWorld(DEFAULT_WORLD);
const houses = buildingsFor(world);

describe("house preview", () => {
  it("gives every plot a house within its style's floor range", () => {
    expect(houses.length).toBe(world.plots.length);
    for (const h of houses) {
      expect(h.floors).toBeGreaterThanOrEqual(h.style.floors[0]);
      expect(h.floors).toBeLessThanOrEqual(h.style.floors[1]);
    }
  });

  it("uses many different styles and puts tall towers in the capital", () => {
    expect(new Set(houses.map((h) => h.style.id)).size).toBeGreaterThanOrEqual(9);
    const tallest = houses.reduce((a, b) => (b.floors > a.floors ? b : a));
    expect(["skyline", "spire"]).toContain(tallest.style.id);
  });

  it("has an English name for every style", () => {
    const t = worldStrings("en");
    for (const id of Object.keys(STYLES)) expect(t.styles[id as keyof typeof t.styles], id).toBeTruthy();
  });
});
