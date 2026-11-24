import { describe, expect, it } from "vitest";
import { DEFAULT_WORLD, generateWorld } from "./generator";
import { listDistricts } from "./districts";

describe("district list for the governance server", () => {
  const list = listDistricts(generateWorld(DEFAULT_WORLD));
  it("lists every district once with a stable id", () => {
    expect(list.map((d) => d.id)).toEqual(list.map((_, i) => i));
    expect(new Set(list.map((d) => d.name)).size).toBe(list.length);
    expect(list[0]).toMatchObject({ id: 0, name: "First Light City", capital: true, land: "Continent" });
  });
  it("names the land of each district", () => {
    const lands = new Set(list.map((d) => d.land));
    for (const l of ["Continent", "Oceania", "Greenhaven Isle", "Northern Archipelago"]) expect(lands.has(l), l).toBe(true);
  });
});
