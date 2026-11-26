import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Anchor, Gem, Layers, Loader2, Minus, Plus, Mountain, Maximize2, Search, Ship, Car, Rainbow } from "lucide-react";
import { toast } from "sonner";
import { useLanguage } from "@/i18n/LanguageContext";
import { useAccount } from "@/game/account/AccountContext";
import { useEconomy } from "@/game/economy/EconomyContext";
import { Shell } from "@/game/state/ui";
import { Panel, btnMain, btnSoft, input } from "@/game/bank/ui";
import { fetchPrismCell, fetchPrismMap, type PrismCell, type PrismMap, type RainbowError } from "@/game/rainbowland/api";
import { PRISM_DISTRICT, PRISM_PRICE_PER_CELL, PRISM_TOTAL, parcelName, parsePrism, prismX, prismY } from "@/game/rainbowland/prism";
import { toImage, type View } from "@/game/rainbowland/render";
import { PIMG_H as IMG_H, PIMG_W as IMG_W, PPAD as PAD, BAY_ROW, SIZE_COLOR, drawPrismBase, drawPrismScene, prismAtImage } from "@/game/rainbowland/prismRender";
import { prismStrings } from "@/game/rainbowland/strings";
import { fetchNetwork, toRoutes, travel, type Location, type NetworkInfo } from "@/game/travel/api";
import { DEFAULT_FARES, planTrips, type Plan } from "@/game/travel/network";

const CAPITAL = 0;
const MAX_SCALE = 40;

