import { useMemo, useState } from "react";
import { Car, Coins, Footprints, Loader2, Plane, Sailboat, Ship, TrainFront, type LucideIcon } from "lucide-react";
import type { World } from "@/game/world/generator";
import type { HubInfo, Location, NetworkInfo } from "./api";
import { toRoutes } from "./api";
import { DEFAULT_FARES, HUB_FOR, boatDist, districtCentre, fare, isWater, isleAt, legSeconds, planTrips, tilePath, travelTax, type Leg, type Mode, type Plan } from "./network";
import { pathPoints, type Point, type TripSegment } from "./drop";
import type { TravelStrings } from "./strings";

export const MODE_ICON: Record<Mode, LucideIcon> = { walk: Footprints, car: Car, train: TrainFront, ferry: Ship, plane: Plane, boat: Sailboat };

/** Where the drop of a location stands on the map. */
export const locationPoint = (loc: Location): Point => ({ x: loc.x, y: loc.y });

const hubOf = (net: NetworkInfo, mode: Mode, district: number) => {
  const kind = mode === "walk" || mode === "boat" ? null : HUB_FOR[mode];
  return kind ? net.hubs.find((h) => h.kind === kind && h.district === district) ?? null : null;
};

/** One move of the drop on the map. Boats are paid: `fare` is set for them. */
export interface Move {
  mode: Mode;
  from: Point;
  to: Point;
  /** Index of the trip leg this move belongs to (-1: the walk to the plot at the end). */
  leg: number;
  fare: number;
}

/**
 * The trip as the drop makes it, move by move, from where it stands: to the
 * station or harbour, the ride, and at the end to the plot. Wherever there is
 * water on the way between two pieces of land (or to a water plot) the drop
 * cannot walk: a boat is called and paid. The travel server charges the same
 * boats by the same rule (server/travel/boats.sql).
 */
export function tripMoves(world: World, net: NetworkInfo, from: Point, legs: { mode: Mode; to: number }[], plotAnchor: Point | null, start: number): Move[] {
  const fares = { ...DEFAULT_FARES, ...net.fares };
  const out: Move[] = [];
  let pos = from;
  // pieces of land are known only on this map; a land off it (Rainbowland) never needs a boat
  let onMap = !!world.districts[start];
  const same = (a: Point, b: Point) => Math.round(a.x) === Math.round(b.x) && Math.round(a.y) === Math.round(b.y);
  const dry = (a: Point, b: Point) => {
    const ia = isleAt(world, a.x, a.y);
    return ia >= 0 && ia === isleAt(world, b.x, b.y);
  };
  const foot = (to: Point, leg: number, known: boolean) => {
    if (same(pos, to)) return;
    if (!onMap || !known || dry(pos, to)) out.push({ mode: "walk", from: pos, to, leg, fare: 0 });
    else out.push({ mode: "boat", from: pos, to, leg, fare: fare("boat", boatDist(pos, to), fares) });
    pos = to;
  };
  const ride = (mode: Mode, to: Point, leg: number) => {
    if (!same(pos, to)) out.push({ mode, from: pos, to, leg, fare: 0 });
    pos = to;
  };
  // a district off this map is reached at its hub on the map edge
  const centre = (d: number): Point => (world.districts[d] ? districtCentre(world, d) : hubOf(net, "ferry", d) ?? hubOf(net, "train", d) ?? pos);
  let cur = start;
  legs.forEach((l, i) => {
    if (l.mode === "walk" || l.mode === "boat") return;
    if (l.mode === "car") {
      const c = centre(cur);
      // by road from where the drop stands; from another islet, by boat to the town first
      if (onMap && world.districts[cur] && !same(pos, c) && !dry(pos, c)) foot(c, i, true);
      ride("car", centre(l.to), i);
    } else {
      const a = hubOf(net, l.mode, cur);
      const b = hubOf(net, l.mode, l.to);
      if (a) foot(a, i, !!world.districts[cur]);
      ride(l.mode, b ?? centre(l.to), i);
    }
    cur = l.to;
    onMap = !!world.districts[cur];
  });
  if (plotAnchor) foot(plotAnchor, -1, true);
  return out;
}

/** What the boats of a trip cost, TIDE. */
export const boatsFare = (moves: Move[]) => moves.reduce((s, m) => s + m.fare, 0);

