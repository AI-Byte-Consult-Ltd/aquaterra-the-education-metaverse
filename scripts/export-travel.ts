/**
 * Writes public/world/travel.json before each build: the transport network of
 * the world map (stations, airports, harbours, routes), each town centre and
 * each plot's anchor tile. The travel server ("[66 PUBLIC] AquaTerra Travel")
 * loads it from the live site, so new lands get their transport by themselves.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { DEFAULT_WORLD, generateWorld } from "../src/game/world/generator";
import { buildNetwork, districtCentre } from "../src/game/travel/network";

const world = generateWorld(DEFAULT_WORLD);
const net = buildNetwork(world);
const out = resolve(process.argv[2] ?? "public", "world");
mkdirSync(out, { recursive: true });
writeFileSync(
  resolve(out, "travel.json"),
  JSON.stringify({
    version: 1,
    hubs: net.hubs.map((h) => [h.id, h.kind, h.district, h.name, h.x, h.y]),
    routes: net.routes.map((r) => [r.mode, r.a, r.b, r.dist]),
    centres: world.districts.map((d) => {
      const c = districtCentre(world, d.id);
      return [d.id, c.x, c.y];
    }),
    anchors: world.plots.map((p) => [p.id, p.anchor.x, p.anchor.y]),
  }),
);
console.log(`travel.json: ${net.hubs.length} hubs, ${net.routes.length} routes`);
