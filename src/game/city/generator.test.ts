import { describe, expect, it } from "vitest";
import { DEFAULT_CITY, TILE_KINDS, findPlot, generateCity, kindAt, parseAddress } from "./generator";

const city = generateCity(DEFAULT_CITY);

describe("radial city generator", () => {
  it("is deterministic for the same params", () => {
    const again = generateCity(DEFAULT_CITY);
    expect(again.plots.length).toBe(city.plots.length);
    expect(Buffer.from(again.tiles).equals(Buffer.from(city.tiles))).toBe(true);
  });

  it("changes with the seed", () => {
    const other = generateCity({ ...DEFAULT_CITY, seed: 7 });
    expect(Buffer.from(other.tiles).equals(Buffer.from(city.tiles))).toBe(false);
  });

  it("puts the First Light Tower in the centre", () => {
    const c = Math.floor(city.center);
    expect(kindAt(city, c, c)).toBe("tower");
  });

  it("has primary and branch rays numbered 1..N", () => {
    expect(city.rays.map((r) => r.number)).toEqual(Array.from({ length: 24 }, (_, i) => i + 1));
  });

  it("gives every plot a unique address", () => {
    const keys = new Set(city.plots.map((p) => `${p.ray}/${p.house}`));
    expect(keys.size).toBe(city.plots.length);
    expect(city.plots.length).toBeGreaterThan(500);
  });

  it("numbers odd houses on the left and even on the right, from the tower outwards", () => {
    for (const p of city.plots) expect(p.house % 2 === 1).toBe(p.side === "left");
    const left = city.plots.filter((p) => p.ray === 3 && p.side === "left").sort((a, b) => a.house - b.house);
    for (let i = 1; i < left.length; i++) expect(left[i].distance).toBeGreaterThan(left[i - 1].distance);
    expect(left.map((p) => p.house).slice(0, 3)).toEqual([1, 3, 5]);
  });

  it("keeps plot tiles and the tile→plot index consistent", () => {
    const plotKind = TILE_KINDS.indexOf("plot");
    let count = 0;
    for (let i = 0; i < city.tiles.length; i++) {
      const isPlot = city.tiles[i] === plotKind;
      expect(isPlot).toBe(city.plotOf[i] >= 0);
      if (isPlot) count++;
    }
    expect(count).toBe(city.plots.reduce((s, p) => s + p.tiles.length, 0));
  });

  it("places every plot next to its own street", () => {
    const n = city.size;
    for (const p of city.plots) {
      // some tile of the plot must be within plotDepth+1 tiles of a street/bridge tile of the same ray
      const near = p.tiles.some((t) => {
        const x = t % n;
        const y = (t - x) / n;
        for (let dy = -2; dy <= 2; dy++)
          for (let dx = -2; dx <= 2; dx++) {
            const j = (y + dy) * n + (x + dx);
            if (j >= 0 && j < city.rayOf.length && city.rayOf[j] === p.ray) return true;
          }
        return false;
      });
      expect(near, `plot ${p.ray}/${p.house}`).toBe(true);
    }
  });

  it("builds islands, each reached by a bridge", () => {
    expect(city.islands.length).toBe(DEFAULT_CITY.islands);
    const bridge = TILE_KINDS.indexOf("bridge");
    for (const is of city.islands) {
      const hasBridge = city.tiles.some((k, i) => k === bridge && city.rayOf[i] === is.ray);
      expect(hasBridge).toBe(true);
      expect(city.plots.some((p) => p.onIsland && p.ray === is.ray)).toBe(true);
    }
  });

  it("is surrounded by ocean", () => {
    expect(kindAt(city, 0, 0)).toBe("ocean");
    expect(kindAt(city, city.size - 1, city.size - 1)).toBe("ocean");
  });
});

describe("addresses", () => {
  it("parses Russian, English and short forms", () => {
    expect(parseAddress("Луч 3, дом 12")).toEqual({ ray: 3, house: 12 });
    expect(parseAddress("Ray 3, house 12")).toEqual({ ray: 3, house: 12 });
    expect(parseAddress("3-12")).toEqual({ ray: 3, house: 12 });
    expect(parseAddress("Луч 3")).toBeNull();
  });

  it("finds a plot by address", () => {
    const p = city.plots[42];
    expect(findPlot(city, p.ray, p.house)?.id).toBe(42);
    expect(findPlot(city, 999, 1)).toBeUndefined();
  });
});