/** The trip on the map, for the drop to play. */
export function tripSegments(world: World, net: NetworkInfo, from: Point, legs: { mode: Mode; to: number }[], plotAnchor: Point | null, start: number): TripSegment[] {
  const n = world.size;
  const idx = (p: Point) => Math.round(p.y) * n + Math.round(p.x);
  const segs: TripSegment[] = [];
  const push = (mode: Mode, pts: Point[]) => {
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    segs.push({ mode, pts, seconds: mode === "walk" ? Math.min(3, Math.max(0.6, len / 22)) : legSeconds(mode, len) });
  };
  for (const m of tripMoves(world, net, from, legs, plotAnchor, start)) {
    if (m.mode === "plane") {
      push("plane", [m.from, m.to]);
      continue;
    }
    const p = tilePath(world, m.mode, idx(m.from), idx(m.to), 20000);
    if (!p) {
      push(m.mode, [m.from, m.to]);
      continue;
    }
    if (m.mode !== "boat") {
      push(m.mode, pathPoints(p, n, m.mode === "walk" ? 1 : 2));
      continue;
    }
    // a boat ride: walk to the shore, sail, step ashore
    let run: number[] = [];
    let wet = isWater(world.kind[p[0]]);
    for (const i of p) {
      const w = isWater(world.kind[i]);
      if (w !== wet && run.length) {
        push(wet ? "boat" : "walk", pathPoints([...run, i], n, wet ? 2 : 1));
        run = [];
        wet = w;
      }
      run.push(i);
    }
    if (run.length > 1 || !segs.length) push(wet ? "boat" : "walk", pathPoints(run, n, wet ? 2 : 1));
  }
  return segs;
}


interface OptionsProps {
  world: World;
  net: NetworkInfo;
  me: Location;
  target: number;
  /** The plot the trip ends at, if any: a boat may be needed for the last bit. */
  plotAnchor?: Point | null;
  balance: number | null;
  busy: boolean;
  t: TravelStrings;
  onGo: (legs: Leg[]) => void;
}

/** Ways to get to a district: the cheapest and the fastest, with fares. */
export function TravelOptions({ world, net, me, target, plotAnchor = null, balance, busy, t, onGo }: OptionsProps) {
  const fares = { ...DEFAULT_FARES, ...net.fares };
  const plans = useMemo(() => planTrips(toRoutes(net), me.districtId, target, fares), [net, me.districtId, target]); // eslint-disable-line react-hooks/exhaustive-deps
  const name = (d: number) => world.districts[d]?.name ?? "?";
  if (!plans.length) return <p className="rounded-md bg-muted/60 p-2.5 text-xs text-muted-foreground">{t.unreachable}</p>;
  return (
    <div className="space-y-2">
      {plans.map((p, k) => {
        const boats = tripMoves(world, net, locationPoint(me), p.legs, plotAnchor, me.districtId).filter((m) => m.mode === "boat");
        const cost = p.fare + boatsFare(boats);
        const boatsOf = (leg: number) =>
          boats
            .filter((b) => b.leg === leg)
            .map((b, j) => (
              <li key={`b${leg}-${j}`} className="flex items-center gap-1.5">
                <Sailboat className="h-3.5 w-3.5 shrink-0 text-primary" />
                <span className="truncate">{t.boatRow}</span>
                <span className="ml-auto shrink-0 text-muted-foreground">{b.fare} TIDE</span>
              </li>
            ));
        const short = balance !== null && balance < cost;
        return (
          <div key={k} className="rounded-lg border border-border/70 bg-muted/30 p-2.5">
            <div className="mb-1.5 flex items-center justify-between text-xs">
              <span className="font-semibold text-cyan-200">{plans.length > 1 ? (k === 0 ? t.cheapest : t.fastest) : t.travelTitle}</span>
              <span className="text-muted-foreground">
                {t.legs(p.legs.length)} · {t.seconds(p.seconds)}
              </span>
            </div>
            <ol className="mb-2 space-y-1 text-xs">
              {p.legs.map((l, i) => {
                const Icon = MODE_ICON[l.mode];
                return [
                  ...boatsOf(i),
                  <li key={i} className="flex items-center gap-1.5">
                    <Icon className="h-3.5 w-3.5 shrink-0 text-primary" />
                    <span className="truncate">
                      {t.modes[l.mode]}: {name(l.from)} → {name(l.to)}
                    </span>
                    <span className="ml-auto shrink-0 text-muted-foreground">{l.fare} TIDE</span>
                  </li>,
                ];
              })}
              {boatsOf(-1)}
            </ol>
            <button
              disabled={busy || short}
              onClick={() => onGo(p.legs)}
              className="flex h-9 w-full items-center justify-center gap-2 rounded-md bg-cyan-400 text-sm font-semibold text-black hover:bg-cyan-300 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Coins className="h-4 w-4" />}
              {busy ? t.going : t.go(cost)}
            </button>
          </div>
        );
      })}
      <p className="text-[11px] leading-snug text-muted-foreground">{t.taxNote(net.taxPct)}</p>
    </div>
  );
}

