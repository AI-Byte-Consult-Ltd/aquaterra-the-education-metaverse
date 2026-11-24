import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Cpu, Gamepad2, KeyRound, Loader2, Settings2, Trophy } from "lucide-react";
import { toast } from "sonner";
import { useLanguage } from "@/i18n/LanguageContext";
import { useAccount } from "@/game/account/AccountContext";
import { useEconomy } from "@/game/economy/EconomyContext";
import { fetchPlotArcade, rentPlot, taxOf, type PlotArcade as Info } from "./api";
import { arcadeStrings } from "./strings";

/** The arcade part of a plot card: what plays here, and the way in. */
export default function PlotArcade({ plotId, rentTaxPct = 3, onChange }: { plotId: number; rentTaxPct?: number; onChange?: () => void }) {
  const { language } = useLanguage();
  const t = arcadeStrings(language);
  const { session } = useAccount();
  const economy = useEconomy();
  const [info, setInfo] = useState<Info | null>(null);
  const [days, setDays] = useState(1);
  const [renting, setRenting] = useState(false);

  const load = useCallback(async () => {
    const r = await fetchPlotArcade(session, plotId);
    if (r.ok) setInfo(r.data);
  }, [session, plotId]);
  useEffect(() => {
    setInfo(null);
    void load();
  }, [load]);

  if (!info) return <div className="h-6" />;
  const a = info.attraction;
  const me = info.me;
  const until = (iso: string) => new Date(iso).toLocaleDateString("en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  const operator = me?.role === "owner" || me?.role === "tenant";

  return (
    <div className="space-y-2 rounded-lg border border-fuchsia-400/30 bg-fuchsia-500/5 p-3">
      <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-fuchsia-200">
        <Gamepad2 className="h-4 w-4" />
        {t.attractionHere}
      </div>
      {a ? (
        <>
          <div>
            <div className="font-display text-base font-bold">{a.title}</div>
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              {a.ai && <Cpu className="h-3.5 w-3.5 text-cyan-300" />}
              {t.templates[a.template]} · {t.difficulties[a.difficulty]} · {a.ai ? t.byAi : t.by(a.operator)}
            </div>
          </div>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
            <dt className="text-muted-foreground">{t.ticket}</dt>
            <dd className="font-medium">{a.entryFee > 0 ? t.tide(a.entryFee) : t.free}</dd>
            <dt className="text-muted-foreground">{t.prize}</dt>
            <dd className="font-semibold text-cyan-200">{a.prize > 0 && a.pool > 0 ? t.tide(Math.min(a.prize, a.pool)) : "—"}</dd>
          </dl>
          <p className="text-xs text-muted-foreground">
            {t.rulesLine(a.template, a.rules)}. {a.pool > 0 ? t.poolLeft(a.pool) : t.noPool}. {t.played(a.plays, a.wins)}.
          </p>
          {a.best && a.best.length > 0 && (
            <p className="flex items-center gap-1 text-xs text-amber-200">
              <Trophy className="h-3.5 w-3.5" />
              {a.best.slice(0, 3).map((b) => `${b.name} ${b.score}`).join(" · ")}
            </p>
          )}
          {!session ? null : operator ? (
            <div className="flex gap-2">
              <Link to={`/arcade/play/${plotId}`} className="flex h-9 flex-1 items-center justify-center rounded-md border border-fuchsia-300/60 text-sm font-semibold text-fuchsia-100 hover:bg-fuchsia-400/10">
                {t.tryOwn}
              </Link>
              <Link to={`/arcade/setup/${plotId}`} aria-label={t.manage} title={t.manage} className="flex h-9 w-9 items-center justify-center rounded-md border border-border hover:border-primary">
                <Settings2 className="h-4 w-4" />
              </Link>
            </div>
          ) : me && !me.here ? (
            <p className="rounded-md bg-muted/60 p-2 text-xs text-muted-foreground">{t.goThere}</p>
          ) : (
            <>
              <Link
                to={`/arcade/play/${plotId}`}
                className={`flex h-10 w-full items-center justify-center gap-2 rounded-md bg-fuchsia-400 text-sm font-semibold text-black hover:bg-fuchsia-300 ${me?.attemptsLeft === 0 ? "pointer-events-none opacity-50" : ""}`}
              >
                <Gamepad2 className="h-4 w-4" />
                {a.entryFee > 0 ? t.playFor(t.tide(a.entryFee)) : t.play}
              </Link>
              {me && (
                <p className="text-xs text-muted-foreground">
                  {t.attemptsLeft(me.attemptsLeft ?? 0)}
                  {me.prizeHereToday ? ` · ${t.prizeTaken}` : ""}
                </p>
              )}
            </>
          )}
        </>
      ) : (
        <p className="text-xs text-muted-foreground">{t.noAttraction}</p>
      )}

      {info.rental && <p className="text-xs text-amber-200">{info.rental.mine ? t.rentedByYou(until(info.rental.endsAt)) : t.rentedTo(info.rental.tenant, until(info.rental.endsAt))}</p>}

      {session && operator && !a && (
        <Link to={`/arcade/setup/${plotId}`} className="flex h-9 w-full items-center justify-center gap-2 rounded-md bg-fuchsia-400 text-sm font-semibold text-black hover:bg-fuchsia-300">
          <Settings2 className="h-4 w-4" />
          {t.setUp}
        </Link>
      )}
      {session && me?.role === "owner" && !info.rental && (
        <Link to={`/arcade/setup/${plotId}#rent`} className="block text-xs text-fuchsia-200 hover:underline">
          {info.rentOffer ? t.forRent(info.rentOffer.pricePerDay, info.rentOffer.maxDays) : t.offerTitle} →
        </Link>
      )}

      {info.rentOffer && !info.rental && me && !me.role && (
        <div className="space-y-1.5 border-t border-fuchsia-400/20 pt-2">
          <p className="text-xs text-amber-200">{t.forRent(info.rentOffer.pricePerDay, info.rentOffer.maxDays)}</p>
          <div className="flex items-center gap-2">
            <label className="text-xs text-muted-foreground" htmlFor="rent-days">{t.rentDays}</label>
            <input
              id="rent-days"
              type="number"
              min={1}
              max={info.rentOffer.maxDays}
              value={days}
              onChange={(e) => setDays(Math.max(1, Math.min(info.rentOffer!.maxDays, Number(e.target.value) || 1)))}
              className="h-8 w-16 rounded-md border border-input bg-background/60 px-2 text-sm"
            />
            <button
              disabled={renting || !session || me.free < info.rentOffer.pricePerDay * days}
              onClick={async () => {
                if (!session) return;
                setRenting(true);
                const r = await rentPlot(session, plotId, days);
                setRenting(false);
                if (!r.ok) toast.error(t.errors[r.error]);
                else {
                  toast.success(t.rented(r.data.days));
                  await economy.refresh();
                  await load();
                  onChange?.();
                }
              }}
              className="flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md bg-amber-300 text-xs font-semibold text-black hover:bg-amber-200 disabled:opacity-50"
            >
              {renting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />}
              {t.rentIt}
            </button>
          </div>
          <p className="text-[11px] text-muted-foreground">{t.rentTotal(info.rentOffer.pricePerDay * days, taxOf(info.rentOffer.pricePerDay * days, rentTaxPct))}</p>
        </div>
      )}
    </div>
  );
}
