import { useMemo, useState } from "react";
import { Car, Coins, Footprints, Loader2, Plane, Ship, TrainFront, type LucideIcon } from "lucide-react";
import type { World } from "@/game/world/generator";
import type { HubInfo, Location, NetworkInfo } from "./api";
import { toRoutes } from "./api";
import { DEFAULT_FARES, HUB_FOR, districtCentre, fare, legSeconds, planTrips, tilePath, travelTax, type Leg, type Mode, type Plan } from "./network";
import { pathPoints, type Point, type TripSegment } from "./drop";
import type { TravelStrings } from "./strings";

export const MODE_ICON: Record<Mode, LucideIcon> = { walk: Footprints, car: Car, train: TrainFront, ferry: Ship, plane: Plane };

/** Where the drop of a location stands on the map. */
export const locationPoint = (loc: Location): Point => ({ x: loc.x, y: loc.y });

const hubOf = (net: NetworkInfo, mode: Mode, district: number) => {
  const kind = mode === "walk" ? null : HUB_FOR[mode];
  return kind ? net.hubs.find((h) => h.kind === kind && h.district === district) ?? null : null;
};

/**
 * The trip on the map, leg by leg, from where the drop stands: a short walk
 * to the station or harbour, the ride along the rails, the road or the sea
 * lane, and at the end a walk to the plot.
 */
export function tripSegments(world: World, net: NetworkInfo, from: Point, legs: { mode: Mode; to: number }[], plotAnchor: Point | null, start: number): TripSegment[] {
  const n = world.size;
  const idx = (p: Point) => Math.round(p.y) * n + Math.round(p.x);
  const segs: TripSegment[] = [];
  let pos = from;
  const move = (mode: Mode, to: Point) => {
    if (Math.round(pos.x) === Math.round(to.x) && Math.round(pos.y) === Math.round(to.y)) return;
    let pts: Point[];
    if (mode === "plane") pts = [pos, to];
    else {
      const p = tilePath(world, mode, idx(pos), idx(to), 20000);
      pts = p ? pathPoints(p, n, mode === "walk" ? 1 : 2) : [pos, to];
    }
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    segs.push({ mode, pts, seconds: mode === "walk" ? Math.min(3, Math.max(0.6, len / 22)) : legSeconds(mode, len) });
    pos = to;
  };
  let cur = start;
  for (const l of legs) {
    if (l.mode === "walk") continue;
    if (l.mode === "car") move("car", districtCentre(world, l.to));
    else {
      const a = hubOf(net, l.mode, cur);
      const b = hubOf(net, l.mode, l.to);
      if (a) move("walk", a);
      move(l.mode, b ?? districtCentre(world, l.to));
    }
    cur = l.to;
  }
  if (plotAnchor) move("walk", plotAnchor);
  return segs;
}

const totalWithTax = (plan: Plan) => plan.fare;

interface OptionsProps {
  world: World;
  net: NetworkInfo;
  me: Location;
  target: number;
  balance: number | null;
  busy: boolean;
  t: TravelStrings;
  onGo: (legs: Leg[]) => void;
}

/** Ways to get to a district: the cheapest and the fastest, with fares. */
export function TravelOptions({ world, net, me, target, balance, busy, t, onGo }: OptionsProps) {
  const fares = { ...DEFAULT_FARES, ...net.fares };
  const plans = useMemo(() => planTrips(toRoutes(net), me.districtId, target, fares), [net, me.districtId, target]); // eslint-disable-line react-hooks/exhaustive-deps
  const name = (d: number) => world.districts[d]?.name ?? "?";
  if (!plans.length) return <p className="rounded-md bg-muted/60 p-2.5 text-xs text-muted-foreground">{t.unreachable}</p>;
  return (
    <div className="space-y-2">
      {plans.map((p, k) => {
        const cost = totalWithTax(p);
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
                return (
                  <li key={i} className="flex items-center gap-1.5">
                    <Icon className="h-3.5 w-3.5 shrink-0 text-primary" />
                    <span className="truncate">
                      {t.modes[l.mode]}: {name(l.from)} → {name(l.to)}
                    </span>
                    <span className="ml-auto shrink-0 text-muted-foreground">{l.fare} TIDE</span>
                  </li>
                );
              })}
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
  travel: React.ReactNode;
}

/** A station, harbour or airport: who owns it, what it earns, where it goes, and buying it. */
export function HubCard({ hub, world, net, me, busy, t, onBuy, travel }: HubProps) {
  const [buying, setBuying] = useState(false);
  const fares = { ...DEFAULT_FARES, ...net.fares };
  const mode: Mode = hub.kind === "station" ? "train" : hub.kind === "port" ? "ferry" : "plane";
  const Icon = MODE_ICON[mode];
  const out = toRoutes(net)
    .filter((r) => r.mode === mode && (r.a === hub.district || r.b === hub.district))
    .map((r) => ({ to: r.a === hub.district ? r.b : r.a, fare: fare(mode, r.dist, fares) }))
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
          <ul className="max-h-32 space-y-0.5 overflow-auto text-sm">
            {out.map((o) => (
              <li key={o.to} className="flex justify-between gap-2">
                <span className="truncate">{world.districts[o.to]?.name}</span>
                <span className="shrink-0 text-muted-foreground">
                  {o.fare} TIDE <span className="text-[11px]">({travelTax(o.fare, net.taxPct)} tax)</span>
                </span>
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

