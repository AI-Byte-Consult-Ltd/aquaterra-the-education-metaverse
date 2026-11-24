import { describe, expect, it } from "vitest";
import { DEFAULT_WORLD, generateWorld } from "../world/generator";
import { buildNetwork, fare, planTrips, reachable, travelTax } from "./network";

const world = generateWorld(DEFAULT_WORLD);
const net = buildNetwork(world);

describe("transport network", () => {
  it("reaches every district from First Light City", () => {
    expect(reachable(net.routes, 0).size).toBe(world.districts.length);
  });

  it("has the stations and airports of the map, and harbours on the islands", () => {
    expect(net.hubs.filter((h) => h.kind === "station")).toHaveLength(world.stations.length);
    expect(net.hubs.filter((h) => h.kind === "airport")).toHaveLength(world.airports.length);
    for (const e of world.expansions) expect(net.hubs.some((h) => h.kind === "port" && e.districts.includes(h.district))).toBe(true);
    expect(new Set(net.hubs.map((h) => h.id)).size).toBe(net.hubs.length);
  });

  it("keeps the ids of hubs and routes stable (the server stores them)", () => {
    expect(net.hubs.slice(0, 7).map((h) => h.id)).toEqual(["station:0", "station:30", "station:15", "station:16", "station:3", "airport:3", "airport:17"]);
    expect(net.routes.find((r) => r.mode === "plane")).toMatchObject({ a: 3, b: 17 });
    for (const r of net.routes) expect(r.a).toBeLessThan(r.b);
  });

  it("islands of new lands are reached by ferry only", () => {
    const isles = world.expansions[1].districts;
    const inbound = net.routes.filter((r) => isles.includes(r.a) !== isles.includes(r.b));
    expect(inbound.length).toBeGreaterThan(0);
    expect(inbound.every((r) => r.mode === "ferry")).toBe(true);
  });

  it("plans the cheapest and the fastest trip", () => {
    const plans = planTrips(net.routes, 0, 40);
    expect(plans.length).toBeGreaterThan(0);
    const last = plans[0].legs[plans[0].legs.length - 1];
    expect(last.to).toBe(40);
    expect(plans[0].fare).toBe(plans[0].legs.reduce((s, l) => s + l.fare, 0));
    expect(planTrips(net.routes, 5, 5)[0].legs).toHaveLength(0);
  });

  it("charges fares and the travel tax like the server", () => {
    expect(fare("walk", 500)).toBe(0);
    expect(fare("car", 43)).toBe(2 + 3);
    expect(fare("plane", 202)).toBe(30 + 30);
    expect(travelTax(5, 10)).toBe(1);
    expect(travelTax(60, 10)).toBe(6);
    expect(travelTax(5, 50)).toBe(3);
    expect(travelTax(5, 0)).toBe(0);
  });
});
