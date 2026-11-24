import { describe, expect, it } from "vitest";
import { buildingsFor, STYLES, TOWER_FLOORS, TOWER_MIN_TILES } from "./buildings";
import { DEFAULT_WORLD, generateWorld } from "./generator";
import { worldStrings } from "./strings";
import { cottageKey } from "./cottages";

const world = generateWorld(DEFAULT_WORLD);
const all = buildingsFor(world);
const towers = world.plots.filter((p) => all[p.id].tower).map((p) => ({ plot: p, b: all[p.id] }));

describe("building preview", () => {
  it("gives every plot a building", () => {
    expect(all.length).toBe(world.plots.length);
    for (const b of all) if (!b.tower) expect(b.floors).toBeGreaterThanOrEqual(b.style.floors[0]);
    expect(new Set(all.map((b) => b.style.id)).size).toBeGreaterThanOrEqual(9);
  });

  it("puts skyscrapers of 40 to 100 floors only on downtown plots of 2,000 m² or more", () => {
    expect(towers.length).toBeGreaterThanOrEqual(20);
    for (const { plot, b } of towers) {
      expect(plot.tiles.length).toBeGreaterThanOrEqual(TOWER_MIN_TILES);
      expect(b.floors).toBeGreaterThanOrEqual(TOWER_FLOORS[0]);
      expect(b.floors).toBeLessThanOrEqual(TOWER_FLOORS[1]);
      expect(b.tower!.tiles).toEqual(plot.tiles);
      expect(Math.max(...b.tower!.heights)).toBe(b.floors);
    }
  });

  it("makes every skyscraper different", () => {
    const look = towers.map(({ b }) => `${b.tower!.glass}|${b.tower!.facade}|${b.tower!.top}|${b.tower!.profile}`);
    expect(new Set(look).size).toBe(towers.length);
    expect(new Set(towers.map(({ b }) => b.tower!.name)).size).toBe(towers.length);
    expect(new Set(towers.map(({ b }) => b.tower!.top)).size).toBeGreaterThanOrEqual(5);
    expect(new Set(towers.map(({ b }) => b.tower!.profile)).size).toBe(5);
  });

  it("has an English name for every style", () => {
    const t = worldStrings("en");
    for (const id of Object.keys(STYLES)) expect(t.styles[id as keyof typeof t.styles], id).toBeTruthy();
  });

  it("gives every small-house plot its own modern cottage, never repeating a neighbour", () => {
    const cottages = world.plots.filter((p) => all[p.id].cottage);
    expect(cottages.length).toBeGreaterThanOrEqual(300);
    for (const p of cottages) {
      const c = all[p.id].cottage!;
      expect([1, 2]).toContain(c.floors);
      expect(all[p.id].floors).toBe(c.floors);
    }
    const keys = cottages.map((p) => cottageKey(all[p.id].cottage!));
    expect(new Set(keys).size).toBe(keys.length);
    // the same world always gets the same cottages
    const again = buildingsFor(generateWorld(DEFAULT_WORLD));
    for (const p of cottages) expect(again[p.id].cottage).toEqual(all[p.id].cottage);
    const t = worldStrings("en");
    for (const p of cottages) {
      const c = all[p.id].cottage!;
      expect(t.cottageForms[c.form]).toBeTruthy();
      expect(t.cottageMaterials[c.material]).toBeTruthy();
    }
  });
});
