/**
 * Writes dist/world/districts.json: every district of the world map with a
 * stable id. The governance server reads this file from the site and gives
 * each new district its Mayor and Assembly seat on its own, so adding a land
 * in src/game/world/expansions.ts is all it takes. Run after `vite build`.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { listDistricts } from "../src/game/world/districts";

const out = resolve(process.argv[2] ?? "dist", "world");
mkdirSync(out, { recursive: true });
const list = listDistricts();
writeFileSync(resolve(out, "districts.json"), JSON.stringify(list));
console.log(`districts.json: ${list.length} districts`);
