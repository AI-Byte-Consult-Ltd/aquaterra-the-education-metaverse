import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Building2, History, Landmark, Loader2, Tag, X } from "lucide-react";
import { toast } from "sonner";
import { useLanguage } from "@/i18n/LanguageContext";
import { useAccount } from "@/game/account/AccountContext";
import { useEconomy } from "@/game/economy/EconomyContext";
import { Shell } from "@/game/state/ui";
import { Panel, btnMain, btnSoft, inputBase } from "@/game/bank/ui";
import {
  ASSET_KINDS, addListing, appraise, buyListing, cancelListing, fetchListings, fetchMine, sellToState, sellerGets,
  type AgencyError, type AgencyView, type Appraisal, type Asset, type AssetKind, type Result,
} from "@/game/agency/api";
import { agencyStrings } from "@/game/agency/strings";

/** /agency: First Light Realty. Listings of every kind of asset, my assets with List and Sell to the state. */
const Agency = () => {
  const { language } = useLanguage();
  const t = agencyStrings(language);
  const { session, signOut } = useAccount();
  const { refresh } = useEconomy();
  const [market, setMarket] = useState<AgencyView | null>(null);
  const [mine, setMine] = useState<AgencyView | null>(null);
  const [kind, setKind] = useState<AssetKind | "">("");
  const [error, setError] = useState<AgencyError | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [appr, setAppr] = useState<Appraisal | null>(null);

  const fail = useCallback((e: AgencyError) => (e === "session" ? signOut() : toast.error(t.errors[e])), [signOut, t]);
  const load = useCallback(async () => {
    const r = await fetchListings(session, kind || undefined);
    if (r.ok) {
      setMarket(r.data);
      setError(null);
    } else if (r.error === "session") signOut();
    else setError(r.error);
    if (session) {
      const m = await fetchMine(session);
      if (m.ok) setMine(m.data);
      else if (m.error === "session") signOut();
    }
  }, [session, kind, signOut]);
  useEffect(() => {
    void load();
  }, [load]);

  const act = async <T extends AgencyView>(key: string, call: () => Promise<Result<T>>, ok: (d: T) => string | void) => {
    setBusy(key);
    const r = await call();
    setBusy(null);
    if (!r.ok) {
      fail(r.error);
      if (r.error === "gone") void load();
      return;
    }
    const msg = ok(r.data);
    if (msg) toast.success(msg);
    void load();
    void refresh();
  };

  const laws = market?.laws ?? mine?.laws;
  const key = (a: { kind: string; ref: string }) => `${a.kind}:${a.ref}`;

  const assetRow = (a: Asset) => {
    const k = key(a);
    const p = Number(prices[k] || 0);
    return (
      <li key={k} className="space-y-2 rounded-xl border border-border bg-card/60 p-3 text-sm">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="font-semibold">{a.title}</span>
          <span className="text-xs text-muted-foreground">{t.kind[a.kind]}</span>
        </div>
        {a.place && <p className="text-xs text-muted-foreground">{a.place}</p>}
        {a.block ? (
          <p className="text-xs text-amber-300">{t.blocks[a.block]}</p>
        ) : a.listing ? (
          <p className="text-xs text-emerald-300">{t.listedAs(a.listing)}</p>
        ) : (
          <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => {
            e.preventDefault();
            if (session && p > 0) void act("list:" + k, () => addListing(session, a.kind, a.ref, p), () => t.listed);
          }}>
            <input className={`${inputBase} w-32`} inputMode="numeric" aria-label={t.priceLabel} placeholder={t.priceLabel}
              value={prices[k] ?? ""} onChange={(e) => setPrices({ ...prices, [k]: e.target.value.replace(/[^0-9]/g, "").slice(0, 10) })} />
            <button type="submit" className={btnMain} disabled={busy !== null || p < 1}>
              {busy === "list:" + k ? <Loader2 className="h-4 w-4 animate-spin" /> : <Tag className="h-4 w-4" />}{t.list}
            </button>
            {p > 0 && laws && <span className="text-xs text-muted-foreground">{t.youGet(sellerGets(p, laws))}</span>}
          </form>
        )}
        {a.kind === "plot" && session && (
          <button type="button" className={btnSoft} disabled={busy !== null}
            onClick={() => void act("appr:" + a.ref, () => appraise(session, Number(a.ref)), (d) => void setAppr(d.appraisal ?? null))}>
            {busy === "appr:" + a.ref ? <Loader2 className="h-4 w-4 animate-spin" /> : <Landmark className="h-4 w-4" />}{t.appraiseBtn}
          </button>
        )}
      </li>
    );
  };

  return (
    <Shell title={t.title} icon={Building2} back={{ to: "/world", label: t.backToWorld }}>
      <p className="mb-5 max-w-2xl text-sm text-muted-foreground">{t.intro}</p>
      {error && <p className="mb-4 text-sm text-destructive">{t.errors[error]}</p>}
      {!market && !error && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}
      {market && laws && (
        <div className="space-y-6">
          <Panel title={t.rulesTitle}>
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              {t.rules(laws).map((x) => <li key={x}>{x}</li>)}
            </ul>
          </Panel>

          <Panel title={t.market} icon={Tag}>
            <div className="flex flex-wrap gap-2">
              {(["", ...ASSET_KINDS] as const).map((k) => (
                <button key={k || "all"} type="button" onClick={() => setKind(k)}
                  className={`rounded-full border px-3 py-1 text-xs ${kind === k ? "border-amber-400 bg-amber-400/15 text-amber-200" : "border-border text-muted-foreground"}`}>
                  {k ? t.kinds[k] : t.all}
                </button>
              ))}
            </div>
            {mine?.free != null && <p className="text-xs text-muted-foreground">{t.free(mine.free)}</p>}
            {market.listings.length === 0 ? <p className="text-sm text-muted-foreground">{t.empty}</p> : (
              <ul className="grid gap-3 md:grid-cols-2">
                {market.listings.map((l) => (
                  <li key={l.id} className="space-y-2 rounded-xl border border-border bg-card/60 p-3 text-sm">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="font-semibold">{l.title}</span>
                      <span className="text-xs text-muted-foreground">{t.kind[l.kind]}</span>
                    </div>
                    {l.place && <p className="text-xs text-muted-foreground">{l.place}</p>}
                    <p className="text-xs text-muted-foreground">
                      {t.by(l.seller)}{l.registryPrice != null && <> · {t.registry(l.registryPrice)}</>}
                    </p>
                    <p className="text-base font-semibold text-amber-200">{t.tide(l.price)}</p>
                    {l.mine ? (
                      <p className="text-xs text-emerald-300">{t.yours}</p>
                    ) : session ? (
                      <button type="button" className={btnMain} disabled={busy !== null}
                        onClick={() => void act("buy:" + l.id, () => buyListing(session, l.id), () => t.bought(l.title))}>
                        {busy === "buy:" + l.id ? <Loader2 className="h-4 w-4 animate-spin" /> : t.buy(l.price, l.duty)}
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            {market.sold && market.sold.length > 0 && (
              <div className="space-y-1">
                <p className="text-sm font-semibold">{t.recent}</p>
                <ul className="space-y-1 text-xs text-muted-foreground">
                  {market.sold.map((s, i) => <li key={i}>{t.kind[s.kind]}: {s.title}, {t.tide(s.price)}</li>)}
                </ul>
              </div>
            )}
          </Panel>

          {!session ? (
            <p className="text-sm"><Link to="/login" className="text-primary hover:underline">{t.signIn}</Link></p>
          ) : mine && (
            <>
              <Panel title={t.myAssets} icon={Building2}>
                {(mine.assets ?? []).length === 0 ? <p className="text-sm text-muted-foreground">{t.noAssets}</p> : (
                  <ul className="grid gap-3 md:grid-cols-2">{(mine.assets ?? []).map(assetRow)}</ul>
                )}
              </Panel>
              {(mine.listings ?? []).length > 0 && (
                <Panel title={t.myListings} icon={Tag}>
                  <ul className="space-y-2 text-sm">
                    {mine.listings.map((l) => (
                      <li key={l.id} className="flex flex-wrap items-center gap-2">
                        <span>{t.kind[l.kind]}: {l.title}, {t.tide(l.price)}</span>
                        <button type="button" className={btnSoft} disabled={busy !== null}
                          onClick={() => void act("cancel:" + l.id, () => cancelListing(session, l.id), () => t.cancelled)}>
                          <X className="h-4 w-4" />{t.cancel}
                        </button>
                      </li>
                    ))}
                  </ul>
                </Panel>
              )}
              {(mine.history ?? []).length > 0 && (
                <Panel title={t.history} icon={History}>
                  <ul className="space-y-1 text-sm text-muted-foreground">
                    {(mine.history ?? []).map((h, i) => (
                      <li key={i}>{new Date(h.at).toLocaleString("en")}: {t.historyLine(h.side, h.title, h.price, h.fee, h.tax)}</li>
                    ))}
                  </ul>
                </Panel>
              )}
            </>
          )}
        </div>
      )}

      {appr && session && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center" role="dialog" aria-modal="true" onClick={() => setAppr(null)}>
          <div className="w-full max-w-md space-y-3 rounded-2xl border border-border bg-background p-5 pb-safe text-sm" onClick={(e) => e.stopPropagation()}>
            <p className="text-base font-semibold">{t.appraisalTitle(appr.address)}</p>
            <p>{t.land(appr.land, appr.landPct, Math.min(appr.pricePaid, appr.registryPrice))}</p>
            {appr.house > 0 && <p>{t.house(appr.house, appr.housePct)}</p>}
            <p>{t.tax(appr.tax, appr.taxPct)}</p>
            <p className="text-base font-semibold text-amber-200">{t.net(appr.net)}</p>
            <p className="text-xs text-muted-foreground">{t.stateNote}</p>
            {appr.block === "too_soon" ? <p className="text-xs text-amber-300">{t.sellableAt(appr.sellableAt)}</p>
              : appr.block ? <p className="text-xs text-amber-300">{t.errors[appr.block] ?? t.errors.action}</p> : null}
            <div className="flex flex-wrap gap-2">
              <button type="button" className={btnMain} disabled={busy !== null || appr.block !== null}
                onClick={() => void act("state:" + appr.plotId, () => sellToState(session, appr.plotId), () => {
                  const msg = t.soldState(appr.address, appr.net);
                  setAppr(null);
                  return msg;
                })}>
                {busy === "state:" + appr.plotId ? <Loader2 className="h-4 w-4 animate-spin" /> : <Landmark className="h-4 w-4" />}{t.confirmState(appr.net)}
              </button>
              <button type="button" className={btnSoft} onClick={() => setAppr(null)}>{t.close}</button>
            </div>
          </div>
        </div>
      )}
    </Shell>
  );
};

export default Agency;
