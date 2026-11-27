import { describe, expect, it } from "vitest";
import { DEFAULT_WORLD, KINDS, WATER_CELL, findPlotByAddress, generateWorld, type Kind } from "./generator";
import { LATE_FROM } from "./expansions";
import { buildingsFor } from "./buildings";
import { region } from "./regions";

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

  it("connects every town to the tower by road (wild lands have no towns: boats reach them)", () => {
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
    for (const d of world.districts) if (!region(d.biome).wild) expect(seen[d.y * n + d.x], d.name).toBe(1);
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
    const steps = [0, 1, 2, 3].map((lands) => generateWorld({ ...DEFAULT_WORLD, lands }));
    for (let s = 1; s < steps.length; s++) {
      const before = steps[s - 1];
      const after = steps[s];
      expect(after.districts.length).toBeGreaterThan(before.districts.length);
      expect(after.plots.length).toBeGreaterThan(before.plots.length);
      expect(after.districts.slice(0, before.districts.length)).toEqual(before.districts);
      expect(after.roads.slice(0, before.roads.length)).toEqual(before.roads);
      // every land plot keeps its address and its tiles
      const byAddress = new Map(after.plots.map((p) => [p.address, p]));
      for (const p of before.plots) {
        const q = byAddress.get(p.address);
        if (p.water) {
          // a water plot may only lose the tiles that new land rose from
          if (q) for (const t of q.tiles) expect(p.tiles).toContain(t);
          continue;
        }
        expect(q?.tiles.join(), p.address).toBe(p.tiles.join());
      }
      for (let i = 0; i < n * n; i++) {
        if (after.kind[i] === before.kind[i]) continue;
        // only open sea may change: into new land, or into a bridge over it
        expect(["deep", "ocean", "shallow"]).toContain(KINDS[before.kind[i]]);
        expect(before.plotOf[i] < 0 || before.plots[before.plotOf[i]].water).toBe(true);
      }
    }
  });

  it("keeps the ids of the plots that existed before lots and water plots", () => {
    // street plots and islands come first, in the same order as before, so old ?plot=<id> links still work
    const firstLot = world.plots.findIndex((p) => p.address.startsWith("Lot ") || p.water);
    expect(firstLot).toBe(1669);
    expect(world.plots.slice(firstLot).every((p) => p.address.startsWith("Lot ") || p.water)).toBe(true);
  });

  it("divides all land into plots: nothing buildable is left without one", () => {
    const land = new Set<Kind>(["land", "forest", "hill", "beach", "mountain", "peak"]);
    let left = 0;
    for (let i = 0; i < n * n; i++) if (land.has(kindAt(i)) && world.plotOf[i] < 0) left++;
    expect(left).toBe(0);
    const lots = world.plots.filter((p) => p.address.startsWith("Lot "));
    expect(lots.length).toBeGreaterThan(500);
    expect(lots.some((p) => p.landscape === "mountain")).toBe(true);
    const sizes = lots.map((p) => p.tiles.length);
    expect(Math.max(...sizes)).toBeLessThan(120);
  });

  it("divides the sea, lagoons and lakes into water plots on a fixed grid", () => {
    const water = world.plots.filter((p) => p.water);
    expect(water.length).toBeGreaterThan(1500);
    for (const p of water) {
      expect(p.address).toMatch(/^(Water|Lake) Plot \d+-\d+$/);
      expect(p.tiles.length).toBeLessThanOrEqual(WATER_CELL * WATER_CELL);
    }
    let sea = 0;
    let plotted = 0;
    for (let i = 0; i < n * n; i++)
      if (["deep", "ocean", "shallow"].includes(kindAt(i))) {
        sea++;
        if (world.plotOf[i] >= 0) plotted++;
      }
    expect(plotted / sea).toBeGreaterThan(0.99);
    const kinds = new Set(water.map((p) => p.landscape));
    for (const k of ["lagoon", "shallows", "sea", "deepSea", "lake"]) expect(kinds.has(k as never), k).toBe(true);
    expect(new Set(world.plots.map((p) => p.address)).size).toBe(world.plots.length);
    const p = water[200];
    expect(findPlotByAddress(world, p.address.toLowerCase())?.id).toBe(p.id);
  });

  it("keeps every plot id when a late land rises (the server's registry is keyed by id)", () => {
    const before = generateWorld({ ...DEFAULT_WORLD, lands: LATE_FROM });
    for (const p of before.plots) expect(world.plots[p.id].address, String(p.id)).toBe(p.address);
    // water plots under the new islands keep at least four tiles of water
    for (const p of world.plots) if (p.water) expect(p.tiles.length).toBeGreaterThanOrEqual(4);
  });

  it("raises the Halcyon Archipelago: wild palm isles with mountains, lakes, fields and harbours, no houses", () => {
    const land = world.expansions.find((e) => e.name === "Halcyon Archipelago")!;
    expect(land).toBeTruthy();
    expect(land.districts.length).toBe(4);
    const own = new Set(land.districts);
    const kinds = new Set<string>();
    for (let i = 0; i < n * n; i++) if (world.zone[i] === land.zone) kinds.add(kindAt(i));
    for (const k of ["beach", "land", "forest", "hill", "mountain", "lake", "shallow"]) expect(kinds.has(k), k).toBe(true);
    for (const k of ["road", "street", "bridge", "plaza"]) expect(kinds.has(k), k).toBe(false);
    const lots = world.plots.filter((p) => !p.water && own.has(p.district));
    expect(lots.length).toBeGreaterThan(150);
    expect(lots.every((p) => p.address.startsWith("Lot "))).toBe(true);
    const houses = buildingsFor(world);
    expect(lots.every((p) => houses[p.id] === null)).toBe(true);
  });

  it("adds Greenhaven meadows, Mistmarsh wetlands and a northern archipelago", () => {
    const names = world.districts.map((d) => d.name);
    for (const name of ["Greenhaven", "Mistmarsh", "Stormcrest Isles"]) expect(names).toContain(name);
    for (const e of world.expansions) expect(world.plots.filter((p) => e.districts.includes(p.district)).length, e.name).toBeGreaterThan(50);
  });
});
