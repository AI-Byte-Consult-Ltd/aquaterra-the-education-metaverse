import { describe, expect, it } from "vitest";
import { DEFAULT_WORLD, KINDS, findPlotByAddress, generateWorld, type Kind } from "./generator";

const world = generateWorld(DEFAULT_WORLD);
const n = world.size;
const kindAt = (i: number): Kind => KINDS[world.kind[i]];

describe("world generator", () => {
  it("is deterministic for the same seed and changes with the seed", () => {
    const again = generateWorld(DEFAULT_WORLD);
    expect(Buffer.from(again.kind).equals(Buffer.from(world.kind))).toBe(true);
    expect(again.plots.map((p) => p.address)).toEqual(world.plots.map((p) => p.address));
    const other = generateWorld({ ...DEFAULT_WORLD, seed: 7 });
    expect(Buffer.from(other.kind).equals(Buffer.from(world.kind))).toBe(false);
  });

  it("puts the First Light Tower in the centre of the capital", () => {
    expect(kindAt(world.center * n + world.center)).toBe("tower");
    expect(world.districts[0].capital).toBe(true);
    expect(world.district[world.center * n + world.center]).toBe(0);
  });

  it("has much ocean and a varied landscape", () => {
    const counts: Partial<Record<Kind, number>> = {};
    for (let i = 0; i < n * n; i++) counts[kindAt(i)] = (counts[kindAt(i)] ?? 0) + 1;
    const water = (counts.deep ?? 0) + (counts.ocean ?? 0) + (counts.shallow ?? 0);
    expect(water / (n * n)).toBeGreaterThan(0.4);
    for (const k of ["forest", "hill", "mountain", "lake", "river", "beach", "bridge", "rail", "runway", "pier"] as Kind[])
      expect(counts[k] ?? 0, k).toBeGreaterThan(0);
  });

  it("has districts with many different climates", () => {
    const biomes = new Set(world.districts.map((d) => d.biome));
    expect(biomes.size).toBeGreaterThanOrEqual(8);
    expect(new Set(world.districts.map((d) => d.name)).size).toBe(world.districts.length);
  });

  it("connects every town to the tower by road", () => {
    const passable = new Set<Kind>(["road", "street", "bridge", "plaza", "tower", "station", "rail"]);
    const seen = new Uint8Array(n * n);
    const start = world.center * n + world.center;
    const queue = [start];
    seen[start] = 1;
    for (let q = 0; q < queue.length; q++) {
      const cur = queue[q];
      const x = cur % n;
      const y = (cur - x) / n;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const j = (y + dy) * n + (x + dx);
        if (x + dx < 0 || y + dy < 0 || x + dx >= n || y + dy >= n || seen[j] || !passable.has(kindAt(j))) continue;
        seen[j] = 1;
        queue.push(j);
      }
    }
    for (const d of world.districts) expect(seen[d.y * n + d.x], d.name).toBe(1);
  });

  it("builds airports and railway stations", () => {
    expect(world.airports.length).toBe(DEFAULT_WORLD.airports);
    expect(world.stations.length).toBeGreaterThanOrEqual(4);
  });

  it("gives plots unique addresses, very different sizes and consistent tiles", () => {
    expect(world.plots.length).toBeGreaterThan(800);
    expect(new Set(world.plots.map((p) => p.address)).size).toBe(world.plots.length);
    const sizes = world.plots.map((p) => p.tiles.length).sort((a, b) => a - b);
    expect(sizes[sizes.length - 1]).toBeGreaterThan(sizes[0] * 10);
    for (const p of world.plots) for (const t of p.tiles) expect(world.plotOf[t]).toBe(p.id);
    const landscapes = new Set(world.plots.map((p) => p.landscape));
    expect(landscapes.size).toBeGreaterThanOrEqual(3);
  });

  it("has Oceania: many islands of their own, of different kinds, reached by bridges", () => {
    const oce = world.districts.filter((d) => d.biome === "oceania");
    expect(oce.length).toBe(DEFAULT_WORLD.oceania);
    const isles = world.plots.filter((p) => p.landscape === "island");
    expect(isles.length).toBeGreaterThan(60);
    expect(new Set(isles.map((p) => p.address)).size).toBe(isles.length);
    const zoneKinds = new Set<Kind>();
    for (let i = 0; i < n * n; i++) if (world.zone[i]) zoneKinds.add(kindAt(i));
    for (const k of ["mountain", "forest", "beach", "land", "shallow"] as Kind[]) expect(zoneKinds.has(k), k).toBe(true);
    expect(findPlotByAddress(world, isles[0].address)?.id).toBe(isles[0].id);
  });

  it("has a great forest district covered in woods", () => {
    const woods = world.districts.find((d) => d.biome === "woodland")!;
    expect(woods).toBeDefined();
    let land = 0;
    let forest = 0;
    for (let i = 0; i < n * n; i++)
      if (world.district[i] === woods.id && ["land", "hill", "forest"].includes(kindAt(i))) {
        land++;
        if (kindAt(i) === "forest") forest++;
      }
    expect(forest / land).toBeGreaterThan(0.8);
  });

  it("has a great desert of sand only", () => {
    const sands = world.districts.find((d) => d.biome === "dunes")!;
    expect(sands).toBeDefined();
    let tiles = 0;
    for (let i = 0; i < n * n; i++)
      if (world.district[i] === sands.id) {
        tiles++;
        expect(["forest", "lake"]).not.toContain(kindAt(i));
      }
    expect(tiles).toBeGreaterThan(1200);
  });

  it("finds a plot by its address", () => {
    const p = world.plots[100];
    expect(findPlotByAddress(world, p.address)?.id).toBe(100);
    expect(findPlotByAddress(world, `  ${p.address.toUpperCase()} `)?.id).toBe(100);
    expect(findPlotByAddress(world, "99999 Nowhere Street")).toBeUndefined();
  });

  it("only grows: new lands leave every existing tile, district, road and address as it was", () => {
    const steps = [0, 1, 2].map((lands) => generateWorld({ ...DEFAULT_WORLD, lands }));
    for (let s = 1; s < steps.length; s++) {
      const before = steps[s - 1];
      const after = steps[s];
      expect(after.districts.length).toBeGreaterThan(before.districts.length);
      expect(after.plots.length).toBeGreaterThan(before.plots.length);
      expect(after.districts.slice(0, before.districts.length)).toEqual(before.districts);
      expect(after.roads.slice(0, before.roads.length)).toEqual(before.roads);
      expect(after.plots.slice(0, before.plots.length).map((p) => [p.address, p.tiles.join()])).toEqual(before.plots.map((p) => [p.address, p.tiles.join()]));
      for (let i = 0; i < n * n; i++) {
        if (after.kind[i] === before.kind[i]) continue;
        // only open sea may change: into new land, or into a bridge over it
        expect(["deep", "ocean", "shallow"]).toContain(KINDS[before.kind[i]]);
        expect(before.plotOf[i]).toBe(-1);
      }
    }
  });

  it("adds Greenhaven meadows, Mistmarsh wetlands and a northern archipelago", () => {
    const names = world.districts.map((d) => d.name);
    for (const name of ["Greenhaven", "Mistmarsh", "Stormcrest Isles"]) expect(names).toContain(name);
    for (const e of world.expansions) expect(world.plots.filter((p) => e.districts.includes(p.district)).length, e.name).toBeGreaterThan(50);
  });
});
