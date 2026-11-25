import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, Wrench } from "lucide-react";
import { toast } from "sonner";
import { useLanguage } from "@/i18n/LanguageContext";
import { useAccount } from "@/game/account/AccountContext";
import { useEconomy } from "@/game/economy/EconomyContext";
import { buyRoad, fetchRoads, repairRoad, type Result, type RoadsView } from "./api";
import { roadsStrings } from "./strings";

/** Map card part for a tapped road: the roads that leave this district, with buy and repair. */
export function RoadsHere({ district }: { district: number }) {
  const { language } = useLanguage();
  const t = roadsStrings(language);
  const { session, signOut } = useAccount();
  const { refresh } = useEconomy();
  const [view, setView] = useState<RoadsView | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetchRoads(session);
    if (r.ok) setView(r.data);
    else if (r.error === "session") signOut();
  }, [session, signOut]);
  useEffect(() => {
    void load();
  }, [load]);

  const act = async (id: string, call: () => Promise<Result<RoadsView>>, ok: string) => {
    setBusy(id);
    const r = await call();
    setBusy(null);
    if (!r.ok) {
      if (r.error === "session") signOut();
      else toast.error(t.errors[r.error]);
      return;
    }
    setView(r.data);
    toast.success(ok);
    void refresh();
  };

  if (!view) return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
  const roads = view.roads.filter((r) => r.a === district || r.b === district);
  if (!roads.length) return null;
  const standing = view.here === district;
  return (
    <div className="space-y-1.5">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t.roadsHere}</div>
      <ul className="max-h-48 space-y-1.5 overflow-auto">
        {roads.map((r) => (
          <li key={r.id} className="rounded-md border border-border/70 bg-muted/30 p-2 text-xs">
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate font-medium text-foreground">{r.name}</span>
              <span className="shrink-0 text-muted-foreground">{t.pct(r.cond)}</span>
            </div>
            <div className="text-muted-foreground">{t.owner}: {r.mine ? t.yoursShort : r.owner ?? t.stateOwned}</div>
            {!r.owner && session && (standing ? (
              <button disabled={busy !== null} onClick={() => act(r.id, () => buyRoad(session, r.id), t.bought(r.name))}
                className="mt-1 flex h-8 w-full items-center justify-center gap-1.5 rounded-md bg-amber-400 font-semibold text-black hover:bg-amber-300 disabled:opacity-50">
                {busy === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : t.buy(r.price)}
              </button>
            ) : (
              <p className="mt-0.5 text-amber-200">{t.priceAway(r.price)}</p>
            ))}
            {r.mine && session && r.repairCost > 0 && (
              <button disabled={busy !== null} onClick={() => act(r.id, () => repairRoad(session, r.id), t.repaired(r.repairCost))}
                className="mt-1 flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-border hover:bg-muted disabled:opacity-50">
                {busy === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><Wrench className="h-3.5 w-3.5" />{t.repair(r.repairCost)}</>}
              </button>
            )}
          </li>
        ))}
      </ul>
      <Link to="/roads" className="text-xs text-primary hover:underline">{t.allRoads}</Link>
    </div>
  );
}
