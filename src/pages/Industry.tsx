import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Factory, Hammer, Loader2, Pickaxe, Rocket, Store, Trash2, Warehouse } from "lucide-react";
import { toast } from "sonner";
import { useLanguage } from "@/i18n/LanguageContext";
import { useAccount } from "@/game/account/AccountContext";
import { useEconomy } from "@/game/economy/EconomyContext";
import { Shell } from "@/game/state/ui";
import { Panel, btnMain, btnSoft, inputBase } from "@/game/bank/ui";
import { farmStrings, goodName } from "@/game/farm/strings";
import {
  dismantle, fetchCatalog, produce, setupWorks, ship,
  type IndustryError, type IndustryPlot, type MyIndustry, type Result, type WorksType,
} from "@/game/industry/api";
import { industryStrings, type IndustryStrings } from "@/game/industry/strings";

const cap = (s: string | null) => (s ? s[0].toUpperCase() + s.slice(1) : "");

function WorksCard({ p, types, t, good, busy, highlight, onSetup, onCollect, onDismantle }: {
  p: IndustryPlot; types: WorksType[]; t: IndustryStrings; good: (k: string) => string; busy: string | null; highlight: boolean;
  onSetup: (id: number, k: string) => void; onCollect: (id: number) => void; onDismantle: (id: number) => void;
}) {
  const fits = types.filter((x) => p.options && p.options[x.key] !== undefined);
  const [pick, setPick] = useState(fits[0]?.key ?? "");
  const [arm, setArm] = useState(false);
  const w = p.works;
  const wt = w ? types.find((x) => x.key === w.kind) : fits.find((x) => x.key === pick) ?? fits[0];
  return (
    <li id={`plot-${p.plotId}`} className={`rounded-xl border p-3 ${highlight ? "border-amber-300 bg-amber-400/10" : "border-border bg-background/40"}`}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate font-semibold">{p.address}</span>
        <span className="shrink-0 text-xs text-muted-foreground">{p.district} · {t.n(p.tiles)} tiles</span>
      </div>
      {w && wt ? (
        <div className="mt-2 space-y-1.5 text-sm">
          <p className="font-semibold text-amber-200">{t.works[w.kind] ?? w.kind} · {wt.in1 ? "" : `${t.rich(w.factor)} `}×{w.factor}</p>
          <p className="text-muted-foreground">{t.perDay(w.perDay, good(wt.product))}{wt.in1 ? `, ${t.needs(wt.in1Qty, good(wt.in1))}` : ""}{wt.in2 ? ` + ${t.needs(wt.in2Qty, good(wt.in2))}` : ""}</p>
          <p className={w.pending > 0 ? "text-emerald-300" : "text-muted-foreground"}>{t.waiting(w.pending, good(wt.product))}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btnMain} disabled={busy !== null || w.pending < 1} onClick={() => onCollect(p.plotId)}>
              {busy === "collect:" + p.plotId ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pickaxe className="h-4 w-4" />}{t.collect}
            </button>
            <button type="button" className={btnSoft} disabled={busy !== null} onClick={() => (arm ? onDismantle(p.plotId) : setArm(true))}>
              <Trash2 className="h-4 w-4" />{arm ? t.dismantleConfirm : t.dismantle}
            </button>
          </div>
        </div>
      ) : p.block === "planted" ? (
        <p className="mt-1 text-sm text-muted-foreground">{t.blockPlanted}</p>
      ) : p.block === "building" ? (
        <p className="mt-1 text-sm text-muted-foreground">{t.blockBuilding}</p>
      ) : !wt ? (
        <p className="mt-1 text-sm text-muted-foreground">{t.nothingFits}</p>
      ) : (
        <div className="mt-2 space-y-2">
          <select aria-label={t.choose} className={`${inputBase} w-full`} value={wt.key} onChange={(e) => setPick(e.target.value)}>
            {fits.map((x) => (
              <option key={x.key} value={x.key}>
                {t.works[x.key] ?? x.key} → {good(x.product)} · {t.n(Math.round(x.rate * p.tiles * (p.options?.[x.key] ?? 1) * 10) / 10)}/day{x.in1 ? "" : ` · ${t.rich(p.options?.[x.key] ?? 1)}`}
              </option>
            ))}
          </select>
          {wt.in1 && <p className="text-xs text-muted-foreground">{t.needs(wt.in1Qty, good(wt.in1))}{wt.in2 ? ` + ${t.needs(wt.in2Qty, good(wt.in2))}` : ""}</p>}
          <button type="button" className={`${btnMain} w-full`} disabled={busy !== null} onClick={() => onSetup(p.plotId, wt.key)}>
            {busy === "setup:" + p.plotId ? <Loader2 className="h-4 w-4 animate-spin" /> : <Factory className="h-4 w-4" />}{t.setupFor(wt.cost, wt.permit)}
          </button>
        </div>
      )}
    </li>
  );
}

