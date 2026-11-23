import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowLeft, Building2, Link2, Maximize2, MapPin, Search, X, ZoomIn, ZoomOut } from "lucide-react";
import { toast } from "sonner";
import { useLanguage } from "@/i18n/LanguageContext";
import { DEFAULT_WORLD, findPlotByAddress, generateWorld, type Kind, type Plot, type World } from "@/game/world/generator";
import { WorldRenderer } from "@/game/world/renderer";
import { worldLocale, worldStrings } from "@/game/world/strings";

/** One tile is 20 × 20 m in the game world. */
const TILE_M2 = 400;
const TILE_M = 20;
const TOWER_CONTRACT = "0x3720cde69e4e997bbdeaec7b4e7b5f8c3c406869";

type Selection = { kind: "plot"; plot: Plot } | { kind: "tower" } | { kind: "tile"; tile: Kind; district: number } | null;

const City = () => {
  const { language } = useLanguage();
  const t = worldStrings(language);
  const city = useMemo(() => generateWorld(DEFAULT_WORLD), []);
  const [params, setParams] = useSearchParams();

  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<WorldRenderer | null>(null);
  const [selection, setSelection] = useState<Selection>(null);
  const [query, setQuery] = useState("");

  // --- renderer lifecycle ---------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const r = new WorldRenderer(canvas, city, { tower: t.tower });
    rendererRef.current = r;
    const size = () => {
      const rect = wrap.getBoundingClientRect();
      r.resize(rect.width, rect.height, Math.min(window.devicePixelRatio || 1, 2));
    };
    size();
    r.fit();
    const ro = new ResizeObserver(size);
    ro.observe(wrap);
    let raf = 0;
    const loop = (time: number) => {
      r.draw(time);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    const clock = window.setInterval(() => r.refreshDaylight(), 5 * 60 * 1000);
    return () => {
      cancelAnimationFrame(raf);
      window.clearInterval(clock);
      ro.disconnect();
      rendererRef.current = null;
    };
    // labels only matter for the tower name; recreate on language change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [city, language]);

  const select = useCallback(
    (s: Selection, focus = false) => {
      setSelection(s);
      const r = rendererRef.current;
      if (!r) return;
      r.selectedPlot = s?.kind === "plot" ? s.plot.id : null;
      r.towerSelected = s?.kind === "tower";
      if (focus && s?.kind === "plot") r.focusTile(s.plot.anchor.x, s.plot.anchor.y, 1.4);
      if (focus && s?.kind === "tower") r.focusTile(city.center - 8, city.center - 8, 0.6);
      const next = new URLSearchParams(params);
      if (s?.kind === "plot") next.set("plot", String(s.plot.id));
      else next.delete("plot");
      setParams(next, { replace: true });
    },
    [city, params, setParams],
  );

  // deep link: /city?plot=123
  useEffect(() => {
    const id = Number(params.get("plot"));
    if (!params.get("plot") || !Number.isInteger(id) || selection) return;
    const plot = city.plots[id];
    if (plot) select({ kind: "plot", plot }, true);
    // run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- pointer input: drag, wheel, pinch, tap --------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const pointers = new Map<number, { x: number; y: number }>();
    let moved = 0;
    let pinchDist = 0;
    const local = (e: PointerEvent | WheelEvent) => {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };
    const down = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, local(e));
      moved = 0;
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      }
    };
    const move = (e: PointerEvent) => {
      const r = rendererRef.current;
      if (!r) return;
      const p = local(e);
      const prev = pointers.get(e.pointerId);
      if (!prev) {
        // hover (mouse only)
        const pick = r.pick(p.x, p.y);
        r.hoverPlot = pick?.kind === "plot" ? pick.plotId : null;
        canvas.style.cursor = pick?.kind === "plot" || pick?.kind === "tower" ? "pointer" : "grab";
        return;
      }
      if (pointers.size === 1) {
        r.pan(p.x - prev.x, p.y - prev.y);
        moved += Math.abs(p.x - prev.x) + Math.abs(p.y - prev.y);
      } else if (pointers.size === 2) {
        pointers.set(e.pointerId, p);
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinchDist > 0) r.zoomAt(d / pinchDist, (a.x + b.x) / 2, (a.y + b.y) / 2);
        pinchDist = d;
        moved += 10;
        return;
      }
      pointers.set(e.pointerId, p);
    };
    const up = (e: PointerEvent) => {
      const r = rendererRef.current;
      const p = local(e);
      const wasTap = pointers.size === 1 && moved < 6;
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinchDist = 0;
      if (!r || !wasTap) return;
      const pick = r.pick(p.x, p.y);
      if (pick?.kind === "plot") select({ kind: "plot", plot: city.plots[pick.plotId] });
      else if (pick?.kind === "tower") select({ kind: "tower" });
      else if (pick?.kind === "tile") select({ kind: "tile", tile: pick.tile, district: pick.district });
      else select(null);
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = rendererRef.current;
      if (!r) return;
      const p = local(e);
      r.zoomAt(Math.exp(-e.deltaY * 0.0015), p.x, p.y);
    };
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    canvas.addEventListener("wheel", wheel, { passive: false });
    return () => {
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", up);
      canvas.removeEventListener("wheel", wheel);
    };
  }, [city, select]);

  const zoom = (f: number) => {
    const r = rendererRef.current;
    const wrap = wrapRef.current;
    if (!r || !wrap) return;
    const rect = wrap.getBoundingClientRect();
    r.zoomAt(f, rect.width / 2, rect.height / 2);
  };

  const onSearch = (e: FormEvent) => {
    e.preventDefault();
    const plot = findPlotByAddress(city, query);
    if (!plot) {
      toast.error(t.notFound);
      return;
    }
    select({ kind: "plot", plot }, true);
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast.success(t.copied);
    } catch {
      /* clipboard may be blocked; the URL bar already has the link */
    }
  };

  const fmt = (n: number) => n.toLocaleString(worldLocale(language));

  return (
    <div className="fixed inset-0 flex flex-col bg-background text-foreground">
      {/* top bar */}
      <header className="z-20 flex flex-wrap items-center gap-2 border-b border-border/60 bg-background/85 px-3 py-2 backdrop-blur md:gap-3 md:px-4">
        <Link to="/" className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
          {t.back}
        </Link>
        <div className="flex items-center gap-2">
          <h1 className="font-display text-base font-bold md:text-lg">{t.title}</h1>
          <span className="rounded-full border border-primary/40 px-2 py-0.5 text-[11px] font-medium text-primary">{t.badge}</span>
        </div>
        <form onSubmit={onSearch} className="order-last flex w-full items-center gap-2 md:order-none md:ml-auto md:w-auto">
          <div className="relative flex-1 md:w-64">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t.searchPlaceholder}
              aria-label={t.searchPlaceholder}
              className="h-9 w-full rounded-md border border-input bg-background/60 pl-8 pr-2 text-sm outline-none focus:border-primary"
            />
          </div>
          <button type="submit" className="h-9 rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
            {t.searchGo}
          </button>
        </form>
      </header>

      {/* canvas */}
      <div ref={wrapRef} className="relative min-h-0 flex-1 touch-none select-none">
        <canvas ref={canvasRef} className="absolute inset-0 cursor-grab" />

        <div className="pointer-events-none absolute left-3 top-3 rounded-md bg-background/75 px-2.5 py-1.5 text-xs text-muted-foreground backdrop-blur">
          <div className="font-medium text-foreground">{t.stats(city.plots.length, city.districts.length, city.airports.length, city.stations.length)}</div>
          <div className="hidden md:block">{t.hint}</div>
        </div>

        <div className="absolute right-3 top-3 flex flex-col gap-1.5">
          {[
            { icon: ZoomIn, label: "+", on: () => zoom(1.4) },
            { icon: ZoomOut, label: "−", on: () => zoom(1 / 1.4) },
            { icon: Maximize2, label: "fit", on: () => rendererRef.current?.fit() },
            { icon: Building2, label: t.tower, on: () => select({ kind: "tower" }, true) },
          ].map(({ icon: Icon, label, on }) => (
            <button
              key={label}
              onClick={on}
              aria-label={label}
              title={label}
              className="flex h-9 w-9 items-center justify-center rounded-md border border-border bg-background/85 backdrop-blur hover:border-primary"
            >
              <Icon className="h-4 w-4" />
            </button>
          ))}
        </div>

        {/* selection card: bottom sheet on phones, side card on desktop */}
        {selection && (
          <aside className="absolute inset-x-2 bottom-2 z-10 max-h-[55%] overflow-auto rounded-xl border border-border bg-background/95 p-4 shadow-2xl backdrop-blur md:inset-x-auto md:bottom-auto md:right-16 md:top-3 md:w-80">
            <button onClick={() => select(null)} aria-label={t.close} className="absolute right-3 top-3 text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
            {selection.kind === "plot" ? (
              <PlotCard plot={selection.plot} world={city} t={t} fmt={fmt} onCopy={copyLink} />
            ) : selection.kind === "tile" ? (
              <div className="space-y-2 pr-6">
                <h2 className="font-display text-lg font-bold">{t.tiles[selection.tile]}</h2>
                {selection.district >= 0 && (
                  <p className="text-sm text-muted-foreground">
                    {city.districts[selection.district].name} · {t.biomes[city.districts[selection.district].biome]}
                  </p>
                )}
                <p className="text-xs text-muted-foreground">{t.wild}</p>
              </div>
            ) : (
              <div className="space-y-3 pr-6">
                <div className="flex items-center gap-2">
                  <Building2 className="h-5 w-5 text-primary" />
                  <h2 className="font-display text-lg font-bold">{t.tower}</h2>
                </div>
                <p className="text-sm text-muted-foreground">{t.towerAbout}</p>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm">
                  <dt className="text-muted-foreground">{t.floors}</dt>
                  <dd className="font-medium">108</dd>
                  <dt className="text-muted-foreground">{t.apartments}</dt>
                  <dd className="font-medium">{fmt(1200)}</dd>
                  <dt className="text-muted-foreground">{t.aiStatus}</dt>
                  <dd className="col-span-2 text-xs">{t.aiStatusValue}</dd>
                </dl>
                <a
                  href={`https://explorer.cronos.org/token/${TOWER_CONTRACT}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
                >
                  <Link2 className="h-4 w-4" />
                  {t.contract}
                </a>
              </div>
            )}
          </aside>
        )}
      </div>
    </div>
  );
};

function PlotCard({ plot, world, t, fmt, onCopy }: { plot: Plot; world: World; t: ReturnType<typeof worldStrings>; fmt: (n: number) => string; onCopy: () => void }) {
  const d = world.districts[plot.district];
  return (
    <div className="space-y-3 pr-6">
      <div className="flex items-center gap-2">
        <MapPin className="h-5 w-5 text-primary" />
        <h2 className="font-display text-lg font-bold">{plot.address}</h2>
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm">
        <dt className="text-muted-foreground">{t.district}</dt>
        <dd className="font-medium">{d?.name ?? "—"}</dd>
        <dt className="text-muted-foreground">{t.climate}</dt>
        <dd className="font-medium">{d ? t.biomes[d.biome] : "—"}</dd>
        <dt className="text-muted-foreground">{t.landscape}</dt>
        <dd className="font-medium">{t.landscapes[plot.landscape]}</dd>
        <dt className="text-muted-foreground">{t.area}</dt>
        <dd className="font-medium">
          {fmt(plot.tiles.length * TILE_M2)} {t.m2}
        </dd>
        <dt className="text-muted-foreground">{t.toTower}</dt>
        <dd className="font-medium">
          {fmt(Math.round((plot.distance * TILE_M) / 100) / 10)} {t.km}
        </dd>
        <dt className="text-muted-foreground">{t.water}</dt>
        <dd className="font-medium">{plot.waterView ? t.yes : t.no}</dd>
        <dt className="text-muted-foreground">{t.status}</dt>
        <dd className="font-medium text-emerald-500">{t.free}</dd>
      </dl>
      <p className="rounded-md bg-muted/60 p-2.5 text-xs text-muted-foreground">{t.buyLater}</p>
      <button onClick={onCopy} className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline">
        <Link2 className="h-4 w-4" />
        {t.copyLink}
      </button>
    </div>
  );
}

export default City;
