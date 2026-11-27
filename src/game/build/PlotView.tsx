import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Building2, Car, Coins, Factory, Hammer, Home, Loader2, RotateCcw, RotateCw, Scale, Sprout, Trash2, Users, X } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import type { Plot, World } from "@/game/world/generator";
import {
  buildingFor,
  builtBuilding,
  COTTAGE_CHOICES,
  designCottage,
  designTower,
  hasHouse,
  isCentre,
  LEVEL_FLOORS,
  starterKind,
  TOWER_CHOICES,
  towerChoice,
  towerSite,
  type Building,
  type Built,
} from "@/game/world/buildings";
import { cottagePalette, drawCottage } from "@/game/world/cottages";
import { WorldRenderer } from "@/game/world/renderer";
import type { WorldStrings } from "@/game/world/strings";
import type { PlotOwner } from "@/game/economy/EconomyContext";
import { buildOn, collectIncome, demolish, raiseTower, sellBuilding, withPermit, type BuildRules, type MyBuilding, type Result } from "./api";
import type { BuildStrings } from "./strings";
import { fetchCatalog, materialsSaving, recipeFor, type MyIndustry } from "@/game/industry/api";
import { farmStrings, goodName } from "@/game/farm/strings";
import { loadStaff, staffPlan, type PlotStaff } from "@/game/orders/workers";

const tfarm = farmStrings("en");

/** What a construction takes in materials, and how much of the price the storehouse covers. */
function Materials({ cat, kind, cost }: { cat: MyIndustry | null; kind: "cottage" | "tower"; cost: number }) {
  if (!cat?.recipes) return null;
  const saved = materialsSaving(cat, cat.store ?? {}, kind, cost);
  return (
    <p className="text-xs text-amber-200/90">
      Materials: {recipeFor(cat, kind, cost).map((x) => `${x.qty} ${goodName(tfarm, x.key)}`).join(", ")}.{" "}
      {saved > 0 ? `Your storehouse covers ${saved.toLocaleString("en")} TIDE of it.` : "Missing ones come from the Builder Depot, inside the price."}{" "}
      <Link to="/industry" className="underline">Industry</Link>
    </p>
  );
}

interface Props {
  world: World;
  plot: Plot;
  built: Map<number, Built>;
  rules: BuildRules | null;
  mine: MyBuilding | null;
  owner: PlotOwner | null;
  session: string | null;
  t: BuildStrings;
  tw: WorldStrings;
  onChanged: () => Promise<void>;
  onClose: () => void;
}

type Choice = { kind: "cottage" | "tower"; design: number } | null;

