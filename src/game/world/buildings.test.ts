import { describe, expect, it } from "vitest";
import { builtBuilding, buildingsFor, designTower, hasHouse, isCentre, LEVEL_FLOORS, starterKind, STYLES, TOWER_CHOICES, towerChoice, towerFootprint, TOWER_MAX_SIDE, towerSite } from "./buildings";
import { DEFAULT_WORLD, generateWorld } from "./generator";
import { worldStrings } from "./strings";
import { cottageKey } from "./cottages";

const world = generateWorld(DEFAULT_WORLD);
const all = buildingsFor(world);

describe("building preview", () => {
  it("starts with no skyscrapers at all: residents build them", () => {
    expect(all.length).toBe(world.plots.length);
    for (const b of all) if (b) expect(b.tower).toBeUndefined();
  });

  it("keeps only 1–2 storey homes and the works of the industrial districts", () => {
    const homes = all.filter((b) => b && starterKind(b) === "cottage");
    expect(homes.length).toBeGreaterThanOrEqual(1500);
    for (const b of homes) expect(b!.floors).toBeLessThanOrEqual(2);
    for (const b of all) if (b && starterKind(b) === "works") expect(["factory", "warehouse", "hangar"]).toContain(b.style.id);
  });

  it("leaves First Light City as open land around the tower, and nothing on water or peaks", () => {
    const city = world.plots.filter((p) => p.district >= 0 && world.districts[p.district].biome === "metropolis");
    expect(city.length).toBeGreaterThan(50);
    for (const p of city) expect(all[p.id]).toBeNull();
    for (const p of world.plots) if (!hasHouse(p)) expect(all[p.id]).toBeNull();
    expect(world.plots.filter((p) => isCentre(world, p) && towerSite(p)).length).toBeGreaterThanOrEqual(20);
  });

  it("grows a resident's skyscraper by levels, each design different", () => {
    const plot = world.plots.find((p) => isCentre(world, p) && towerSite(p))!;
    const designs = Array.from({ length: TOWER_CHOICES }, (_, k) => towerChoice(plot, k));
    expect(new Set(designs).size).toBe(TOWER_CHOICES);
    const looks = designs.map((d) => designTower(world, plot, 60, d).tower!).map((t) => `${t.glass}|${t.facade}|${t.top}|${t.profile}`);
    expect(new Set(looks).size).toBe(TOWER_CHOICES);
    const now = 1000;
    // foundation: a one-floor slab; while a level is being built the last finished level shows
    expect(builtBuilding(world, plot, { kind: "tower", level: 0, design: 3, readyAt: 0 }, now)!.floors).toBe(1);
    expect(builtBuilding(world, plot, { kind: "tower", level: 2, design: 3, readyAt: now + 60 }, now)!.floors).toBe(10);
    for (const level of [1, 2, 3]) {
      const b = builtBuilding(world, plot, { kind: "tower", level, design: 3, readyAt: 0 }, now)!;
      expect(b.floors).toBe(LEVEL_FLOORS[level]);
      expect(Math.max(...b.tower!.heights)).toBe(LEVEL_FLOORS[level]);
      expect(b.tower!.tiles).toEqual(towerFootprint(world, plot));
    }
    expect(builtBuilding(world, plot, { kind: "empty", level: 0, design: 0, readyAt: 0 }, now)).toBeNull();
    const c = builtBuilding(world, plot, { kind: "cottage", level: 0, design: 2, readyAt: 0 }, now)!;
    expect(c.cottage).toBeTruthy();
    expect([1, 2]).toContain(c.floors);
  });

  it("keeps every skyscraper inside its plot as a compact rectangle", () => {
    const n = world.size;
    for (const plot of world.plots.filter(towerSite)) {
      const tiles = towerFootprint(world, plot);
      const inside = new Set(plot.tiles);
      expect(tiles.every((t) => inside.has(t)), `plot ${plot.id}`).toBe(true);
      const xs = tiles.map((t) => t % n), ys = tiles.map((t) => Math.floor(t / n));
      const w = Math.max(...xs) - Math.min(...xs) + 1, d = Math.max(...ys) - Math.min(...ys) + 1;
      expect(w * d).toBe(tiles.length);
      expect(Math.max(w, d)).toBeLessThanOrEqual(TOWER_MAX_SIDE);
      expect(Math.max(w, d)).toBeLessThanOrEqual(2 * Math.min(w, d));
    }
  });

  it("has an English name for every style", () => {
    const t = worldStrings("en");
    for (const id of Object.keys(STYLES)) expect(t.styles[id as keyof typeof t.styles], id).toBeTruthy();
  });

  it("gives every small-house plot its own modern cottage, never repeating a neighbour", () => {
    const cottages = world.plots.filter((p) => all[p.id]?.cottage);
    expect(cottages.length).toBeGreaterThanOrEqual(300);
    for (const p of cottages) {
      const c = all[p.id]!.cottage!;
      expect([1, 2]).toContain(c.floors);
      expect(all[p.id]!.floors).toBe(c.floors);
    }
    const keys = cottages.map((p) => cottageKey(all[p.id]!.cottage!));
    expect(new Set(keys).size).toBe(keys.length);
    // the same world always gets the same cottages
    const again = buildingsFor(generateWorld(DEFAULT_WORLD));
    for (const p of cottages) expect(again[p.id]!.cottage).toEqual(all[p.id]!.cottage);
    const t = worldStrings("en");
    for (const p of cottages) {
      const c = all[p.id]!.cottage!;
      expect(t.cottageForms[c.form]).toBeTruthy();
      expect(t.cottageMaterials[c.material]).toBeTruthy();
    }
  });
});