interface HubProps {
  hub: HubInfo;
  world: World;
  net: NetworkInfo;
  me: Location | null;
  balance: number | null;
  busy: boolean;
  t: TravelStrings;
  onBuy: (hub: HubInfo) => Promise<void>;
  /** Ride from this hub (only offered while the resident stands in its district). */
  onGo?: (legs: Leg[]) => void;
  travel: React.ReactNode;
}

/** A station, harbour or airport: who owns it, what it earns, where it goes, and buying it. */
export function HubCard({ hub, world, net, me, balance, busy, t, onBuy, onGo, travel }: HubProps) {
  const [buying, setBuying] = useState(false);
  const fares = { ...DEFAULT_FARES, ...net.fares };
  const mode: Mode = hub.kind === "station" ? "train" : hub.kind === "port" ? "ferry" : "plane";
  const Icon = MODE_ICON[mode];
  const out = toRoutes(net)
    .filter((r) => r.mode === mode && (r.a === hub.district || r.b === hub.district))
    .map((r) => ({ to: r.a === hub.district ? r.b : r.a, dist: r.dist, fare: fare(mode, r.dist, fares) }))
    .sort((a, b) => a.fare - b.fare);
  const here = me?.districtId === hub.district;
  return (
    <div className="space-y-3 pr-6">
      <div className="flex items-center gap-2">
        <Icon className="h-5 w-5 text-primary" />
        <div>
          <h2 className="font-display text-lg font-bold leading-tight">{hub.name}</h2>
          <p className="text-xs text-muted-foreground">
            {t.hubKinds[hub.kind]} · {world.districts[hub.district]?.name}
          </p>
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm">
        <dt className="text-muted-foreground">{t.owner}</dt>
        <dd className={`font-medium ${hub.mine ? "text-amber-300" : ""}`}>{hub.mine ? t.yours : hub.owner ?? t.stateOwned}</dd>
        <dt className="text-muted-foreground">{t.trips}</dt>
        <dd className="font-medium">{hub.trips.toLocaleString("en")}</dd>
        {hub.owner && (
          <>
            <dt className="text-muted-foreground">{t.earned}</dt>
            <dd className="font-medium">{hub.revenue.toLocaleString("en")} TIDE</dd>
          </>
        )}
        {!hub.owner && (
          <>
            <dt className="text-muted-foreground">{t.price}</dt>
            <dd className="font-semibold text-cyan-200">{hub.price.toLocaleString("en")} TIDE</dd>
          </>
        )}
      </dl>
      <div>
        <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t.departures}</div>
        {out.length ? (
          <ul className="max-h-44 space-y-1 overflow-auto text-sm">
            {out.map((o) => (
              <li key={o.to} className="flex items-center justify-between gap-2">
                <span className="truncate">{world.districts[o.to]?.name}</span>
                <span className="ml-auto shrink-0 text-muted-foreground">
                  {hub.mine ? t.ownHubFare(travelTax(o.fare, net.taxPct)) : <>{o.fare} TIDE <span className="text-[11px]">({travelTax(o.fare, net.taxPct)} tax)</span></>}
                </span>
                {here && onGo && (
                  <button
                    disabled={busy || (balance !== null && balance < (hub.mine ? travelTax(o.fare, net.taxPct) : o.fare))}
                    onClick={() => onGo([{ mode, from: hub.district, to: o.to, dist: o.dist, fare: o.fare }])}
                    className="h-7 shrink-0 rounded-md bg-cyan-400 px-2.5 text-xs font-semibold text-black hover:bg-cyan-300 disabled:opacity-50"
                  >
                    {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : t.goShort}
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">{t.noLeaving}</p>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{t.hubIncome}</p>
      {!hub.owner && me && (
        here ? (
          <div className="space-y-1.5">
            <button
              disabled={buying || busy}
              onClick={async () => {
                setBuying(true);
                await onBuy(hub);
                setBuying(false);
              }}
              className="flex h-10 w-full items-center justify-center gap-2 rounded-md bg-amber-400 text-sm font-semibold text-black hover:bg-amber-300 disabled:opacity-50"
            >
              {buying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Coins className="h-4 w-4" />}
              {buying ? t.buying : t.buyHub(hub.price)}
            </button>
            <p className="text-[11px] text-muted-foreground">{t.hubBuyNote}</p>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">{t.travelToBuy}</p>
        )
      )}
      {!here && travel}
    </div>
  );
}

