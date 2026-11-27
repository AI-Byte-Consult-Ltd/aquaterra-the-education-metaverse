import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Coins, History, Loader2, Shovel, Sprout, Store, Tractor, Warehouse, X } from "lucide-react";
import { toast } from "sonner";
import { useLanguage } from "@/i18n/LanguageContext";
import { useAccount } from "@/game/account/AccountContext";
import { useEconomy } from "@/game/economy/EconomyContext";
import { Shell } from "@/game/state/ui";
import { Panel, btnMain, btnSoft, inputBase } from "@/game/bank/ui";
import {
  cancelOrder, clearField, cropYield, fetchBook, fetchMarket, fetchMyFarm, harvest, placeOrder, plant, seedCost, sellToReserve,
  type Book, type Crop, type FarmError, type FarmPlot, type Market, type MyFarm, type Result,
} from "@/game/farm/api";
import { farmStrings, type FarmStrings } from "@/game/farm/strings";
import Barter from "@/game/agency/Barter";

const fmt = (v: number | null) => (v === null || v === undefined ? "–" : v.toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 3 }));

function FieldCard({ p, crops, t, busy, highlight, onPlant, onHarvest, onClear }: {
  p: FarmPlot; crops: Crop[]; t: FarmStrings; busy: string | null; highlight: boolean;
  onPlant: (plotId: number, crop: string) => void; onHarvest: (plotId: number) => void; onClear: (plotId: number) => void;
}) {
  const fits = crops.filter((x) => !!x.water === !!p.water);
  const [pick, setPick] = useState(fits[0]?.key ?? "wheat");
  const [arm, setArm] = useState(false);
  const c = fits.find((x) => x.key === pick) ?? fits[0];
  const f = p.field;
  const name = (k: string) => `${t.icons[k] ?? ""} ${t.crops[k] ?? k}`;
  const now = Date.now();
  const ripe = f && new Date(f.readyAt).getTime() <= now;
  const wilted = f && new Date(f.wiltsAt).getTime() <= now;
  const pct = f ? Math.min(100, Math.max(0, ((now - new Date(f.plantedAt).getTime()) / (new Date(f.readyAt).getTime() - new Date(f.plantedAt).getTime())) * 100)) : 0;
  return (
    <li id={`plot-${p.plotId}`} className={`rounded-xl border p-3 ${highlight ? "border-amber-300 bg-amber-400/10" : "border-border bg-background/40"}`}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate font-semibold">{p.address}</span>
        <span className="shrink-0 text-xs text-muted-foreground">{p.district} · {t.n(p.tiles)} tiles</span>
      </div>
      {p.block === "land" && !f && <p className="mt-1 text-sm text-muted-foreground">{t.blockLand}</p>}
      {p.block === "building" && !f && <p className="mt-1 text-sm text-muted-foreground">{t.blockBuilding}</p>}
      {f && (
        <div className="mt-2 space-y-2">
          <p className={`text-sm ${ripe ? "text-emerald-300" : ""}`}>
            {wilted ? t.wilted(name(f.crop)) : ripe ? t.ripe(name(f.crop), f.units, f.wiltsAt) : t.growing(name(f.crop), f.units, f.readyAt)}
          </p>
          <div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full bg-emerald-400" style={{ width: `${pct}%` }} /></div>
          <div className="flex flex-wrap gap-2">
            {ripe ? (
              <button type="button" className={btnMain} disabled={busy !== null} onClick={() => onHarvest(p.plotId)}>
                {busy === "harvest:" + p.plotId ? <Loader2 className="h-4 w-4 animate-spin" /> : <Tractor className="h-4 w-4" />}{t.harvest}
              </button>
            ) : (
              <button type="button" className={btnSoft} disabled={busy !== null} onClick={() => (arm ? onClear(p.plotId) : setArm(true))}>
                <Shovel className="h-4 w-4" />{arm ? t.digConfirm : t.dig}
              </button>
            )}
          </div>
        </div>
      )}
      {!f && !p.block && c && (
        <div className="mt-2 space-y-2">
          <p className="text-xs text-emerald-300">{t.empty}</p>
          <select aria-label={t.choose} className={`${inputBase} w-full`} value={c.key} onChange={(e) => setPick(e.target.value)}>
            {Object.entries(t.groups).filter(([g]) => fits.some((x) => x.group === g)).map(([g, label]) => (
              <optgroup key={g} label={label}>
                {fits.filter((x) => x.group === g).map((x) => (
                  <option key={x.key} value={x.key}>{name(x.key)} · {t.hours(x.hours)} · {t.tide(seedCost(x, p.tiles))} → {t.n(cropYield(x, p.tiles))}</option>
                ))}
              </optgroup>
            ))}
          </select>
          <button type="button" className={`${btnMain} w-full`} disabled={busy !== null} onClick={() => onPlant(p.plotId, c.key)}>
            {busy === "plant:" + p.plotId ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sprout className="h-4 w-4" />}
            {t.plantFor(seedCost(c, p.tiles), cropYield(c, p.tiles), t.crops[c.key] ?? c.key, t.hours(c.hours))}
          </button>
        </div>
      )}
    </li>
  );
}

