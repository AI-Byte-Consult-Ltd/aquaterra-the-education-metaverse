import { describe, expect, it } from "vitest";
import { buildSystems, systemOf, BELT, OUTER } from "./sky";
import type { BodyRow } from "./api";

const row = (name: string, type: string, orbits: string, claims = 1): BodyRow => [name, type, orbits, claims, 0, ["Gold"], 1, null];

describe("orbit chart", () => {
  it("puts each body in its system", () => {
    expect(systemOf({ name: "Charon", orbits: "Pluto" })).toBe("Pluto");
    expect(systemOf({ name: "Saturn", orbits: "Sun" })).toBe("Saturn");
    expect(systemOf({ name: "Vesta", orbits: "Asteroid Belt" })).toBe(BELT);
    expect(systemOf({ name: "Pholus", orbits: "Sun" })).toBe(OUTER);
    expect(systemOf({ name: "X", orbits: "Somewhere" })).toBe(OUTER);
  });
  it("orders systems outwards, planet first in its own system", () => {
    const s = buildSystems([row("Titan", "Moon", "Saturn", 30), row("Saturn", "Planet", "Sun", 5), row("Vesta", "Asteroid", "Asteroid Belt"), row("Io", "Moon", "Jupiter"), row("Farout", "Trans Neptunian Object", "Sun")]);
    expect(s.map((x) => x.key)).toEqual([BELT, "Jupiter", "Saturn", OUTER]);
    const sat = s.find((x) => x.key === "Saturn")!;
    expect(sat.bodies[0].name).toBe("Saturn");
    expect(sat.claims).toBe(35);
  });
});