/** /industry: companies on my land, the storehouse, Orbit shipments, and what building takes. */
const Industry = () => {
  const { language } = useLanguage();
  const t = industryStrings(language);
  const tf = farmStrings(language);
  const good = useCallback((k: string) => goodName(tf, k), [tf]);
  const { session, signOut } = useAccount();
  const { refresh } = useEconomy();
  const [params] = useSearchParams();
  const focus = Number(params.get("plot") ?? NaN);
  const [data, setData] = useState<MyIndustry | null>(null);
  const [error, setError] = useState<IndustryError | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const fail = useCallback((e: IndustryError) => (e === "session" ? signOut() : toast.error(t.errors[e])), [signOut, t]);

  useEffect(() => {
    void fetchCatalog(session).then((r) => (r.ok ? setData(r.data) : r.error === "session" ? signOut() : setError(r.error)));
  }, [session, signOut]);
  useEffect(() => {
    if (data?.plots && Number.isFinite(focus)) document.getElementById(`plot-${focus}`)?.scrollIntoView({ block: "center" });
  }, [data?.plots, focus]);

  const act = async (key: string, run: () => Promise<Result<MyIndustry>>, done: (d: MyIndustry) => string) => {
    setBusy(key);
    const r = await run();
    setBusy(null);
    if (!r.ok) return fail(r.error);
    setData(r.data);
    toast.success(done(r.data));
    void refresh();
  };
  const collectMsg = (d: MyIndustry) => t.collected(d.collected ?? 0, d.units ?? 0);
  const plots = data?.plots ?? [];
  const store = Object.entries(data?.store ?? {});

  return (
    <Shell title={t.title} icon={Factory} back={{ to: "/world", label: t.backToWorld }} accent="text-amber-300">
      <p className="mb-3 max-w-2xl text-sm text-muted-foreground">{t.intro}</p>
      {error && <p className="mb-4 text-sm text-destructive">{t.errors[error]}</p>}
      {!data && !error && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}
      {data && (
        <div className="space-y-6">
          <p className="text-xs text-muted-foreground">{t.stats(data.companies, data.owners)}</p>
          {!session ? (
            <p className="text-sm"><Link to="/login" className="text-primary underline">{t.signIn}</Link></p>
          ) : (
            <>
              <Panel title={t.myWorks} icon={Factory}>
                <p className="text-xs text-muted-foreground">{t.capNote(data.laws.capHours)} {t.free(data.free)}</p>
                <p className="text-xs text-muted-foreground">{t.workersNote} <Link to="/orders" className="text-primary underline">{t.workersLink}</Link></p>
                {plots.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t.noPlots} <Link to="/world" className="text-primary underline">{t.backToWorld}</Link></p>
                ) : (
                  <>
                    {plots.some((p) => p.works && p.works.pending > 0) && (
                      <button type="button" className={btnMain} disabled={busy !== null} onClick={() => void act("collect", () => produce(session), collectMsg)}>
                        {busy === "collect" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pickaxe className="h-4 w-4" />}{t.collectAll}
                      </button>
                    )}
                    <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {plots.map((p) => (
                        <WorksCard key={p.plotId} p={p} types={data.types} t={t} good={good} busy={busy} highlight={p.plotId === focus}
                          onSetup={(id, k) => void act("setup:" + id, () => setupWorks(session, id, k), (d) => t.set(d.cost ?? 0, d.permit ?? 0))}
                          onCollect={(id) => void act("collect:" + id, () => produce(session, id), collectMsg)}
                          onDismantle={(id) => void act("dismantle:" + id, () => dismantle(session, id), () => t.dismantled)} />
                      ))}
                    </ul>
                  </>
                )}
              </Panel>

              <Panel title={t.store} icon={Warehouse}>
                {store.length === 0 ? <p className="text-sm text-muted-foreground">{t.storeEmpty}</p> : (
                  <ul className="grid grid-cols-2 gap-1 text-sm sm:grid-cols-3">
                    {store.map(([k, u]) => <li key={k}><span className="font-semibold">{good(k)}</span> {t.n(u)}</li>)}
                  </ul>
                )}
                <Link to="/farm?goods=industry#market" className={`${btnSoft} inline-flex`}><Store className="h-4 w-4" />{t.trade}</Link>
              </Panel>

              {data.orbit.length > 0 && (
                <Panel title={t.orbit} icon={Rocket}>
                  <ul className="space-y-2 text-sm">
                    {data.orbit.map((o) => (
                      <li key={o.resource} className="flex flex-wrap items-center gap-2">
                        <span className="min-w-[9rem] font-semibold">{good(o.good)}</span>
                        <button type="button" className={btnSoft} disabled={busy !== null}
                          onClick={() => void act("ship:" + o.resource, () => ship(session, o.resource), (d) => t.shipped(d.shipped ?? 0))}>
                          {busy === "ship:" + o.resource ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}{t.shipAll(o.units)}
                        </button>
                      </li>
                    ))}
                  </ul>
                </Panel>
              )}
            </>
          )}

          <Panel title={t.catalog} icon={Pickaxe}>
            <p className="text-xs text-muted-foreground">{t.catalogNote}</p>
            <ul className="space-y-1.5 text-sm">
              {data.types.map((x) => (
                <li key={x.key}>
                  <span className="font-semibold">{t.works[x.key] ?? x.key}</span> → {good(x.product)}
                  <span className="text-muted-foreground">
                    {x.in1 ? ` · ${t.needs(x.in1Qty, good(x.in1))}${x.in2 ? ` + ${t.needs(x.in2Qty, good(x.in2))}` : ""}` : ""} · {x.rate}/tile/day · {t.tide(x.cost + x.permit)} · {t.place[x.place]}
                    {x.biomes && x.place !== "water" ? ` · best: ${Object.entries(x.biomes).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([b]) => cap(b)).join(", ")}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel title={t.recipes} icon={Hammer}>
            <p className="text-xs text-muted-foreground">{t.recipeNote(data.laws.depotPct, data.laws.salvagePct, data.laws.starterSalvagePct)}</p>
            {(["cottage", "tower"] as const).map((k) => (
              <p key={k} className="text-sm"><span className="font-semibold">{t[k]}:</span>{" "}
                {Object.entries(data.recipes?.[k] ?? {}).map(([g, q]) => `${q} ${good(g)}`).join(" · ")}</p>
            ))}
          </Panel>
        </div>
      )}
    </Shell>
  );
};

export default Industry;
