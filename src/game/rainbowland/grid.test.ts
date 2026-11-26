import { describe, expect, it } from "vitest";
import { DEFAULT_WORLD, generateWorld } from "../world/generator";
import { buildNetwork, planTrips } from "../travel/network";
import { COLS, RAINBOW_DISTRICT, ROWS, TOTAL, ZONES, landName, parseCell, tokenAt, tokenX, tokenY } from "./grid";
import { rainbowLinks } from "./travel";

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
  it("cuts the continent into seven zones without gaps", () => {
    expect(ZONES).toHaveLength(7);
    expect(ZONES[0].from).toBe(0);
    expect(ZONES[6].to).toBe(COLS - 1);
    for (let i = 1; i < 7; i++) expect(ZONES[i].from).toBe(ZONES[i - 1].to + 1);
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
