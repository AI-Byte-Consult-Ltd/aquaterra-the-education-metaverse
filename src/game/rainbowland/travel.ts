/**
 * How Rainbowland joins the transport network. It lies across the ocean, off the
 * main map, so its harbour and station stand where the sea lane and the Rainbow
 * Bridge leave the map: on the map edge, in line from the tower through the harbour
 * nearest to First Light City. First Light City itself has no sea shore, so the ferry
 * sails from that harbour; the Rainbow Bridge carries a road and a railway straight
 * from First Light City to Rainbowland Station.
 */
import type { World } from "../world/generator";
import { landOf, type Network } from "../travel/network";
import { RAINBOW_DISTRICT } from "./grid";

const CAPITAL = 0;
/** Lengths of the crossings, in tiles: across the ocean, longer than any crossing on the map. */
export const RAINBOW_FERRY = 360;
export const RAINBOW_BRIDGE = 420;

/** Point on the edge of the map, in line from the centre through (x, y). */
export function edgePoint(world: World, x: number, y: number) {
  const c = world.center;
  const dy = y - c;
  const dx = x - c || (dy ? 0 : 1);
  const k = Math.min(dx ? (dx > 0 ? world.size - 1 - c : c) / Math.abs(dx) : Infinity, dy ? (dy > 0 ? world.size - 1 - c : c) / Math.abs(dy) : Infinity);
  return { x: Math.round(c + dx * k), y: Math.round(c + dy * k) };
}

export function rainbowLinks(world: World, net: Network): Network & { extraCentres: [number, number, number][] } {
  const c = world.center;
  const port =
    net.hubs
      .filter((h) => h.kind === "port" && landOf(world, h.district) === 0)
      .sort((a, b) => Math.hypot(a.x - c, a.y - c) - Math.hypot(b.x - c, b.y - c) || a.district - b.district)[0] ?? null;
  const shore = port ? edgePoint(world, port.x, port.y) : { x: world.size - 1, y: c };
  const hubs = [
    ...net.hubs,
    { id: `port:${RAINBOW_DISTRICT}`, kind: "port" as const, district: RAINBOW_DISTRICT, name: "Rainbow Harbour", x: shore.x, y: shore.y },
    { id: `station:${RAINBOW_DISTRICT}`, kind: "station" as const, district: RAINBOW_DISTRICT, name: "Rainbowland Station", x: shore.x, y: shore.y },
  ];
  const routes = [
    ...net.routes,
    ...(port ? [{ mode: "ferry" as const, a: port.district, b: RAINBOW_DISTRICT, dist: RAINBOW_FERRY }] : []),
    { mode: "car" as const, a: CAPITAL, b: RAINBOW_DISTRICT, dist: RAINBOW_BRIDGE },
    { mode: "train" as const, a: CAPITAL, b: RAINBOW_DISTRICT, dist: RAINBOW_BRIDGE },
  ];
  return { hubs, routes, extraCentres: [[RAINBOW_DISTRICT, shore.x, shore.y]] };
}
