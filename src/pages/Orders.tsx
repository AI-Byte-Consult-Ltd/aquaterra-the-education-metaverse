import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Bot, ClipboardList, Hammer, History, Home, Loader2, Truck, Users } from "lucide-react";
import { toast } from "sonner";
import { useLanguage } from "@/i18n/LanguageContext";
import { useAccount } from "@/game/account/AccountContext";
import { useEconomy } from "@/game/economy/EconomyContext";
import { Shell } from "@/game/state/ui";
import { Panel, btnMain } from "@/game/bank/ui";
import { farmStrings, goodName } from "@/game/farm/strings";
import { industryStrings } from "@/game/industry/strings";
import { canDeliver, deliver, fetchCity, type CityView, type OrderError } from "@/game/orders/api";
import { orderStrings } from "@/game/orders/strings";

/** /orders: what the city needs today (NICS AI posts it), and the workforce of my homes. */
const Orders = () => {
  const { language } = useLanguage();
  const t = orderStrings(language);
  const tf = farmStrings(language);
  const ti = industryStrings(language);
  const good = useCallback((k: string) => goodName(tf, k), [tf]);
  const { session, signOut } = useAccount();
  const { refresh } = useEconomy();
  const [data, setData] = useState<CityView | null>(null);
  const [error, setError] = useState<OrderError | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    void fetchCity(session).then((r) => (r.ok ? setData(r.data) : r.error === "session" ? signOut() : setError(r.error)));
  }, [session, signOut]);
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const send = async (orderId: number) => {
    if (!session) return;
    setBusy(orderId);
    const r = await deliver(session, orderId);
    setBusy(null);
    if (!r.ok) return r.error === "session" ? signOut() : toast.error(t.errors[r.error]);
    setData(r.data);
    toast.success(t.delivered(r.data.delivered ?? 0, r.data.tide ?? 0));
    void refresh();
  };

  const left = data ? Math.max(0, new Date(data.endsAt).getTime() - now) : 0;
  const me = data?.me;
  const capLeft = data && me ? Math.max(0, data.laws.cap - me.earnedToday) : 0;
  const pct = me ? Math.round(me.output * 100) : 100;

  return (
    <Shell title={t.title} icon={ClipboardList} back={{ to: "/world", label: t.backToWorld }} accent="text-sky-300">
      <p className="mb-3 max-w-2xl text-sm text-muted-foreground">{t.intro}</p>
      {error && <p className="mb-4 text-sm text-destructive">{t.errors[error]}</p>}
      {!data && !error && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}
      {data && (
        <div className="space-y-6">
          <Panel title={t.today} icon={Bot}>
            <p className="text-xs text-muted-foreground">
              {t.nics} · {t.endsIn(Math.floor(left / 3_600_000), Math.floor((left % 3_600_000) / 60_000))}
            </p>
            {data.orders.length === 0 ? <p className="text-sm text-muted-foreground">{t.none}</p> : (
              <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {data.orders.map((o) => {
                  const done = o.delivered >= o.qty;
                  const can = me ? Math.min(canDeliver(o, data.laws.sharePct), Math.floor(capLeft / o.reward + 1e-9)) : 0;
                  return (
                    <li key={o.id} className={`rounded-xl border p-3 ${done ? "border-emerald-400/50 bg-emerald-400/10" : "border-border bg-background/40"}`}>
                      <p className="font-semibold">{t.need(o.qty, good(o.good), t.projects[o.project] ?? o.project)}</p>
                      <p className="text-xs text-muted-foreground">{t.pays(o.reward, o.price, data.laws.bonusPct)}</p>
                      <div className="my-2 h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={o.qty} aria-valuenow={o.delivered}>
                        <div className="h-full bg-sky-400" style={{ width: `${Math.min(100, (o.delivered / o.qty) * 100)}%` }} />
                      </div>
                      <p className="text-xs text-muted-foreground">{t.progress(o.delivered, o.qty, o.suppliers)}</p>
                      {done ? <p className="mt-2 text-sm text-emerald-300">{t.filled}</p> : session && me ? (
                        <div className="mt-2 space-y-1">
                          <p className="text-xs">{t.youHave(o.have ?? 0)}</p>
                          {can > 0 ? (
                            <button type="button" className={`${btnMain} w-full`} disabled={busy !== null} onClick={() => void send(o.id)}>
                              {busy === o.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Truck className="h-4 w-4" />}
                              {t.deliver(can, Math.floor(can * o.reward + 1e-9))}
                            </button>
                          ) : (o.have ?? 0) === 0 ? (
                            <p className="text-xs text-muted-foreground">{t.howToGet} <Link to="/farm" className="underline">{tf.short}</Link> · <Link to="/industry" className="underline">{ti.short}</Link></p>
                          ) : (
                            <p className="text-xs text-muted-foreground">{capLeft < o.reward ? t.errors.cap : t.errors.share}</p>
                          )}
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="text-xs text-muted-foreground">{t.rules(data.laws.sharePct, data.laws.cap, data.laws.incomeTaxPct)}</p>
            {me && <p className="text-xs">{t.earned(me.earnedToday, data.laws.cap)}</p>}
            {!session && <p className="text-sm"><Link to="/login" className="text-primary underline">{t.signIn}</Link></p>}
          </Panel>

          <Panel title={t.workforce} icon={Users}>
            <p className="text-sm text-muted-foreground">{t.workforceIntro(data.laws.basePct)}</p>
            {me && (
              <>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-xl border border-border p-2"><p className="text-2xl font-bold">{t.n(me.people)}</p><p className="text-xs text-muted-foreground">{t.people}</p></div>
                  <div className="rounded-xl border border-border p-2"><p className="text-2xl font-bold">{t.n(me.jobs)}</p><p className="text-xs text-muted-foreground">{t.jobs}</p></div>
                  <div className="rounded-xl border border-border p-2"><p className={`text-2xl font-bold ${pct < 100 ? "text-amber-300" : "text-emerald-300"}`}>{pct}%</p><p className="text-xs text-muted-foreground">{t.output}</p></div>
                </div>
                <p className="text-sm">{t.outputNote(pct, me.people, me.jobs)}</p>
                <div>
                  <h3 className="mb-1 flex items-center gap-1.5 text-sm font-semibold"><Home className="h-4 w-4" />{t.homes}</h3>
                  {me.homes.length === 0 ? <p className="text-sm text-muted-foreground">{t.noHomes}</p> : (
                    <ul className="space-y-0.5 text-sm">
                      {me.homes.map((h) => <li key={h.plotId}>{h.address} · {t.homeKind(h.kind, h.level)} · {t.peopleN(h.people)}</li>)}
                    </ul>
                  )}
                </div>
                {me.works.length > 0 && (
                  <ul className="space-y-0.5 text-sm">
                    {me.works.map((w) => (
                      <li key={w.kind}>{w.kind === "farm" ? t.farmJobs : w.kind === "seafarm" ? t.seaJobs : ti.works[w.kind] ?? w.kind} × {w.count} · {t.n(w.jobs)} {t.jobs.split(" ")[0].toLowerCase()}</li>
                    ))}
                  </ul>
                )}
              </>
            )}
            <p className="text-xs text-muted-foreground">{t.homeTable(data.laws.homes)}</p>
            <p className="text-xs text-muted-foreground">
              <Hammer className="mr-1 inline h-3 w-3" />{t.jobTable}:{" "}
              {Object.entries(data.jobs).map(([k, v]) => `${k === "farm" ? t.farmJobs : k === "seafarm" ? t.seaJobs : ti.works[k] ?? k} ${v}`).join(" · ")}
            </p>
            <p className="text-xs">{t.city(data.city.people, data.city.jobs)}</p>
          </Panel>

          {data.past.length > 0 && (
            <Panel title={t.past} icon={History}>
              <ul className="space-y-0.5 text-sm">
                {data.past.map((p) => <li key={p.day}><span className="font-semibold">{p.day}</span> · {t.pastRow(p.orders, p.filled, p.units, p.tide)}</li>)}
              </ul>
            </Panel>
          )}
        </div>
      )}
    </Shell>
  );
};

export default Orders;
