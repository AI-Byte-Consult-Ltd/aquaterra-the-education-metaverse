import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { Bitcoin, Copy, CreditCard, Landmark, Loader2, Store, Wallet as WalletIcon } from "lucide-react";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLanguage } from "@/i18n/LanguageContext";
import { useAccount } from "@/game/account/AccountContext";
import { accountLocale } from "@/game/account/strings";
import { useEconomy } from "@/game/economy/EconomyContext";
import {
  buyByCard, buyByCrypto, buyOnMarket, cancelOffer, cancelOrder, dropTrade, fetchExchange, fetchOrder, isAddress, marketCost, micro,
  sellOnMarket, withdrawToken, type ExchangeError, type ExchangeInfo, type Result, type MarketTrade, type Pack, type TideOrder,
} from "./api";
import { exchangeStrings } from "./strings";

const eur = (cents: number) => `€${(cents / 100).toFixed(2)}`;
const usdt = (m: number) => (m / 1e6).toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const short = (a: string) => `${a.slice(0, 8)}…${a.slice(-6)}`;
const input = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-cyan-400";
const button = "inline-flex items-center justify-center gap-2 rounded-lg bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-400 disabled:opacity-50";
const ghost = "rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-muted";

const CopyLine = ({ label, value }: { label: string; value: string }) => {
  const { language } = useLanguage();
  const t = exchangeStrings(language);
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg bg-background/70 px-3 py-2">
      <div className="min-w-0">
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="break-all font-mono text-sm">{value}</div>
      </div>
      <button
        type="button"
        className={ghost}
        onClick={() => void navigator.clipboard?.writeText(value).then(() => toast.success(t.copied), () => undefined)}
        aria-label={t.copy}
      >
        <Copy className="h-3.5 w-3.5" />
      </button>
    </div>
  );
};

