import { DEFAULT_WORLD, generateWorld, type World } from "./generator";
import { region } from "./regions";

export interface DistrictEntry {
  id: number;
  name: string;
  biome: string;
  land: string;
  capital: boolean;
}

/** All districts of a world, with the land each belongs to. Ids never change: the world only grows. */
export function listDistricts(world: World = generateWorld(DEFAULT_WORLD)): DistrictEntry[] {
  const landOf = new Map<number, string>();
  for (const e of world.expansions) for (const d of e.districts) landOf.set(d, e.name);
  return world.districts.map((d) => ({
    id: d.id,
    name: d.name,
    biome: d.biome,
    land: landOf.get(d.id) ?? (region(d.biome).sea ? "Oceania" : "Continent"),
    capital: d.capital,
  }));
}
