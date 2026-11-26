import { describe, expect, it } from "vitest";
import { DEFAULT_WORLD, generateWorld } from "../world/generator";
import { buildNetwork, planTrips } from "../travel/network";
import { COLS, RAINBOW_DISTRICT, ROWS, TOTAL, landName, parseCell, tokenAt, tokenX, tokenY } from "./grid";
import { rainbowLinks } from "./travel";
import { PRISM_DISTRICT, PRISM_TOTAL, parcelName, parsePrism, prismAt, prismSize } from "./prism";

describe("Rainbowland grid", () => {
  it("keeps the coordinates written in the LAND tokens", () => {
    // read from the token metadata on Cronos
    expect(landName(1)).toBe("LAND (-127, -128)");
    expect(landName(7)).toBe("LAND (-121, -128)");
    expect(landName(932)).toBe("LAND (164, -127)");
    expect(landName(5601)).toBe("LAND (353, -120)");
    expect(landName(9261)).toBe("LAND (173, -114)");
  });
  it("maps every token to one cell and back", () => {
    for (const t of [0, 639, 640, 27_777, TOTAL - 1]) expect(tokenAt(tokenX(t), tokenY(t))).toBe(t);
    expect(tokenAt(tokenX(TOTAL - 1) + 1, tokenY(TOTAL - 1))).toBeNull();
    expect(ROWS).toBe(87);
  });
  it("finds a cell by coordinates or token", () => {
    expect(parseCell("LAND (353, -120)")).toBe(5601);
    expect(parseCell("#5601")).toBe(5601);
    expect(parseCell("999999")).toBeNull();
  });
  it("is reached from First Light City over the bridge and by ferry", () => {
    const world = generateWorld(DEFAULT_WORLD);
    const net = rainbowLinks(world, buildNetwork(world));
    const plans = planTrips(net.routes, 0, RAINBOW_DISTRICT);
    expect(plans.length).toBeGreaterThan(0);
    expect(net.routes.some((r) => r.mode === "ferry" && r.b === RAINBOW_DISTRICT)).toBe(true);
    expect(net.hubs.filter((h) => h.district === RAINBOW_DISTRICT).map((h) => h.kind).sort()).toEqual(["port", "station"]);
  });
});

describe("Prism Hills grid", () => {
  it("lays the 90,000 Polygon LAND on a grid of their own", () => {
    expect(parcelName(1)).toBe("Parcel (0, 0)");
    expect(parcelName(302)).toBe("Parcel (1, 1)");
    expect(parcelName(PRISM_TOTAL)).toBe("Parcel (299, 299)");
    for (const t of [1, 300, 301, 45_000, PRISM_TOTAL]) expect(parsePrism(parcelName(t))).toBe(t);
    expect(prismAt(300, 0)).toBeNull();
    expect(parsePrism("90001")).toBeNull();
    expect(parsePrism("0")).toBeNull();
  });
  it("gives small plots of 1 to 3 cells, the same rule as the server", () => {
    // aquaterra_prism_size(1..20) in server/rainbowland/prism.sql
    expect(Array.from({ length: 20 }, (_, i) => prismSize(i + 1)).join("")).toBe("21211211213212112112");
  });
  it("is reached from Rainbowland by ferry and the causeway", () => {
    const world = generateWorld(DEFAULT_WORLD);
    const net = rainbowLinks(world, buildNetwork(world));
    expect(planTrips(net.routes, 0, PRISM_DISTRICT).length).toBeGreaterThan(0);
    expect(net.hubs.filter((h) => h.district === PRISM_DISTRICT).map((h) => h.kind).sort()).toEqual(["port", "station"]);
  });
});