/** Workers of this plot: people living in a home, or workers at a company or field (server/city). */
function PlotWorkers({ world, plot }: { world: World; plot: Plot }) {
  const [st, setSt] = useState<PlotStaff | null>(null);
  useEffect(() => {
    let stop = false;
    void loadStaff().then((g) => !stop && setSt(staffPlan(world, g).perPlot.get(plot.id) ?? null));
    return () => {
      stop = true;
    };
  }, [world, plot.id]);
  if (!st) return null;
  return (
    <section className="space-y-1 rounded-xl border border-orange-400/40 bg-orange-400/5 p-3 text-sm">
      <h3 className="flex items-center gap-1.5 font-semibold text-orange-200"><Users className="h-4 w-4" />Workers</h3>
      {st.people !== undefined && <p>{st.people} {st.people === 1 ? "person lives" : "people live"} here and work at the owner's companies and farms.</p>}
      {st.jobs !== undefined && (
        <p>
          {st.workers} of {st.jobs} jobs filled · output {Math.round((st.output ?? 1) * 100)}%
          {st.workers !== undefined && st.workers < st.jobs ? ". More homes bring more workers." : "."}
        </p>
      )}
      <Link to="/orders" className="text-xs underline">Workforce and city orders</Link>
    </section>
  );
}

/** The plot opened on (almost) the whole screen: the main place where residents build. */
export default function PlotView({ world, plot, built, rules, mine, owner, session, t, tw, onChanged, onClose }: Props) {
  const [view, setView] = useState<"side" | "top">("side");
  const [choice, setChoice] = useState<Choice>(null);
  const [busy, setBusy] = useState(false);
  const [arm, setArm] = useState<string | null>(null);
  const [cat, setCat] = useState<MyIndustry | null>(null);
  useEffect(() => {
    if (session) void fetchCatalog(session).then((r) => r.ok && setCat(r.data));
  }, [session, busy]);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(id);
  }, []);

  const b = built.get(plot.id) ?? null;
  const start = buildingFor(world, plot);
  const standing: Building | null = b ? builtBuilding(world, plot, b, now / 1000) : start;
  const has = b ? b.kind !== "empty" : !!start;
  const yours = !!owner?.mine;
  const canBuild = hasHouse(plot);
  const towerOk = towerSite(plot);
  const centre = isCentre(world, plot);
  const building = !!b && b.kind !== "empty" && b.readyAt * 1000 > now;
  const biome = plot.district >= 0 ? world.districts[plot.district].biome : "temperate";

  // what the views show: the chosen design as a preview, else what stands
  const previewBuilt: Built | null = choice ? { kind: choice.kind, level: choice.kind === "tower" ? 3 : 0, design: choice.design, readyAt: 0 } : null;
  const shown: Building | null = previewBuilt ? builtBuilding(world, plot, previewBuilt, now / 1000) : standing;

  const run = useCallback(
    async (key: string, f: () => Promise<Result<unknown>>, ok: string) => {
      if (arm !== key) {
        setArm(key);
        return;
      }
      setArm(null);
      setBusy(true);
      const r = await f();
      setBusy(false);
      if (!r.ok) toast.error(t.errors[r.error]);
      else {
        toast.success(ok);
        setChoice(null);
      }
      await onChanged();
    },
    [arm, onChanged, t],
  );

  const p = rules?.params;
  const level = b?.kind === "tower" ? b.level : -1;
  const next = level >= 0 && level < 3 ? level + 1 : null;
  const nextFloors = next !== null ? LEVEL_FLOORS[next] : 0;
  const overLimit = centre && rules ? nextFloors > rules.centreHeight : false;

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/70 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-[max(0.5rem,env(safe-area-inset-top))] backdrop-blur-sm md:p-5" role="dialog" aria-modal="true" aria-label={plot.address}>
      <div className="relative flex w-full max-w-7xl flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl md:flex-row">
        {/* the plot itself */}
        <div className="relative min-h-[45dvh] flex-1 bg-[#0b1622] md:min-h-0">
          {view === "side" ? (
            <SideView world={world} plot={plot} built={built} preview={previewBuilt} />
          ) : (
            <TopView world={world} plot={plot} building={shown} t={t} />
          )}
          <div className="absolute left-3 top-3 flex gap-1 rounded-lg border border-border bg-background/85 p-1 backdrop-blur">
            {(["side", "top"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                aria-pressed={view === v}
                className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium ${view === v ? "bg-cyan-400 text-black" : "text-muted-foreground hover:text-foreground"}`}
              >
                {v === "side" ? <Box className="h-3.5 w-3.5" /> : <Scale className="h-3.5 w-3.5" />}
                {v === "side" ? t.view3d : t.viewTop}
              </button>
            ))}
          </div>
          {choice && (
            <p className="absolute bottom-3 left-3 rounded-md bg-cyan-400/90 px-2.5 py-1 text-xs font-semibold text-black">
              {choice.kind === "tower" ? `${shown?.tower?.name ?? ""} · ${t.floors(60)}` : t.chooseDesign}
            </p>
          )}
        </div>

        {/* the building office */}
        <aside className="max-h-[50vh] w-full space-y-4 overflow-auto border-t border-border p-4 md:max-h-none md:w-96 md:border-l md:border-t-0">
          <button onClick={onClose} aria-label={t.close} className="absolute right-3 top-3 z-10 rounded-md bg-background/80 p-1 text-muted-foreground hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
          <div className="pr-8">
            <h2 className="font-display text-xl font-bold">{plot.address}</h2>
            <p className="text-sm text-muted-foreground">
              {plot.district >= 0 ? world.districts[plot.district].name : tw.openSea} · {(plot.tiles.length * 400).toLocaleString("en")} {tw.m2}
            </p>
          </div>
          {/* what the map card leaves out to stay small */}
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 rounded-lg border border-border p-3 text-sm">
            {plot.district >= 0 && (
              <>
                <dt className="text-muted-foreground">{tw.climate}</dt>
                <dd className="font-medium">{tw.biomes[world.districts[plot.district].biome]}</dd>
              </>
            )}
            <dt className="text-muted-foreground">{tw.landscape}</dt>
            <dd className="font-medium">{tw.landscapes[plot.landscape]}</dd>
            <dt className="text-muted-foreground">{tw.toTower}</dt>
            <dd className="font-medium">
              {(Math.round((plot.distance * 20) / 100) / 10).toLocaleString("en")} {tw.km}
            </dd>
            {!plot.water && (
              <>
                <dt className="text-muted-foreground">{tw.water}</dt>
                <dd className="font-medium">{plot.waterView ? tw.yes : tw.no}</dd>
              </>
            )}
          </dl>
          {plot.water && <p className="text-xs text-muted-foreground">{tw.waterNote}</p>}

          <section className="space-y-1.5 rounded-lg border border-border p-3">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold">
              <Home className="h-4 w-4 text-primary" />
              {t.onPlot}
            </h3>
            {!has || !standing ? (
              <p className="text-sm text-muted-foreground">{building ? t.foundation : t.nothingYet}</p>
            ) : (
              <p className="text-sm">
                {standing.tower ? `${standing.tower.name} · ${standing.floors === 1 ? t.foundation : t.floors(standing.floors)}` : b?.kind === "cottage" ? t.cottage : starterKind(start) === "works" ? t.works : t.starterHome}
                {standing.cottage ? ` · ${tw.cottageMaterials[standing.cottage.material]} ${tw.cottageForms[standing.cottage.form]}, ${t.floors(standing.floors)}` : ""}
              </p>
            )}
            {building && b && <p className="text-xs font-medium text-amber-300">{t.underConstruction(t.readyIn(b.readyAt * 1000 - now))}{b.kind === "tower" && b.level > 0 ? ` · ${t.floors(LEVEL_FLOORS[b.level])}` : ""}</p>}
            {mine && !building && (mine.rate > 0 ? <p className="text-xs text-muted-foreground">{t.income(mine.rate, Number(mine.taxPct))}</p> : <p className="text-xs text-muted-foreground">{t.noIncome}</p>)}
            {mine && mine.pending > 0 && (
              <button
                disabled={busy}
                onClick={async () => {
                  if (!session) return;
                  setBusy(true);
                  const r = await collectIncome(session);
                  setBusy(false);
                  if (!r.ok) toast.error(t.errors[r.error]);
                  else toast.success(t.collected(r.data.amount, r.data.tax));
                  await onChanged();
                }}
                className="mt-1 flex h-9 w-full items-center justify-center gap-2 rounded-md bg-emerald-400 text-sm font-semibold text-black hover:bg-emerald-300 disabled:opacity-50"
              >
                <Coins className="h-4 w-4" />
                {t.collect} · {mine.pending.toLocaleString("en")} TIDE
              </button>
            )}
          </section>

          <section className="space-y-1.5 rounded-lg border border-dashed border-border p-3">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold">
              <Car className="h-4 w-4 text-primary" />
              {t.assets}
            </h3>
            <p className="text-xs text-muted-foreground">{t.assetsSoon}</p>
          </section>

          {centre && rules && (
            <p className="rounded-md bg-muted/60 p-2.5 text-xs text-muted-foreground">
              {t.centreLimit(rules.centreHeight)}{" "}
              <Link to="/state/new" className="text-primary hover:underline">
                {t.centreLaw}
              </Link>
            </p>
          )}

          {!canBuild ? (
            <p className="text-sm text-muted-foreground">{t.noBuild}</p>
          ) : !session ? (
            <p className="text-sm text-muted-foreground">{t.signIn}</p>
          ) : !owner ? (
            <p className="text-sm text-muted-foreground">{t.buyFirst}</p>
          ) : !yours ? (
            <p className="text-sm text-muted-foreground">{t.notYours}</p>
          ) : !rules || !p ? (
            <p className="text-sm text-muted-foreground">{t.serverDown}</p>
          ) : (
            <section className="space-y-3">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold">
                <Hammer className="h-4 w-4 text-primary" />
                {t.build}
              </h3>

              {/* raise a skyscraper that stands here */}
              {next !== null && (
                <div className="space-y-1.5 rounded-lg border border-cyan-400/40 bg-cyan-400/5 p-3">
                  <p className="text-sm font-medium">{t.raise(nextFloors)}</p>
                  <p className="text-xs text-muted-foreground">{t.cost(p[`tower_cost_${next}` as const], withPermit(p[`tower_cost_${next}` as const], rules) - p[`tower_cost_${next}` as const], p[`hours_${next}` as const])}</p>
                  <Materials cat={cat} kind="tower" cost={p[`tower_cost_${next}` as const]} />
                  {overLimit ? (
                    <p className="text-xs text-rose-300">{t.errors.height_limit}</p>
                  ) : (
                    <button
                      disabled={busy || building}
                      onClick={() => run("raise", () => raiseTower(session, plot.id), t.done)}
                      className="flex h-9 w-full items-center justify-center gap-2 rounded-md bg-cyan-400 text-sm font-semibold text-black hover:bg-cyan-300 disabled:opacity-50"
                    >
                      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Building2 className="h-4 w-4" />}
                      {arm === "raise" ? t.confirm : building ? t.errors.building : t.pay(withPermit(p[`tower_cost_${next}` as const], rules) - (cat ? materialsSaving(cat, cat.store ?? {}, "tower", p[`tower_cost_${next}` as const]) : 0))}
                    </button>
                  )}
                </div>
              )}

              <Ladder rules={rules} t={t} level={level} />

              {/* new building: choose a design, see it on the plot, pay */}
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">{t.buildCottage}</p>
                <div className="grid grid-cols-3 gap-1.5">
                  {Array.from({ length: COTTAGE_CHOICES }, (_, k) => (
                    <button
                      key={k}
                      onClick={() => setChoice(choice?.kind === "cottage" && choice.design === k ? null : { kind: "cottage", design: k })}
                      aria-pressed={choice?.kind === "cottage" && choice.design === k}
                      className={`rounded-md border p-1 ${choice?.kind === "cottage" && choice.design === k ? "border-cyan-400 bg-cyan-400/10" : "border-border hover:border-primary"}`}
                    >
                      <CottageThumb world={world} plot={plot} design={k} />
                      <span className="block text-[10px] text-muted-foreground">{t.design(k + 1)}</span>
                    </button>
                  ))}
                </div>
                <p className="text-xs font-medium text-muted-foreground">{t.buildTower}</p>
                {towerOk ? (
                  <div className="grid grid-cols-3 gap-1.5">
                    {Array.from({ length: TOWER_CHOICES }, (_, k) => {
                      const d = towerChoice(plot, k);
                      const tower = designTower(world, plot, 60, d).tower!;
                      const on = choice?.kind === "tower" && choice.design === d;
                      return (
                        <button
                          key={k}
                          onClick={() => setChoice(on ? null : { kind: "tower", design: d })}
                          aria-pressed={on}
                          className={`rounded-md border p-1.5 text-left ${on ? "border-cyan-400 bg-cyan-400/10" : "border-border hover:border-primary"}`}
                        >
                          <span className="mb-1 block h-8 rounded-sm" style={{ background: `linear-gradient(180deg, rgb(${tower.glass.join(",")}), rgb(${tower.frame.join(",")}))` }} />
                          <span className="block truncate text-[10px] leading-tight">{tower.name}</span>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">{t.towerNeedsLand}</p>
                )}
                {choice && (
                  <div className="space-y-1.5 rounded-lg border border-cyan-400/40 bg-cyan-400/5 p-3">
                    {(() => {
                      const cost = choice.kind === "cottage" ? p.cottage_cost : p.tower_cost_0;
                      const total = withPermit(cost, rules) + (has ? p.demolish_cost : 0) - (cat ? materialsSaving(cat, cat.store ?? {}, choice.kind, cost) : 0);
                      return (
                        <>
                          <p className="text-sm font-medium">{choice.kind === "cottage" ? t.buildCottage : t.buildTower}</p>
                          <p className="text-xs text-muted-foreground">{t.cost(cost, withPermit(cost, rules) - cost, choice.kind === "cottage" ? p.hours_cottage : p.hours_0)}</p>
                          <Materials cat={cat} kind={choice.kind} cost={cost} />
                          {has && <p className="text-xs text-amber-300">{t.replaceNote}</p>}
                          <button
                            disabled={busy}
                            onClick={() => run("build", () => buildOn(session, plot.id, choice.kind, choice.design, has), t.done)}
                            className="flex h-9 w-full items-center justify-center gap-2 rounded-md bg-cyan-400 text-sm font-semibold text-black hover:bg-cyan-300 disabled:opacity-50"
                          >
                            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Hammer className="h-4 w-4" />}
                            {arm === "build" ? t.confirm : t.pay(total)}
                          </button>
                        </>
                      );
                    })()}
                  </div>
                )}
              </div>

              {has && (
                <div className="flex flex-col gap-1.5 border-t border-border pt-3">
                  {b && b.kind !== "empty" && mine && (
                    <button
                      disabled={busy}
                      onClick={() => run("sell", () => sellBuilding(session, plot.id), t.done)}
                      className="flex h-9 items-center justify-center gap-2 rounded-md border border-border text-sm hover:border-primary disabled:opacity-50"
                    >
                      <Coins className="h-4 w-4" />
                      {arm === "sell" ? t.confirm : t.sell(Math.floor((mine.invested * p.sell_back_pct) / 100))}
                    </button>
                  )}
                  <button
                    disabled={busy}
                    onClick={() => run("demolish", () => demolish(session, plot.id), t.done)}
                    className="flex h-9 items-center justify-center gap-2 rounded-md border border-rose-400/50 text-sm text-rose-300 hover:bg-rose-400/10 disabled:opacity-50"
                  >
                    <Trash2 className="h-4 w-4" />
                    {arm === "demolish" ? t.confirm : t.demolish(p.demolish_cost)}
                  </button>
                  {cat?.laws && <p className="text-xs text-muted-foreground">Demolishing returns {cat.laws.salvagePct}% of the materials to your storehouse.</p>}
                </div>
              )}
            </section>
          )}
          <PlotWorkers world={world} plot={plot} />
          {yours && (
            <Link to={`/farm?plot=${plot.id}`} className="flex h-9 items-center justify-center gap-2 rounded-md border border-emerald-400/50 text-sm text-emerald-200 hover:bg-emerald-400/10">
              <Sprout className="h-4 w-4" />
              {t.farm}
            </Link>
          )}
          {yours && (
            <Link to={`/industry?plot=${plot.id}`} className="flex h-9 items-center justify-center gap-2 rounded-md border border-orange-400/50 text-sm text-orange-200 hover:bg-orange-400/10">
              <Factory className="h-4 w-4" />
              Set up a company
            </Link>
          )}
        </aside>
      </div>
    </div>
  );
}

/** Foundation → 10 → 30 → 60 floors, with what each level costs and earns. */
function Ladder({ rules, t, level }: { rules: BuildRules; t: BuildStrings; level: number }) {
  const p = rules.params;
  const rows = [0, 1, 2, 3].map((l) => ({
    l,
    label: l === 0 ? t.foundation : t.floors(LEVEL_FLOORS[l]),
    cost: withPermit(p[`tower_cost_${l}` as const], rules),
    income: l === 0 ? 0 : p[`tower_income_${l}` as const],
    tax: l <= 1 ? rules.incomeTaxPct : rules.incomeTaxPct + (l - 1) * p.tower_tax_step_pct,
  }));
  return (
    <details className="rounded-lg border border-border p-3 text-xs">
      <summary className="cursor-pointer font-medium">{t.ladder}</summary>
      <p className="mt-1.5 text-muted-foreground">{t.ladderNote}</p>
      <table className="mt-2 w-full">
        <tbody>
          {rows.map((r) => (
            <tr key={r.l} className={r.l === level ? "text-cyan-200" : r.l < level ? "text-muted-foreground line-through" : ""}>
              <td className="py-0.5">{r.label}</td>
              <td className="text-right">{r.cost.toLocaleString("en")} TIDE</td>
              <td className="text-right">{r.income ? `+${r.income}/day` : "—"}</td>
              <td className="text-right">{r.income ? `${r.tax}%` : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

/** A close look at the plot and its neighbours, from the side, in the map's own renderer. */
function SideView({ world, plot, built, preview }: { world: World; plot: Plot; built: Map<number, Built>; preview: Built | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const rRef = useRef<WorldRenderer | null>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const r = new WorldRenderer(canvas, world, { tower: "First Light Tower" });
    rRef.current = r;
    const size = () => {
      const rect = wrap.getBoundingClientRect();
      r.resize(rect.width, rect.height, Math.min(window.devicePixelRatio || 1, 2));
    };
    size();
    r.liftSelected = false;
    r.selectedPlot = plot.id;
    const big = plot.tiles.length >= 5;
    r.focusTile(plot.anchor.x, plot.anchor.y, big ? 2.2 : 3.4);
    const ro = new ResizeObserver(size);
    ro.observe(wrap);
    let raf = 0;
    const loop = (time: number) => {
      r.draw(time);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    // drag to look around, wheel to zoom
    let last: { x: number; y: number } | null = null;
    const down = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId);
      last = { x: e.clientX, y: e.clientY };
    };
    const move = (e: PointerEvent) => {
      if (!last) return;
      r.pan(e.clientX - last.x, e.clientY - last.y);
      last = { x: e.clientX, y: e.clientY };
    };
    const up = () => (last = null);
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      r.zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - rect.left, e.clientY - rect.top);
    };
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    canvas.addEventListener("wheel", wheel, { passive: false });
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", up);
      canvas.removeEventListener("wheel", wheel);
      rRef.current = null;
    };
  }, [world, plot]);

  useEffect(() => {
    const m = new Map(built);
    if (preview) m.set(plot.id, preview);
    rRef.current?.setBuilt(m);
  }, [built, preview, plot.id]);

  return (
    <div ref={wrapRef} className="absolute inset-0">
      <canvas ref={canvasRef} className="h-full w-full cursor-grab touch-none" />
      <div className="absolute right-3 top-3 flex gap-1">
        {([-1, 1] as const).map((d) => (
          <button
            key={d}
            onClick={() => rRef.current?.rotate(d)}
            aria-label="Turn"
            className="flex h-9 w-9 items-center justify-center rounded-md border border-border bg-background/85 backdrop-blur hover:border-primary"
          >
            {d < 0 ? <RotateCcw className="h-4 w-4" /> : <RotateCw className="h-4 w-4" />}
          </button>
        ))}
      </div>
    </div>
  );
}

/** The plot from above: its tiles to scale, the building's footprint and height, and a scale bar. */
function TopView({ world, plot, building, t }: { world: World; plot: Plot; building: Building | null; t: BuildStrings }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 600, h: 400 });
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const ro = new ResizeObserver(() => {
      const r = wrap.getBoundingClientRect();
      setBox({ w: r.width, h: r.height });
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);
  const n = world.size;
  const bounds = useMemo(() => {
    const xs = plot.tiles.map((i) => i % n);
    const ys = plot.tiles.map((i) => Math.floor(i / n));
    return { x0: Math.min(...xs) - 2, x1: Math.max(...xs) + 2, y0: Math.min(...ys) - 2, y1: Math.max(...ys) + 2 };
  }, [plot, n]);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = box.w * dpr;
    c.height = box.h * dpr;
    const ctx = c.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#0b1622";
    ctx.fillRect(0, 0, box.w, box.h);
    const cols = bounds.x1 - bounds.x0 + 1;
    const rows = bounds.y1 - bounds.y0 + 1;
    const s = Math.min((box.w - 40) / cols, (box.h - 70) / rows);
    const ox = (box.w - s * cols) / 2;
    const oy = (box.h - s * rows) / 2;
    const own = new Set(plot.tiles);
    const heights = new Map<number, number>();
    if (building?.tower) building.tower.tiles.forEach((tile, k) => heights.set(tile, building.tower!.heights[k]));
    const top = Math.max(1, ...heights.values());
    for (let y = bounds.y0; y <= bounds.y1; y++)
      for (let x = bounds.x0; x <= bounds.x1; x++) {
        if (x < 0 || y < 0 || x >= n || y >= n) continue;
        const i = y * n + x;
        const px = ox + (x - bounds.x0) * s;
        const py = oy + (y - bounds.y0) * s;
        const water = world.plotOf[i] >= 0 && world.plots[world.plotOf[i]].water;
        ctx.fillStyle = own.has(i) ? "#24476a" : water ? "#123b5c" : "#1a2a38";
        ctx.fillRect(px + 0.5, py + 0.5, s - 1, s - 1);
        const h = heights.get(i);
        if (h) {
          const k = h / top;
          const g = building!.tower!.glass;
          ctx.fillStyle = `rgba(${g[0]},${g[1]},${g[2]},${0.35 + 0.6 * k})`;
          const m = s * 0.08;
          ctx.fillRect(px + m, py + m, s - 2 * m, s - 2 * m);
          if (s > 26) {
            ctx.fillStyle = "#fff";
            ctx.font = `${Math.min(14, s / 3)}px system-ui`;
            ctx.textAlign = "center";
            ctx.fillText(String(h), px + s / 2, py + s / 2 + 4);
          }
        }
      }
    // plot outline
    ctx.strokeStyle = "rgba(160,250,255,0.95)";
    ctx.lineWidth = 2;
    for (const i of plot.tiles) {
      const x = i % n;
      const y = Math.floor(i / n);
      const px = ox + (x - bounds.x0) * s;
      const py = oy + (y - bounds.y0) * s;
      const edge = (ax: number, ay: number, bx: number, by: number) => {
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
      };
      ctx.beginPath();
      if (!own.has(i - n)) edge(px, py, px + s, py);
      if (!own.has(i + n)) edge(px, py + s, px + s, py + s);
      if (x === 0 || !own.has(i - 1)) edge(px, py, px, py + s);
      if (x === n - 1 || !own.has(i + 1)) edge(px + s, py, px + s, py + s);
      ctx.stroke();
    }
    // a house: its footprint on the plot's main tile
    if (building && !building.tower) {
      const x = plot.anchor.x;
      const y = plot.anchor.y;
      const f = building.style.footprint;
      const px = ox + (x - bounds.x0 + (1 - f) / 2) * s;
      const py = oy + (y - bounds.y0 + (1 - f) / 2) * s;
      ctx.fillStyle = building.cottage ? `rgb(${building.roofColor.join(",")})` : `rgb(${building.style.roofColor.join(",")})`;
      ctx.fillRect(px, py, f * s, f * s);
      ctx.strokeStyle = "rgba(255,255,255,0.7)";
      ctx.lineWidth = 1;
      ctx.strokeRect(px, py, f * s, f * s);
    }
    // scale bar: one tile is 20 m
    ctx.fillStyle = "#cfe8ff";
    ctx.fillRect(16, box.h - 22, s, 3);
    ctx.font = "11px system-ui";
    ctx.textAlign = "left";
    ctx.fillText("20 m", 16 + s + 6, box.h - 17);
    ctx.textAlign = "right";
    ctx.fillText("N ↑", box.w - 14, 20 + 34);
    if (building?.tower) {
      ctx.textAlign = "left";
      ctx.fillText(t.floors(top), 16, box.h - 34);
    }
  }, [box, bounds, building, plot, world, n, t]);
  return (
    <div ref={wrapRef} className="absolute inset-0">
      <canvas ref={ref} className="h-full w-full" style={{ width: box.w, height: box.h }} />
    </div>
  );
}

/** A small picture of one cottage design. */
function CottageThumb({ world, plot, design }: { world: World; plot: Plot; design: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = 2;
    c.width = 80 * dpr;
    c.height = 56 * dpr;
    const ctx = c.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, 80, 56);
    const b = designCottage(world, plot, design);
    const s = 2.1;
    ctx.save();
    ctx.translate(40, 40);
    ctx.scale(s, s);
    ctx.fillStyle = "rgba(90,150,90,0.55)";
    ctx.beginPath();
    ctx.moveTo(0, -8);
    ctx.lineTo(16, 0);
    ctx.lineTo(0, 8);
    ctx.lineTo(-16, 0);
    ctx.closePath();
    ctx.fill();
    drawCottage(ctx, 0, 0, b.cottage!, cottagePalette(b.cottage!, 1), 32, 16, 0);
    ctx.restore();
  }, [world, plot, design]);
  return <canvas ref={ref} className="h-14 w-full" style={{ width: "100%", height: 56 }} />;
}