/** "Get Tide" on the wallet page: card, crypto, the resident market and (later) the Cronos token. */
const BuyTide = () => {
  const { language } = useLanguage();
  const t = exchangeStrings(language);
  const { session, signOut } = useAccount();
  const { refresh } = useEconomy();
  const [info, setInfo] = useState<ExchangeInfo | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [coin, setCoin] = useState<"usdt" | "cro">("usdt");
  const [buyQty, setBuyQty] = useState<Record<number, string>>({});
  const [sell, setSell] = useState({ tide: "", price: "5", address: "" });
  const [wd, setWd] = useState({ tide: "", address: "" });
  const [params, setParams] = useSearchParams();
  const known = useRef<Map<string, string>>(new Map());
  const when = (iso: string) => new Date(iso).toLocaleTimeString(accountLocale(language), { hour: "2-digit", minute: "2-digit" });

  const load = useCallback(async () => {
    const r = await fetchExchange(session);
    if (!r.ok) {
      if (r.error === "session") signOut();
      return;
    }
    // Tell the resident when something they wait for is done.
    const seen = known.current;
    for (const o of r.data.orders ?? []) {
      const k = `o${o.id}`;
      if (seen.get(k) === "pending" && o.status === "credited") toast.success(t.cryptoCredited(o.tide));
      seen.set(k, o.status);
    }
    for (const tr of r.data.trades ?? []) {
      const k = `t${tr.id}`;
      if (seen.get(k) === "pending" && tr.status === "paid") toast.success(tr.mine ? t.tradeDone(tr.tide - tr.fee) : t.sold(tr.tide, tr.buyer));
      seen.set(k, tr.status);
    }
    setInfo(r.data);
  }, [session, signOut, t]);

  const waiting = (info?.orders ?? []).some((o) => o.status === "pending" && o.method !== "card") || (info?.trades ?? []).some((x) => x.status === "pending");
  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), waiting ? 15000 : 60000);
    return () => window.clearInterval(id);
  }, [load, waiting]);

  // Back from Revolut: /wallet?order=12. Ask until the server has the answer (it checks with Revolut itself).
  useEffect(() => {
    const id = Number(params.get("order"));
    if (!session || !Number.isInteger(id) || id <= 0) return;
    let tries = 0;
    let stop = false;
    toast.message(t.waitingPayment);
    const tick = async () => {
      if (stop) return;
      const r = await fetchOrder(session, id);
      tries += 1;
      if (r.ok && r.data.order.status === "credited") {
        toast.success(t.credited(r.data.order.tide));
        void refresh();
        void load();
      } else if (r.ok && r.data.order.status === "failed") {
        toast.error(t.orderFailed);
      } else if (tries < 30) {
        window.setTimeout(() => void tick(), 4000);
        return;
      }
      const next = new URLSearchParams(window.location.search);
      next.delete("order");
      setParams(next, { replace: true });
    };
    void tick();
    return () => {
      stop = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  if (!session) return null;

  const fail = (e: ExchangeError) => (e === "session" ? signOut() : toast.error(t.errors[e]));
  const run = async <T,>(key: string, p: Promise<Result<T>>, done?: (d: T) => void) => {
    setBusy(key);
    const r = await p;
    setBusy(null);
    if (!r.ok) return fail(r.error);
    done?.(r.data);
    void load();
    void refresh();
  };

  const packs = info?.packs ?? [];
  const base = packs[0];
  const discount = (p: Pack) => (base && p.pack > 1 ? Math.round((1 - p.eurCents / p.tide / (base.eurCents / base.tide)) * 100) : 0);
  const openCrypto = (info?.orders ?? []).filter((o) => o.status === "pending" && o.method !== "card");
  const myTrades = (info?.trades ?? []).filter((x) => x.status === "pending" && x.mine);
  const fee = ((info?.marketFeeBp ?? 200) / 100).toLocaleString("en");

  const PackGrid = ({ price, action }: { price: (p: Pack) => string | null; action: (p: Pack) => void }) => (
    <div className="grid gap-3 sm:grid-cols-3">
      {packs.map((p) => {
        const label = price(p);
        const d = discount(p);
        return (
          <button
            key={p.pack}
            type="button"
            disabled={!label || busy !== null}
            onClick={() => action(p)}
            className="relative rounded-xl border border-cyan-400/30 bg-background/60 p-4 text-left transition hover:border-cyan-300 disabled:opacity-50"
          >
            {p.pack === 3 && <span className="absolute right-3 top-3 rounded-full bg-amber-400/90 px-2 py-0.5 text-[10px] font-bold text-slate-950">{t.bestValue}</span>}
            <div className="font-display text-2xl font-bold">{p.tide.toLocaleString("en")}</div>
            <div className="text-xs text-muted-foreground">TIDE</div>
            <div className="mt-3 flex items-center justify-between">
              <span className="font-semibold text-cyan-300">{busy === `pack${p.pack}` ? <Loader2 className="h-4 w-4 animate-spin" /> : label ?? "—"}</span>
              {d > 0 && <span className="text-xs text-emerald-400">{t.save(d)}</span>}
            </div>
          </button>
        );
      })}
    </div>
  );

  const payCard = (p: Pack) =>
    void run(`pack${p.pack}`, buyByCard(session, p.pack), (d) => {
      if (d.order.checkoutUrl) {
        toast.message(t.redirecting);
        window.location.assign(d.order.checkoutUrl);
      } else toast.error(t.errors.provider);
    });

  const OrderBox = ({ o }: { o: TideOrder }) => (
    <div className="space-y-2 rounded-xl border border-amber-400/40 bg-amber-400/5 p-4">
      <div className="text-sm font-semibold">{o.tide.toLocaleString("en")} TIDE</div>
      <CopyLine label={t.sendExactly} value={`${micro(o.amount)} ${o.currency}`} />
      <CopyLine label={t.toAddress} value={o.payTo ?? ""} />
      <p className="text-xs text-muted-foreground">{t.network}</p>
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin" />{t.until(when(o.expiresAt))}</span>
        <button type="button" className={ghost} onClick={() => void run(`c${o.id}`, cancelOrder(session, o.id))}>{t.cancel}</button>
      </div>
    </div>
  );

  const TradeBox = ({ x }: { x: MarketTrade }) => (
    <div className="space-y-2 rounded-xl border border-amber-400/40 bg-amber-400/5 p-4">
      <div className="text-sm font-semibold">{t.youGet(x.tide - Math.floor((x.tide * (info?.marketFeeBp ?? 0)) / 10000))}</div>
      <CopyLine label={t.paySeller} value={`${micro(x.amount)} USDT`} />
      <CopyLine label={t.toAddress} value={x.payTo} />
      <p className="text-xs text-muted-foreground">{t.network}</p>
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin" />{t.until(when(x.expiresAt))}</span>
        <button type="button" className={ghost} onClick={() => void run(`d${x.id}`, dropTrade(session, x.id))}>{t.dropTrade}</button>
      </div>
    </div>
  );

  const postOffer = (e: FormEvent) => {
    e.preventDefault();
    const tide = Math.trunc(Number(sell.tide));
    const price = Math.round(Number(sell.price.replace(",", ".")) * 1e6);
    if (!Number.isInteger(tide) || tide < (info?.marketMin ?? 100)) return fail("amount");
    if (!Number.isFinite(price) || price < 1000) return fail("price");
    if (!isAddress(sell.address)) return fail("address");
    void run("sell", sellOnMarket(session, tide, price, sell.address), () => {
      toast.success(t.offerPosted);
      setSell((s) => ({ ...s, tide: "" }));
    });
  };

  const withdraw = (e: FormEvent) => {
    e.preventDefault();
    const tide = Math.trunc(Number(wd.tide));
    if (!Number.isInteger(tide) || tide < (info?.tokenMin ?? 1000)) return fail("amount");
    if (!isAddress(wd.address)) return fail("address");
    void run("wd", withdrawToken(session, tide, wd.address), () => toast.success(t.withdrawQueued));
  };

  return (
    <section className="rounded-2xl border border-cyan-400/30 bg-card/80 p-5 md:col-span-2">
      <h2 className="font-display text-lg font-bold">{t.title}</h2>
      <p className="mb-4 text-sm text-muted-foreground">{t.intro}</p>
      {!info ? (
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      ) : (
        <Tabs defaultValue={info.card ? "card" : info.crypto ? "crypto" : "market"}>
          <TabsList className="mb-4 flex h-auto flex-wrap justify-start">
            <TabsTrigger value="card" className="gap-1.5"><CreditCard className="h-4 w-4" />{t.tabs.card}</TabsTrigger>
            <TabsTrigger value="crypto" className="gap-1.5"><Bitcoin className="h-4 w-4" />{t.tabs.crypto}</TabsTrigger>
            <TabsTrigger value="market" className="gap-1.5"><Store className="h-4 w-4" />{t.tabs.market}</TabsTrigger>
            <TabsTrigger value="token" className="gap-1.5"><Landmark className="h-4 w-4" />{t.tabs.token}</TabsTrigger>
          </TabsList>

          <TabsContent value="card" className="space-y-3">
            <p className="text-sm text-muted-foreground">{info.card ? t.cardNote : t.cardOff}</p>
            <PackGrid price={(p) => (info.card ? eur(p.eurCents) : null)} action={payCard} />
          </TabsContent>

          <TabsContent value="crypto" className="space-y-3">
            <p className="text-sm text-muted-foreground">{info.crypto ? t.cryptoNote : t.cryptoOff}</p>
            {info.crypto && (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">{t.coin}</span>
                {(["usdt", "cro"] as const).map((c) => (
                  <button key={c} type="button" onClick={() => setCoin(c)} className={`${ghost} ${coin === c ? "border-cyan-400 text-cyan-300" : ""}`}>
                    {c.toUpperCase()}
                  </button>
                ))}
                {coin === "cro" && !info.cro && <span className="text-xs text-amber-300">{t.croOff}</span>}
              </div>
            )}
            {openCrypto.map((o) => <OrderBox key={o.id} o={o} />)}
            <PackGrid
              price={(p) => (!info.crypto ? null : coin === "usdt" ? `${usdt(p.usdtMicro)} USDT` : p.croMicro ? `${(p.croMicro / 1e6).toFixed(3)} CRO` : null)}
              action={(p) => void run(`pack${p.pack}`, buyByCrypto(session, p.pack, coin))}
            />
          </TabsContent>

          <TabsContent value="market" className="space-y-4">
            <p className="text-sm text-muted-foreground">{info.market ? t.marketNote(fee) : t.marketOff}</p>
            {myTrades.map((x) => <TradeBox key={x.id} x={x} />)}
            <div>
              <h3 className="mb-2 text-sm font-semibold">{t.offers}</h3>
              {info.market_offers.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t.noOffers}</p>
              ) : (
                <ul className="space-y-2">
                  {info.market_offers.map((m) => {
                    const qty = Math.trunc(Number(buyQty[m.id] ?? m.tide));
                    return (
                      <li key={m.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-background/50 px-3 py-2 text-sm">
                        <div className="min-w-0 flex-1">
                          <div className="font-semibold">{m.tide.toLocaleString("en")} TIDE · {t.per1000(usdt(m.priceMicro))}</div>
                          <div className="text-xs text-muted-foreground">{m.mine ? t.myOffer : `${t.seller}: ${m.seller}`}</div>
                        </div>
                        {m.mine ? (
                          <button type="button" className={ghost} disabled={busy !== null}
                            onClick={() => void run(`m${m.id}`, cancelOffer(session, m.id), (d) => toast.success(t.offerBack(d.returned)))}>
                            {t.withdrawOffer}
                          </button>
                        ) : (
                          info.market && m.tide > 0 && (
                            <div className="flex items-center gap-2">
                              <input className={`${input} w-28`} inputMode="numeric" aria-label={t.howMany} value={buyQty[m.id] ?? String(m.tide)}
                                onChange={(e) => setBuyQty((q) => ({ ...q, [m.id]: e.target.value.replace(/\D/g, "") }))} />
                              <span className="hidden text-xs text-muted-foreground sm:inline">{qty > 0 ? t.youPay(usdt(marketCost(qty, m.priceMicro))) : ""}</span>
                              <button type="button" className={button} disabled={busy !== null || !(qty > 0)}
                                onClick={() => void run(`b${m.id}`, buyOnMarket(session, m.id, qty))}>
                                {busy === `b${m.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : t.buy}
                              </button>
                            </div>
                          )
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
              {info.market && <p className="mt-2 text-xs text-muted-foreground">{t.payWithin(info.marketPayMinutes)}</p>}
            </div>
            {info.market && (
              <form onSubmit={postOffer} className="grid gap-3 rounded-xl border border-border bg-background/40 p-4 sm:grid-cols-3">
                <h3 className="text-sm font-semibold sm:col-span-3">{t.sellTitle}</h3>
                <label className="text-xs text-muted-foreground">{t.sellAmount}
                  <input className={input} inputMode="numeric" value={sell.tide} onChange={(e) => setSell({ ...sell, tide: e.target.value.replace(/\D/g, "") })} />
                </label>
                <label className="text-xs text-muted-foreground">{t.sellPrice}
                  <input className={input} inputMode="decimal" value={sell.price} onChange={(e) => setSell({ ...sell, price: e.target.value })} />
                </label>
                <label className="text-xs text-muted-foreground">{t.sellAddress}
                  <input className={`${input} font-mono`} placeholder="0x…" value={sell.address} onChange={(e) => setSell({ ...sell, address: e.target.value })} />
                </label>
                <div className="flex flex-wrap items-center justify-between gap-2 sm:col-span-3">
                  <span className="text-xs text-muted-foreground">{t.sellFree(info.free ?? 0)}</span>
                  <button type="submit" className={button} disabled={busy !== null}>{busy === "sell" ? <Loader2 className="h-4 w-4 animate-spin" /> : t.sell}</button>
                </div>
              </form>
            )}
          </TabsContent>

          <TabsContent value="token" className="space-y-3">
            <p className="text-sm text-muted-foreground">{t.tokenNote}</p>
            {!info.token ? (
              <p className="flex items-center gap-2 rounded-lg border border-border bg-background/50 px-3 py-2 text-sm"><WalletIcon className="h-4 w-4 text-cyan-300" />{t.tokenOff}</p>
            ) : (
              <form onSubmit={withdraw} className="grid gap-3 sm:grid-cols-3">
                <label className="text-xs text-muted-foreground">{t.withdrawAmount}
                  <input className={input} inputMode="numeric" value={wd.tide} onChange={(e) => setWd({ ...wd, tide: e.target.value.replace(/\D/g, "") })} />
                </label>
                <label className="text-xs text-muted-foreground sm:col-span-2">{t.withdrawAddress}
                  <input className={`${input} font-mono`} placeholder="0x…" value={wd.address} onChange={(e) => setWd({ ...wd, address: e.target.value })} />
                </label>
                <div className="flex items-center justify-between gap-2 sm:col-span-3">
                  <span className="text-xs text-muted-foreground">{t.withdrawFee((info.tokenFeeBp / 100).toLocaleString("en"), info.tokenMin)}</span>
                  <button type="submit" className={button} disabled={busy !== null}>{t.withdraw}</button>
                </div>
              </form>
            )}
            {(info.withdrawals ?? []).map((w) => (
              <div key={w.id} className="text-xs text-muted-foreground">{w.tide.toLocaleString("en")} TIDE → {short(w.address)} · {w.status}</div>
            ))}
          </TabsContent>
        </Tabs>
      )}
      {(info?.orders ?? []).length > 0 && (
        <div className="mt-5">
          <h3 className="mb-2 text-sm font-semibold">{t.myOrders}</h3>
          <ul className="space-y-1 text-xs">
            {info!.orders!.map((o) => (
              <li key={o.id} className="flex justify-between gap-2 text-muted-foreground">
                <span>{o.tide.toLocaleString("en")} TIDE · {o.method === "card" ? eur(o.amount) : `${micro(o.amount)} ${o.currency}`}</span>
                <span className={o.status === "credited" ? "text-emerald-400" : ""}>{t.statuses[o.status]}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
};

export default BuyTide;
