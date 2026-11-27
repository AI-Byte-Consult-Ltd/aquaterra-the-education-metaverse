/**
 * Writes public/world/build-sites.json before each build: what may be built on
 * each plot and what stands there at the start. The build server
 * ("[68 PUBLIC] AquaTerra Build") loads it from the live site every hour.
 * flags: 1 buildable, 2 skyscraper allowed (2,000 m² or more), 4 city centre, 8 by the water (a pier fits).
 * A plot by the water also lists the water plots a harbour there would cover.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { DEFAULT_WORLD, generateWorld } from "../src/game/world/generator";
import { buildingsFor, hasHouse, isCentre, starterKind, towerSite } from "../src/game/world/buildings";
import { isCoastal, pierWaters } from "../src/game/build/piers";

const world = generateWorld(DEFAULT_WORLD);
const start = buildingsFor(world);
const out = resolve(process.argv[2] ?? "public", "world");
mkdirSync(out, { recursive: true });
const sites = world.plots.map((p) => {
  const coastal = isCoastal(world, p);
  const row: unknown[] = [p.id, (hasHouse(p) ? 1 : 0) | (towerSite(p) ? 2 : 0) | (isCentre(world, p) ? 4 : 0) | (coastal ? 8 : 0), starterKind(start[p.id])];
  if (coastal) row.push(pierWaters(world, p));
  return row;
});
writeFileSync(resolve(out, "build-sites.json"), JSON.stringify({ version: 1, sites }));
console.log(`build-sites.json: ${sites.length} plots, ${sites.filter((s) => (s[1] as number) & 2).length} skyscraper sites, ${sites.filter((s) => (s[1] as number) & 8).length} by the water`);