/** /farm: fields on my land, the barn, and the Harvest Market. */
const Farm = () => {
  const { language } = useLanguage();
  const t = farmStrings(language);
  const { session, signOut } = useAccount();
  const { refresh } = useEconomy();
  const [params] = useSearchParams();
  const focus = Number(params.get("plot") ?? NaN);
  const [market, setMarket] = useState<Market | null>(null);
  const [me, setMe] = useState<MyFarm | null>(null);
  const [error, setError] = useState<FarmError | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [sel, setSel] = useState("wheat");
  const [book, setBook] = useState<Book | null>(null);
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [qty, setQty] = useState("10");
  const [price, setPrice] = useState("");

  const view: Market | null = me ?? market;
  const crops = view?.crops ?? [];
  const name = useCallback((k: string) => `${t.icons[k] ?? ""} ${t.crops[k] ?? k}`, [t]);
  const fail = useCallback((e: FarmError) => (e === "session" ? signOut() : toast.error(t.errors[e])), [signOut, t]);

  useEffect(() => {
    void fetchMarket().then((r) => (r.ok ? setMarket(r.data) : setError(r.error)));
  }, []);
  useEffect(() => {
    if (!session) return;
    void fetchMyFarm(session).then((r) => (r.ok ? setMe(r.data) : r.error === "session" ? signOut() : setError(r.error)));
  }, [session, signOut]);
  useEffect(() => {
    setBook(null);
    void fetchBook(sel).then((r) => r.ok && setBook(r.data.book));
  }, [sel]);
  useEffect(() => {
    if (me && Number.isFinite(focus)) document.getElementById(`plot-${focus}`)?.scrollIntoView({ block: "center" });
  }, [me, focus]);

  const act = async (key: string, run: () => Promise<Result<MyFarm>>, done: (d: MyFarm) => string) => {
    setBusy(key);
    const r = await run();
    setBusy(null);
    if (!r.ok) return fail(r.error);
    setMe(r.data);
    if (r.data.book) setBook(r.data.book);
    toast.success(done(r.data));
    void refresh();
  };

  const plots = useMemo(() => me?.plots ?? [], [me]);
  const anyRipe = plots.some((p) => p.field && new Date(p.field.readyAt).getTime() <= Date.now());
  const selCrop = crops.find((c) => c.key === sel);
  const total = Math.max(0, Math.ceil((Number(qty) || 0) * (Number(price) || 0) - 1e-9));
  const harvestMsg = (d: MyFarm) => [d.harvested ? t.harvested(d.harvested, d.units ?? 0) : "", d.destroyed ? t.destroyed(d.destroyed) : ""].filter(Boolean).join(" ");

  return (
    <Shell title={t.title} icon={Sprout} back={{ to: "/world", label: t.backToWorld }} accent="text-emerald-300">
      <p className="mb-3 max-w-2xl text-sm text-muted-foreground">{t.intro}</p>
      {error && <p className="mb-4 text-sm text-destructive">{t.errors[error]}</p>}
      {!view && !error && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}
      {view && (
        <div className="space-y-6">
          <p className="text-xs text-muted-foreground">{t.stats(view.fields, view.farmers)}</p>

          {!session ? (
            <p className="text-sm"><Link to="/login" className="text-primary underline">{t.signIn}</Link></p>
          ) : me && (
            <>
              <Panel title={t.myFields} icon={Sprout}>
                {plots.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t.noPlots} <Link to="/world" className="text-primary underline">{t.backToWorld}</Link></p>
                ) : (
                  <>
                    {anyRipe && (
                      <button type="button" className={btnMain} disabled={busy !== null} onClick={() => void act("harvest", () => harvest(session), harvestMsg)}>
                        {busy === "harvest" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Tractor className="h-4 w-4" />}{t.harvestAll}
                      </button>
                    )}
                    <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {plots.map((p) => (
                        <FieldCard key={p.plotId} p={p} crops={crops} t={t} busy={busy} highlight={p.plotId === focus}
                          onPlant={(id, c) => void act("plant:" + id, () => plant(session, id, c), (d) => t.planted(d.seed ?? 0))}
                          onHarvest={(id) => void act("harvest:" + id, () => harvest(session, id), harvestMsg)}
                          onClear={(id) => void act("clear:" + id, () => clearField(session, id), () => t.dig)} />
                      ))}
                    </ul>
                  </>
                )}
              </Panel>

              <Panel title={t.barn} icon={Warehouse}>
                <p className="text-xs text-muted-foreground">{t.reserveNote(me.laws.reserveCap, me.reserveToday, me.laws.incomeTaxPct)}</p>
                {me.barn.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t.barnEmpty}</p>
                ) : (
                  <ul className="space-y-2">
                    {me.barn.map((b) => (
                      <li key={b.crop} className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="min-w-[9rem] font-semibold">{name(b.crop)}</span>
                        <span>{t.n(b.units)}</span>
                        <span className="text-muted-foreground">{t.worth(b.value)}</span>
                        <button type="button" className={btnSoft} disabled={b.value < 1 || busy !== null}
                          onClick={() => void act("reserve:" + b.crop, () => sellToReserve(session, b.crop), (d) => t.sold(d.sold ?? 0, t.crops[b.crop] ?? b.crop, d.tide ?? 0))}>
                          {busy === "reserve:" + b.crop ? <Loader2 className="h-4 w-4 animate-spin" /> : <Coins className="h-4 w-4" />}{t.reserve}
                        </button>
                        <button type="button" className={btnSoft} onClick={() => { setSel(b.crop); setSide("sell"); setQty(String(b.units)); document.getElementById("market")?.scrollIntoView({ behavior: "smooth" }); }}>
                          <Store className="h-4 w-4" />{t.market}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            </>
          )}

          <div id="market">
            <Panel title={t.market} icon={Store}>
              <p className="text-xs text-muted-foreground">{t.marketNote(view.laws.marketTaxPct)}</p>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[520px] text-sm">
                  <thead className="text-left text-xs text-muted-foreground">
                    <tr><th className="py-1">{t.crop}</th><th>{t.reservePrice}</th><th>{t.bid}</th><th>{t.ask}</th><th>{t.last}</th><th>{t.volume}</th></tr>
                  </thead>
                  <tbody>
                    {crops.map((c) => (
                      <tr key={c.key} onClick={() => setSel(c.key)} className={`cursor-pointer border-t border-border ${sel === c.key ? "bg-emerald-400/10" : "hover:bg-muted/40"}`}>
                        <td className="py-1.5 font-semibold">{name(c.key)}</td>
                        <td>{fmt(c.price)}</td><td className="text-emerald-300">{fmt(c.bid)}</td><td className="text-rose-300">{fmt(c.ask)}</td>
                        <td>{fmt(c.last)}</td><td>{t.n(c.volume)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {selCrop && (
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <p className="font-semibold">{name(selCrop.key)}</p>
                    {!book ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : (
                      <div className="grid grid-cols-2 gap-3 text-xs">
                        <div>
                          <p className="mb-1 text-muted-foreground">{t.asks}</p>
                          {book.asks.length === 0 ? <p className="text-muted-foreground">{t.noOrders}</p> : book.asks.map(([p, q]) => (
                            <button type="button" key={p} onClick={() => { setSide("buy"); setPrice(String(p)); }} className="flex w-full justify-between text-rose-300 hover:underline"><span>{fmt(p)}</span><span>{t.n(q)}</span></button>
                          ))}
                        </div>
                        <div>
                          <p className="mb-1 text-muted-foreground">{t.bids}</p>
                          {book.bids.length === 0 ? <p className="text-muted-foreground">{t.noOrders}</p> : book.bids.map(([p, q]) => (
                            <button type="button" key={p} onClick={() => { setSide("sell"); setPrice(String(p)); }} className="flex w-full justify-between text-emerald-300 hover:underline"><span>{fmt(p)}</span><span>{t.n(q)}</span></button>
                          ))}
                        </div>
                        {book.trades.length > 0 && (
                          <div className="col-span-2">
                            <p className="mb-1 text-muted-foreground">{t.trades}</p>
                            {book.trades.slice(0, 8).map(([p, q, at], i) => (
                              <p key={i} className="flex justify-between"><span>{fmt(p)} × {t.n(q)}</span><span className="text-muted-foreground">{new Date(at).toLocaleString("en")}</span></p>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  {session && me && (
                    <form className="space-y-2" onSubmit={(e) => {
                      e.preventDefault();
                      void act("order", () => placeOrder(session, side, sel, price, Math.trunc(Number(qty))), (d) => t.filled(d.fills ?? 0));
                    }}>
                      <div className="flex gap-2">
                        {(["buy", "sell"] as const).map((s) => (
                          <button key={s} type="button" onClick={() => setSide(s)}
                            className={`${btnSoft} flex-1 ${side === s ? (s === "buy" ? "border-emerald-300 text-emerald-200" : "border-rose-300 text-rose-200") : ""}`}>
                            {s === "buy" ? t.buy : t.sell}
                          </button>
                        ))}
                      </div>
                      <label className="block text-xs text-muted-foreground">{t.qty}
                        <input className={`${inputBase} mt-1 w-full`} inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value.replace(/[^0-9]/g, ""))} />
                      </label>
                      <label className="block text-xs text-muted-foreground">{t.priceEach}
                        <input className={`${inputBase} mt-1 w-full`} inputMode="decimal" placeholder={fmt(selCrop.price)} value={price} onChange={(e) => setPrice(e.target.value.replace(/[^0-9.]/g, ""))} />
                      </label>
                      <p className="text-xs text-muted-foreground">{t.total(total)} · {t.free(me.free)}</p>
                      <button type="submit" className={`${btnMain} w-full`} disabled={busy !== null || !price || !qty}>
                        {busy === "order" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Store className="h-4 w-4" />}{t.place(side)}
                      </button>
                    </form>
                  )}
                </div>
              )}

              {me && me.orders.length > 0 && (
                <div className="space-y-1">
                  <p className="text-sm font-semibold">{t.myOrders}</p>
                  {me.orders.map((o) => (
                    <p key={o.id} className="flex flex-wrap items-center gap-2 text-sm">
                      <span className={o.side === "buy" ? "text-emerald-300" : "text-rose-300"}>{t.orderLine(o.side, o.left, o.qty, t.crops[o.crop] ?? o.crop, o.price)}</span>
                      <button type="button" className={btnSoft} disabled={busy !== null} onClick={() => void act("cancel:" + o.id, () => cancelOrder(session!, o.id), () => t.cancelled)}>
                        <X className="h-4 w-4" />{t.cancel}
                      </button>
                    </p>
                  ))}
                </div>
              )}
            </Panel>
          </div>

          <Barter session={session} crops={view.crops} names={Object.fromEntries(view.crops.map((c) => [c.key, name(c.key)]))}
            barn={me?.barn ?? []} onSession={signOut}
            onChange={() => session && void fetchMyFarm(session).then((r) => r.ok && setMe(r.data))} />

          {me && me.log.length > 0 && (
            <Panel title={t.history} icon={History}>
              <ul className="space-y-1 text-sm text-muted-foreground">
                {me.log.map((l, i) => (
                  <li key={i}>{new Date(l.at).toLocaleString("en")}: {t.log[l.kind](t.crops[l.crop] ?? l.crop, l.units, l.tide)}</li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
      )}
    </Shell>
  );
};

export default Farm;