/** /prism-hills: the continent of the LAND NFTs on Polygon, beside Rainbowland. */
const PrismHills = () => {
  const { language } = useLanguage();
  const t = prismStrings(language);
  const { session, signOut } = useAccount();
  const economy = useEconomy();
  const [params, setParams] = useSearchParams();
  const [map, setMap] = useState<PrismMap | null>(null);
  const [error, setError] = useState<RainbowError | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [cell, setCell] = useState<PrismCell | null>(null);
  const [query, setQuery] = useState("");
  const [me, setMe] = useState<Location | null>(null);
  const [net, setNet] = useState<NetworkInfo | null>(null);
  const [busy, setBusy] = useState(false);

  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<View>({ scale: 1, ox: 0, oy: 0 });
  const baseRef = useRef<HTMLCanvasElement | null>(null);
  const sizeRef = useRef({ w: 0, h: 0 });

  const claimed = useMemo(() => new Set((map?.claimed ?? []).map((c) => c[0])), [map]);
  const mine = useMemo(() => new Set((map?.claimed ?? []).filter((c) => c[2]).map((c) => c[0])), [map]);

  useEffect(() => {
    let live = true;
    fetchPrismMap(session).then((r) => {
      if (!live) return;
      if (r.ok) setMap(r.data);
      else setError(r.error);
    });
    return () => {
      live = false;
    };
  }, [session]);

  const loadNet = useCallback(() => {
    fetchNetwork(session).then((r) => {
      if (!r.ok) return;
      setNet(r.data);
      if (r.data.me) setMe(r.data.me);
    });
  }, [session]);
  useEffect(loadNet, [loadNet]);

  // the continent image, rebuilt when the map arrives
  useEffect(() => {
    if (!map) return;
    baseRef.current = drawPrismBase(claimed, mine);
  }, [map, claimed, mine]);

  const clampView = useCallback(() => {
    const v = viewRef.current;
    const { w, h } = sizeRef.current;
    const vw = w / v.scale, vh = h / v.scale;
    v.ox = vw >= IMG_W ? (IMG_W - vw) / 2 : Math.min(Math.max(v.ox, 0), IMG_W - vw);
    v.oy = vh >= IMG_H ? (IMG_H - vh) / 2 : Math.min(Math.max(v.oy, 0), IMG_H - vh);
  }, []);
  const fit = useCallback(() => {
    const { w, h } = sizeRef.current;
    const v = viewRef.current;
    v.scale = Math.min(w / IMG_W, h / IMG_H);
    v.ox = 0;
    v.oy = 0;
    clampView();
  }, [clampView]);
  const focus = useCallback(
    (tok: number, scale = 14) => {
      const { w, h } = sizeRef.current;
      const v = viewRef.current;
      v.scale = Math.max(v.scale, scale);
      v.ox = prismX(tok) + PAD + 0.5 - w / v.scale / 2;
      v.oy = prismY(tok) + PAD + 0.5 - h / v.scale / 2;
      clampView();
    },
    [clampView],
  );
  const zoom = useCallback(
    (k: number, sx?: number, sy?: number) => {
      const v = viewRef.current;
      const { w, h } = sizeRef.current;
      const cx = sx ?? w / 2, cy = sy ?? h / 2;
      const p = toImage(v, cx, cy);
      const minScale = Math.min(w / IMG_W, h / IMG_H);
      v.scale = Math.min(MAX_SCALE, Math.max(minScale, v.scale * k));
      v.ox = p.x - cx / v.scale;
      v.oy = p.y - cy / v.scale;
      clampView();
    },
    [clampView],
  );

  // canvas size follows its box
  useEffect(() => {
    const wrap = wrapRef.current, cv = canvasRef.current;
    if (!wrap || !cv) return;
    let first = true;
    const ro = new ResizeObserver(() => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = wrap.clientWidth, h = wrap.clientHeight;
      sizeRef.current = { w, h };
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
      cv.style.width = `${w}px`;
      cv.style.height = `${h}px`;
      cv.getContext("2d")?.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (first) {
        // start on the western coast, at the harbour bay
        const v = viewRef.current;
        v.scale = Math.max(Math.min(w / IMG_W, h / IMG_H), 3);
        v.ox = 0;
        v.oy = BAY_ROW + PAD - h / v.scale / 2;
        first = false;
      }
      clampView();
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [clampView]);

  // draw loop
  const selectedRef = useRef<number | null>(null);
  selectedRef.current = selected;
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const cv = canvasRef.current, base = baseRef.current;
      if (cv && base && map) {
        const ctx = cv.getContext("2d")!;
        const { w, h } = sizeRef.current;
        drawPrismScene(ctx, w, h, base, viewRef.current, {
          selected: selectedRef.current,
          labels: { harbour: t.harbour, station: t.station, causeway: t.causeway },
        });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [map, claimed, t]);

  const select = useCallback(
    (tok: number | null) => {
      setSelected(tok);
      setCell(null);
      if (tok == null) return;
      fetchPrismCell(tok, session).then((r) => r.ok && setCell(r.data.cell));
    },
    [session],
  );

  // ?parcel=x,y or ?token=5601 opens that cell
  useEffect(() => {
    if (!map) return;
    const q = params.get("parcel") ?? params.get("token");
    if (!q) return;
    const tok = parsePrism(q);
    if (tok != null) {
      focus(tok);
      select(tok);
    }
  }, [map]); // eslint-disable-line react-hooks/exhaustive-deps

  // pointer: drag to pan, pinch to zoom, tap to pick
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const pts = new Map<number, { x: number; y: number }>();
    let moved = 0;
    let pinch = 0;
    const local = (e: PointerEvent) => {
      const r = cv.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const down = (e: PointerEvent) => {
      cv.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, local(e));
      moved = 0;
      if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        pinch = Math.hypot(a.x - b.x, a.y - b.y);
      }
    };
    const move = (e: PointerEvent) => {
      const prev = pts.get(e.pointerId);
      if (!prev) return;
      const p = local(e);
      const v = viewRef.current;
      if (pts.size === 1) {
        v.ox -= (p.x - prev.x) / v.scale;
        v.oy -= (p.y - prev.y) / v.scale;
        moved += Math.abs(p.x - prev.x) + Math.abs(p.y - prev.y);
        clampView();
      }
      pts.set(e.pointerId, p);
      if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch > 0) zoom(d / pinch, (a.x + b.x) / 2, (a.y + b.y) / 2);
        pinch = d;
        moved += 10;
      }
    };
    const up = (e: PointerEvent) => {
      const p = pts.get(e.pointerId);
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch = 0;
      if (p && moved < 6 && pts.size === 0) {
        const q = toImage(viewRef.current, p.x, p.y);
        select(prismAtImage(q.x, q.y));
      }
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = cv.getBoundingClientRect();
      zoom(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
    };
    cv.addEventListener("pointerdown", down);
    cv.addEventListener("pointermove", move);
    cv.addEventListener("pointerup", up);
    cv.addEventListener("pointercancel", up);
    cv.addEventListener("wheel", wheel, { passive: false });
    return () => {
      cv.removeEventListener("pointerdown", down);
      cv.removeEventListener("pointermove", move);
      cv.removeEventListener("pointerup", up);
      cv.removeEventListener("pointercancel", up);
      cv.removeEventListener("wheel", wheel);
    };
  }, [clampView, zoom, select]);

  const find = (e: React.FormEvent) => {
    e.preventDefault();
    const tok = parsePrism(query);
    if (tok == null) {
      toast.error(t.notFound);
      return;
    }
    focus(tok);
    select(tok);
    setParams({ parcel: `${prismX(tok)},${prismY(tok)}` }, { replace: true });
  };

  const go = async (plan: Plan, home: boolean) => {
    if (!session || busy) return;
    setBusy(true);
    const r = await travel(session, plan.legs.map((l) => ({ mode: l.mode, to: l.to })));
    setBusy(false);
    if (!r.ok) {
      if (r.error === "session") signOut();
      else toast.error(r.error === "insufficient" ? t.noFare : t.errors.network);
      return;
    }
    setMe(r.data.me);
    toast.success(home ? t.backHome(r.data.fare) : t.arrived(r.data.fare));
    void economy.refresh();
    loadNet();
  };

  const total = map?.total ?? PRISM_TOTAL;
  const price = map?.pricePerCell ?? PRISM_PRICE_PER_CELL;
  const here = me?.districtId === PRISM_DISTRICT;
  const plans = useMemo(() => {
    if (!net || !me) return [];
    const fares = { ...DEFAULT_FARES, ...net.fares };
    return planTrips(toRoutes(net), me.districtId, here ? CAPITAL : PRISM_DISTRICT, fares).filter((p) => p.legs.length > 0);
  }, [net, me, here]);

  return (
    <Shell title={t.title} icon={Mountain} accent="text-emerald-300">
      <p className="mb-4 max-w-2xl text-sm text-muted-foreground">{t.intro}</p>
      <div className="mb-4 grid grid-cols-3 gap-2">
        {t.stats(map?.claimed.length ?? 0, total).map((s) => (
          <div key={s.k} className="rounded-xl border border-border bg-card/80 p-3">
            <div className="font-display text-lg font-bold tabular-nums md:text-xl">{map ? s.v : "…"}</div>
            <div className="text-xs text-muted-foreground">{s.k}</div>
          </div>
        ))}
      </div>

      <form onSubmit={find} className="mb-3 flex gap-2">
        <input className={input} value={query} onChange={(e) => setQuery(e.target.value.slice(0, 24))} placeholder={t.search} />
        <button className={btnSoft} aria-label={t.find}>
          <Search className="h-4 w-4" />
          <span className="hidden sm:inline">{t.find}</span>
        </button>
      </form>

      <div ref={wrapRef} className="relative h-[52vh] min-h-[280px] w-full touch-none overflow-hidden rounded-2xl border border-border bg-[#14466f] md:h-[60vh]">
        <canvas ref={canvasRef} className="absolute inset-0 cursor-crosshair" />
        {!map && (
          <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-white/80">
            {error ? t.errors[error] : (<><Loader2 className="h-4 w-4 animate-spin" />{t.loading}</>)}
          </div>
        )}
        <div className="absolute right-2 top-2 flex flex-col gap-1">
          <button className="rounded-md bg-black/55 p-2 text-white" onClick={() => zoom(1.6)} aria-label={t.zoomIn}><Plus className="h-4 w-4" /></button>
          <button className="rounded-md bg-black/55 p-2 text-white" onClick={() => zoom(1 / 1.6)} aria-label={t.zoomOut}><Minus className="h-4 w-4" /></button>
          <button className="rounded-md bg-black/55 p-2 text-white" onClick={fit} aria-label={t.fit}><Maximize2 className="h-4 w-4" /></button>
        </div>
        <p className="pointer-events-none absolute bottom-2 left-2 rounded bg-black/45 px-2 py-1 text-[11px] text-white/85">{t.hint}</p>
      </div>

      <div className="mt-5 grid gap-5 md:grid-cols-2">
        <Panel title={selected != null ? parcelName(selected) : t.cell} icon={Layers}>
          {selected == null && <p className="text-sm text-muted-foreground">{t.hint}</p>}
          {selected != null && (
            <div className="space-y-2 text-sm">
              <p className="text-muted-foreground">{t.token(selected)}</p>
              {!cell && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
              {cell && (
                <>
                  <p>{t.plotSize(cell.tiles)} · {t.plotValue(cell.price)}</p>
                  {cell.claimed ? (
                    <p className="font-medium text-emerald-300">{cell.mine ? t.mine : t.owned(cell.owner ?? "")}</p>
                  ) : (
                    <>
                      <p className="text-muted-foreground">{t.mist}</p>
                      <p className="text-xs text-muted-foreground">{t.swapNote(map?.swapFee ?? null)}</p>
                      <Link to={`/heritage?token=${selected}&land=prism`} className={`${btnMain} w-full`}>
                        <Anchor className="h-4 w-4" />
                        {t.swap}
                      </Link>
                    </>
                  )}
                </>
              )}
            </div>
          )}
        </Panel>

        <Panel title={t.getThere} icon={Ship}>
          <p className="text-sm text-muted-foreground">{t.getThereNote}</p>
          {!session && (
            <Link to="/login" className={`${btnSoft} w-full`}>{t.signIn}</Link>
          )}
          {session && me && <p className="text-sm font-medium text-emerald-300">{here ? t.inPrism : t.youAreIn(me.district ?? "")}</p>}
          {session && plans.length === 0 && net && me && <p className="text-xs text-muted-foreground">{t.noRoute}</p>}
          {session && plans.map((p, i) => (
            <button key={i} className={`${i === 0 ? btnMain : btnSoft} w-full justify-between`} disabled={busy} onClick={() => go(p, here)}>
              <span className="flex items-center gap-1.5">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : p.legs.some((l) => l.mode === "ferry") ? <Ship className="h-4 w-4" /> : <Car className="h-4 w-4" />}
                {p.legs.map((l) => t.modes[l.mode]).join(" → ")}
              </span>
              <span className="tabular-nums">{t.fare(p.fare)}</span>
            </button>
          ))}
        </Panel>

        <Panel title={t.sizes} icon={Gem}>
          <ul className="space-y-1.5 text-sm">
            {([1, 2, 3] as const).map((k) => (
              <li key={k} className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-3 w-3 rounded-full" style={{ background: `rgb(${SIZE_COLOR[k].join(",")})` }} />
                  {t.plotSize(k)}
                </span>
                <span className="text-xs text-muted-foreground">{t.sizeLine(k, k * price)}</span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">{t.sizeNote}</p>
          <Link to="/rainbowland" className={`${btnSoft} w-full`}>
            <Rainbow className="h-4 w-4" />
            {t.toRainbowland}
          </Link>
        </Panel>
      </div>
    </Shell>
  );
};

const Row = ({ k, v }: { k: string; v: React.ReactNode }) => (
  <div className="flex items-center justify-between gap-3">
    <span className="text-muted-foreground">{k}</span>
    <span className="text-right font-medium">{v}</span>
  </div>
);

export default PrismHills;
