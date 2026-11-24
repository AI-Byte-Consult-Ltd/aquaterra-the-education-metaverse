/**
 * Writes public/land-registry.json from the world generator before each build.
 * The server's land registry is synced from this file on the live site, so new
 * lands added in expansions.ts go on sale after the next deploy.
 */
import { writeFileSync } from "node:fs";
import { DEFAULT_WORLD, generateWorld } from "../src/game/world/generator";
import { landRegistry } from "../src/game/economy/pricing";

const world = generateWorld(DEFAULT_WORLD);
const plots = landRegistry(world);
writeFileSync("public/land-registry.json", JSON.stringify({ version: 1, plots }));
console.log(`land-registry.json: ${plots.length} plots`);
