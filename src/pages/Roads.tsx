import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, Route as RoadIcon, Truck, Wrench } from "lucide-react";
import { toast } from "sonner";
import { useLanguage } from "@/i18n/LanguageContext";
import { useAccount } from "@/game/account/AccountContext";
import { useEconomy } from "@/game/economy/EconomyContext";
import { Shell } from "@/game/state/ui";
import { Panel, Stat, btnMain, btnSoft } from "@/game/bank/ui";
import { buyRoad, fetchRoads, repairRoad, type Result, type Road, type RoadsError, type RoadsView } from "@/game/roads/api";
import { roadsStrings } from "@/game/roads/strings";

const condColour = (c: number, worn: number, crit: number) => (c < crit + 10 ? "bg-red-500" : c < worn ? "bg-amber-400" : "bg-emerald-400");

/** /roads: every road, who owns it, its condition; buy and repair for citizens; First Light Transit. */
const Roads = () => {
  const { language } = useLanguage();
  const t = roadsStrings(language);
  const { session, signOut } = useAccount();
  const { refresh } = useEconomy();
  const [view, setView] = useState<RoadsView | null>(null);
  const [error, setError] = useState<RoadsError | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [forSale, setForSale] = useState(false);

  const load = useCallback(async () => {
    const r = await fetchRoads(session);
    if (r.ok) {
      setView(r.data);
      setError(null);
    } else if (r.error === "session") signOut();
    else setError(r.error);
  }, [session, signOut]);
  useEffect(() => {
    void load();
  }, [load]);

  const act = async (key: string, call: () => Promise<Result<RoadsView>>, ok: (d: RoadsView & { cost?: number }) => void) => {
    setBusy(key);
    const r = await call();
    setBusy(null);
    if (!r.ok) {
      if (r.error === "session") signOut();
      else toast.error(t.errors[r.error]);
      return;
    }
    setView(r.data);
    ok(r.data);
    void refresh();
  };

  const l = {
    road_price_base: 2000, road_price_per_tile: 40, road_max_per_citizen: 3, road_decay_day_pct: 0.2, road_wear_trip_pct: 0.1,
    road_repair_full_pct: 30, road_full_income_pct: 50, road_auto_repair_pct: 20, road_takeover_refund_pct: 50, travel_tax_pct: 10,
    ...(view?.laws ?? {}),
  };
  const mine = view?.roads.filter((r) => r.mine) ?? [];
  const list = (view?.roads ?? []).filter((r) => !forSale || !r.owner);

  const card = (r: Road) => {
    const here = view?.here != null && (view.here === r.a || view.here === r.b);
    return (
      <li key={r.id} className="space-y-2 rounded-xl border border-border bg-card/60 p-3 text-sm">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="font-semibold">{r.name}</span>
          <span className="text-xs text-muted-foreground">{t.length(r.dist)}</span>
        </div>
        <div>
          <div className="mb-1 flex justify-between text-xs text-muted-foreground">
            <span>{t.condition}</span>
            <span>{t.pct(r.cond)}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div className={`h-full ${condColour(r.cond, l.road_full_income_pct, l.road_auto_repair_pct)}`} style={{ width: `${Math.max(2, r.cond)}%` }} />
          </div>
          {r.owner && r.cond < l.road_full_income_pct && <p className="mt-1 text-xs text-amber-300">{r.cond < l.road_auto_repair_pct + 10 ? t.critical : t.worn}</p>}
        </div>
        <p className="text-xs text-muted-foreground">
          {t.owner}: <span className="text-foreground">{r.owner ?? t.stateOwned}</span> · {t.tripsRevenue(r.trips, r.revenue)}
        </p>
        {!r.owner &&
          (session && here ? (
            <button className={btnMain} disabled={busy !== null}
              onClick={() => act(r.id, () => buyRoad(session, r.id), () => toast.success(t.bought(r.name)))}>
              {busy === r.id ? <Loader2 className="h-4 w-4 animate-spin" /> : t.buy(r.price)}
            </button>
          ) : session ? (
            <p className="text-xs text-amber-200">{t.priceAway(r.price)}</p>
          ) : (
            <p className="text-xs text-muted-foreground">{t.price}: {t.tide(r.price)}</p>
          ))}
        {r.mine && session && (
          r.repairCost > 0 ? (
            <button className={btnSoft} disabled={busy !== null}
              onClick={() => act(r.id, () => repairRoad(session, r.id), (d) => toast.success(t.repaired(d.cost ?? r.repairCost)))}>
              {busy === r.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Wrench className="h-4 w-4" />{t.repair(r.repairCost)}</>}
            </button>
          ) : (
            <p className="text-xs text-emerald-300">{t.fullRepair}</p>
          )
        )}
      </li>
    );
  };

  return (
    <Shell title={t.title} icon={RoadIcon} back={{ to: "/world", label: t.backToWorld }}>
      <p className="mb-5 max-w-2xl text-sm text-muted-foreground">{t.intro}</p>
      {error && <p className="mb-4 text-sm text-destructive">{t.errors[error]}</p>}
      {!view && !error && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}
      {view && (
        <div className="space-y-6">
          <Panel title={t.company} icon={Truck}>
            <p className="text-sm text-muted-foreground">{t.companyIntro}</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label={t.companyBalance} v={view.company.balance} sub={t.companyRoads(view.company.roads, view.company.sold)} />
              <Stat label={t.tolls} v={view.company.tolls} />
              <Stat label={t.repairsPaid} v={view.company.repairs} />
              <Stat label={t.sales} v={view.company.sales} />
            </div>
          </Panel>
          <Panel title={t.rulesTitle}>
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              {t.rules(l).map((x) => <li key={x}>{x}</li>)}
            </ul>
          </Panel>
          {session ? (
            <Panel title={t.mine} icon={RoadIcon}>
              {view.balance != null && <p className="text-sm text-muted-foreground">{t.spendable(view.balance)}</p>}
              {mine.length ? <ul className="grid gap-3 md:grid-cols-2">{mine.map(card)}</ul> : <p className="text-sm text-muted-foreground">{t.noMine}</p>}
            </Panel>
          ) : (
            <p className="text-sm"><Link to="/login" className="text-primary hover:underline">{t.signIn}</Link></p>
          )}
          <Panel title={t.all}>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={forSale} onChange={(e) => setForSale(e.target.checked)} />
              {t.filterForSale}
            </label>
            <ul className="grid gap-3 md:grid-cols-2">{list.map(card)}</ul>
          </Panel>
        </div>
      )}
    </Shell>
  );
};

export default Roads;
