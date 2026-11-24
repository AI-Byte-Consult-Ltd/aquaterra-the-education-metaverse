import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Brain, CheckCircle2, Coins, Cpu, Gamepad2, KeyRound, ListChecks, Loader2, MapPin, Scale, Trophy } from "lucide-react";
import { toast } from "sonner";
import { useLanguage } from "@/i18n/LanguageContext";
import { useAccount } from "@/game/account/AccountContext";
import { useEconomy } from "@/game/economy/EconomyContext";
import { claimQuest, fetchArcadeMap, fetchArcadeMe, type ArcadeMap, type ArcadeMe } from "@/game/arcade/api";
import { arcadeStrings } from "@/game/arcade/strings";
import { mapLink, placeName, useRegistry } from "@/game/arcade/registry";
import { Shell } from "@/game/state/ui";

/** /arcade — quests, ranking, open attractions, your attractions and NICS AI's journal. */
const ArcadeHome = () => {
  const { language } = useLanguage();
  const t = arcadeStrings(language);
  const { session, signOut } = useAccount();
  const economy = useEconomy();
  const reg = useRegistry();
  const [map, setMap] = useState<ArcadeMap | null>(null);
  const [me, setMe] = useState<ArcadeMe | null>(null);
  const [claiming, setClaiming] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [m, x] = await Promise.all([fetchArcadeMap(), session ? fetchArcadeMe(session) : Promise.resolve(null)]);
    if (m.ok) setMap(m.data);
    if (x?.ok) setMe(x.data);
    else if (x?.error === "session") signOut();
  }, [session, signOut]);
  useEffect(() => {
    void load();
  }, [load]);

  const when = (iso: string) => new Date(iso).toLocaleDateString("en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  const where = (plotId: number) => reg?.get(plotId);
  const open = useMemo(() => [...(map?.attractions ?? [])].sort((a, b) => Number(b.ai) - Number(a.ai) || b.prize - a.prize), [map]);

  return (
    <Shell title={t.arcadeTitle} icon={Gamepad2} accent="text-fuchsia-300">
      <p className="mb-6 max-w-2xl text-sm text-muted-foreground">{t.intro}</p>

      {me && (
        <div className="mb-6 grid gap-4 md:grid-cols-2">
          <section className="rounded-xl border border-amber-300/30 bg-card/40 p-4">
            <h2 className="mb-3 flex items-center gap-2 font-display text-lg font-bold"><ListChecks className="h-5 w-5 text-amber-300" />{t.quests}</h2>
            <ul className="space-y-2.5">
              {me.quests.map((q) => {
                const ready = q.progress >= q.need;
                return (
                  <li key={q.id} className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium">{t.questNames[q.id]}</div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full bg-amber-300" style={{ width: `${(q.progress / q.need) * 100}%` }} />
                      </div>
                    </div>
                    <span className="w-10 text-right text-xs text-muted-foreground">{q.progress}/{q.need}</span>
                    {q.claimed ? (
                      <span className="flex w-28 items-center justify-end gap-1 text-xs text-emerald-300"><CheckCircle2 className="h-4 w-4" />{t.claimed}</span>
                    ) : (
                      <button
                        disabled={!ready || claiming === q.id}
                        onClick={async () => {
                          if (!session) return;
                          setClaiming(q.id);
                          const r = await claimQuest(session, q.id);
                          setClaiming(null);
                          if (!r.ok) toast.error(t.errors[r.error]);
                          else {
                            toast.success(t.claim(r.data.reward));
                            setMe({ ...me, quests: r.data.quests });
                            void economy.refresh();
                          }
                        }}
                        className={`h-8 w-28 rounded-md text-xs font-semibold ${ready ? "bg-amber-300 text-black hover:bg-amber-200" : "border border-border text-muted-foreground"}`}
                      >
                        {t.claim(q.reward)}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
            <p className="mt-3 text-xs text-muted-foreground">{t.questsNote}</p>
            <p className="mt-1 text-xs text-muted-foreground">{t.today}: {t.todayLine(me.today.plays, me.today.prizeWon, me.today.cap)}</p>
          </section>

          <section className="rounded-xl border border-fuchsia-400/30 bg-card/40 p-4">
            <h2 className="mb-3 flex items-center gap-2 font-display text-lg font-bold"><Trophy className="h-5 w-5 text-fuchsia-300" />{t.ranking}</h2>
            {me.ranking.top.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t.noRanking}</p>
            ) : (
              <ol className="space-y-1.5">
                {me.ranking.top.slice(0, 10).map((r) => (
                  <li key={`${r.place}-${r.name}`} className={`flex items-center gap-2 rounded-md px-2 py-1 text-sm ${r.me ? "bg-fuchsia-400/15" : ""}`}>
                    <span className={`w-6 text-right font-bold ${r.place <= 3 ? "text-amber-300" : "text-muted-foreground"}`}>{r.place}</span>
                    <span className="min-w-0 flex-1 truncate font-medium">{r.name}</span>
                    <span className="hidden text-xs text-muted-foreground sm:inline">{t.rankLine(r.plays, r.wins, r.districts)}</span>
                    <span className="w-16 text-right font-semibold text-fuchsia-200">{t.rankPoints(r.points)}</span>
                  </li>
                ))}
              </ol>
            )}
            {me.ranking.me && <p className="mt-2 text-xs text-fuchsia-200">{t.yourPlace(me.ranking.me.place, me.ranking.me.points)}</p>}
            <p className="mt-2 text-xs text-muted-foreground">{t.rankingRule}</p>
          </section>
        </div>
      )}

      <section className="mb-6">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="font-display text-lg font-bold">{t.open}</h2>
          {map && <span className="text-sm text-muted-foreground">{t.openCount(map.attractions.length)}</span>}
        </div>
        {!map && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {open.map((a) => {
            const p = where(a.plotId);
            return (
              <Link key={a.id} to={mapLink(p?.address)} className={`group rounded-lg border p-3 transition hover:-translate-y-0.5 ${a.ai ? "border-cyan-300/40 bg-cyan-400/5 hover:border-cyan-300" : "border-fuchsia-400/30 bg-fuchsia-500/5 hover:border-fuchsia-300"}`}>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  {a.ai ? <Cpu className="h-3.5 w-3.5 text-cyan-300" /> : <Gamepad2 className="h-3.5 w-3.5 text-fuchsia-300" />}
                  {t.templates[a.template]}
                  <span className="ml-auto">{a.entryFee > 0 ? t.tide(a.entryFee) : t.free}</span>
                </div>
                <div className="mt-1 font-semibold">{a.title}</div>
                <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                  <MapPin className="h-3.5 w-3.5" />
                  <span className="truncate">{p ? placeName(p) : `#${a.plotId}`}</span>
                </div>
                {a.prize > 0 && <div className="mt-1.5 flex items-center gap-1 text-xs font-semibold text-cyan-200"><Coins className="h-3.5 w-3.5" />{t.prize}: {t.tide(a.prize)}</div>}
              </Link>
            );
          })}
        </div>
      </section>

      {me && (
        <section className="mb-6 rounded-xl border border-border bg-card/40 p-4">
          <h2 className="mb-3 font-display text-lg font-bold">{t.mine}</h2>
          {me.operating.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t.noMine}</p>
          ) : (
            <ul className="space-y-2">
              {me.operating.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  <Link to={`/arcade/setup/${a.plotId}`} className="font-semibold hover:text-fuchsia-200">{a.title}</Link>
                  <span className="text-muted-foreground">{t.templates[a.template]} · {where(a.plotId)?.address ?? `#${a.plotId}`}</span>
                  <span className="text-muted-foreground">{t.played(a.plays, a.wins)}</span>
                  <span className="text-cyan-200">{t.poolLeft(a.pool)}</span>
                  {a.earned !== undefined && <span className="text-amber-200">{t.earned(a.earned)}</span>}
                </li>
              ))}
            </ul>
          )}
          {(me.rentals.length > 0 || me.offers.length > 0) && (
            <div className="mt-4 space-y-1 border-t border-border pt-3 text-sm">
              <h3 className="flex items-center gap-1.5 font-semibold"><KeyRound className="h-4 w-4 text-amber-300" />{t.myRentals}</h3>
              {me.rentals.map((r) => (
                <p key={`${r.plotId}-${r.as}`} className="text-muted-foreground">{where(r.plotId)?.address ?? `#${r.plotId}`}: {t.rentalAs(r.as, r.other, when(r.endsAt))}</p>
              ))}
              {me.offers.map((o) => (
                <p key={o.plotId} className="text-muted-foreground">{where(o.plotId)?.address ?? `#${o.plotId}`}: {t.forRent(o.pricePerDay, o.maxDays)}</p>
              ))}
            </div>
          )}
          {me.recent.length > 0 && (
            <div className="mt-4 border-t border-border pt-3">
              <h3 className="mb-1.5 text-sm font-semibold">{t.recent}</h3>
              <ul className="space-y-1 text-sm">
                {me.recent.map((r, i) => (
                  <li key={i} className="flex flex-wrap gap-x-2 text-muted-foreground">
                    <span className={r.won ? "text-emerald-300" : "text-rose-300"}>{r.won ? t.win : t.lose}</span>
                    <span className="text-foreground">{r.title}</span>
                    <span>{t.score(r.score, r.maxScore)}</span>
                    {r.prize > 0 && <span className="text-cyan-200">+{t.tide(r.prize)}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {map && (
        <section className="mb-6 rounded-xl border border-cyan-300/30 bg-cyan-400/5 p-4">
          <h2 className="mb-2 flex items-center gap-2 font-display text-lg font-bold"><Brain className="h-5 w-5 text-cyan-300" />{t.mind}</h2>
          <p className="mb-3 text-sm text-muted-foreground">{t.mindNote}</p>
          <ul className="space-y-2 text-sm">
            {map.mind.map((m) => (
              <li key={m.day} className="rounded-md bg-background/50 p-2.5">
                <span className="mr-2 text-xs font-semibold text-cyan-200">{m.day}</span>
                {m.text}
              </li>
            ))}
          </ul>
        </section>
      )}

      {map && (
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <Scale className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
          <span>
            {t.laws(map.laws)} <Link to="/state/laws" className="text-amber-200 hover:underline">→</Link>
          </span>
        </p>
      )}
    </Shell>
  );
};

export default ArcadeHome;
