/**
 * Writes public/world/districts.json before each build: every district of the world map with a
 * stable id. The governance server reads this file from the site and gives
 * each new district its Mayor and Assembly seat on its own, so adding a land
 * in src/game/world/expansions.ts is all it takes.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { listDistricts } from "../src/game/world/districts";
import { RAINBOW_DISTRICT, RAINBOW_NAME } from "../src/game/rainbowland/grid";
import { PRISM_DISTRICT, PRISM_NAME } from "../src/game/rainbowland/prism";

const out = resolve(process.argv[2] ?? "public", "world");
mkdirSync(out, { recursive: true });
// Rainbowland, the continent of the old LAND NFTs, lives on its own map (/rainbowland).
const list = [...listDistricts(), { id: RAINBOW_DISTRICT, name: RAINBOW_NAME, biome: "rainbow", land: RAINBOW_NAME, capital: false },
  { id: PRISM_DISTRICT, name: PRISM_NAME, biome: "hills", land: PRISM_NAME, capital: false }];
writeFileSync(resolve(out, "districts.json"), JSON.stringify(list));
console.log(`districts.json: ${list.length} districts`);
