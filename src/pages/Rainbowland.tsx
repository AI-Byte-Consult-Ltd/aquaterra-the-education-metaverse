import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Anchor, Gem, Layers, Loader2, Minus, Plus, Rainbow, Maximize2, Search, Ship, Car, Mountain } from "lucide-react";
import { toast } from "sonner";
import { useLanguage } from "@/i18n/LanguageContext";
import { useAccount } from "@/game/account/AccountContext";
import { useEconomy } from "@/game/economy/EconomyContext";
import { Shell } from "@/game/state/ui";
import { Panel, btnMain, btnSoft, input } from "@/game/bank/ui";
import { fetchRainbowCell, fetchRainbowMap, type RainbowCell, type RainbowError, type RainbowMap } from "@/game/rainbowland/api";
import { COLS, RAINBOW_DISTRICT, TIERS, TIER_COLOR, landName, parseCell } from "@/game/rainbowland/grid";
import { loadTerrain, zoneAtCell, type Terrain } from "@/game/rainbowland/terrain";
import { IMG_H, IMG_W, PAD, drawBase, drawScene, toImage, tokenAtImage, cellAtImage, type View } from "@/game/rainbowland/render";
import { rainbowStrings } from "@/game/rainbowland/strings";
import { fetchNetwork, toRoutes, travel, type Location, type NetworkInfo } from "@/game/travel/api";
import { DEFAULT_FARES, planTrips, type Plan } from "@/game/travel/network";

const CAPITAL = 0;
const MAX_SCALE = 40;

/** /rainbowland: the continent of the old LAND NFTs, cell by cell at their own coordinates. */
const Rainbowland = () => {
  const { language } = useLanguage();
  const t = rainbowStrings(language);
  const { session, signOut } = useAccount();
  const economy = useEconomy();
  const [params, setParams] = useSearchParams();
  const [map, setMap] = useState<RainbowMap | null>(null);
  const [error, setError] = useState<RainbowError | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  /** The tapped map cell: a LAND token or, outside the minted rows, a cell with no token yet. */
  const [spot, setSpot] = useState<{ c: number; r: number } | null>(null);
  const [cellFailed, setCellFailed] = useState(false);
  const [cell, setCell] = useState<RainbowCell | null>(null);
  const [query, setQuery] = useState("");
  const [me, setMe] = useState<Location | null>(null);
  const [net, setNet] = useState<NetworkInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [terrain, setTerrain] = useState<Terrain | null>(null);
  const [terrainFailed, setTerrainFailed] = useState(false);

  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<View>({ scale: 1, ox: 0, oy: 0 });
  const baseRef = useRef<HTMLCanvasElement | null>(null);
  const sizeRef = useRef({ w: 0, h: 0 });

  const claimed = useMemo(() => new Set((map?.claimed ?? []).map((c) => c[0])), [map]);
  const mine = useMemo(() => new Set((map?.claimed ?? []).filter((c) => c[2]).map((c) => c[0])), [map]);

  useEffect(() => {
    let live = true;
    fetchRainbowMap(session).then((r) => {
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

  // the map of the continent (tiles and zones), loaded once
  useEffect(() => {
    let live = true;
    loadTerrain().then((tr) => {
      if (!live) return;
      if (tr) setTerrain(tr);
      else setTerrainFailed(true);
    });
    return () => {
      live = false;
    };
  }, []);

  // the continent image, rebuilt when the map arrives
  useEffect(() => {
    if (!map || !terrain) return;
    baseRef.current = drawBase(terrain, map.tiles, claimed, mine);
  }, [map, terrain, claimed, mine]);

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
    (tok: number, scale = 14, cell?: { c: number; r: number }) => {
      const { w, h } = sizeRef.current;
      const v = viewRef.current;
      v.scale = Math.max(v.scale, scale);
      v.ox = (cell ? cell.c : tok % COLS) + PAD + 0.5 - w / v.scale / 2;
      v.oy = (cell ? cell.r : Math.floor(tok / COLS)) + PAD + 0.5 - h / v.scale / 2;
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
        // start on the LAND rows of the north-west, where the bridge and the harbour are
        const v = viewRef.current;
        v.scale = Math.max(Math.min(w / IMG_W, h / IMG_H), Math.min(8, h / 100));
        v.ox = 0;
        v.oy = 0;
        first = false;
      }
      clampView();
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [clampView]);

  // draw loop
  const selectedRef = useRef<{ c: number; r: number } | null>(null);
  selectedRef.current = spot;
  useEffect(() => {
    let raf = 0;
    const tick = (time: number) => {
      const cv = canvasRef.current, base = baseRef.current;
      if (cv && base && map && terrain) {
        const ctx = cv.getContext("2d")!;
        const { w, h } = sizeRef.current;
        drawScene(ctx, w, h, base, viewRef.current, {
          terrain,
          claimed,
          tiles: map.tiles,
          selected: selectedRef.current,
          time,
          labels: { bridge: t.bridgeLabel, harbour: t.harbour, station: t.station, zones: terrain.zones },
        });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [map, terrain, claimed, t]);

  const select = useCallback(
    (tok: number | null) => {
      setSelected(tok);
      setCell(null);
      setCellFailed(false);
      if (tok == null) return;
      setSpot({ c: tok % COLS, r: Math.floor(tok / COLS) });
      fetchRainbowCell(tok, session).then((r) => (r.ok ? setCell(r.data.cell) : setCellFailed(true)));
    },
    [session],
  );

  // ?land=x,y or ?token=5601 opens that cell
  useEffect(() => {
    if (!map) return;
    const q = params.get("land") ?? params.get("token");
    if (!q) return;
    const tok = parseCell(q);
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
        const tok = tokenAtImage(q.x, q.y);
        select(tok);
        if (tok == null) setSpot(cellAtImage(q.x, q.y));
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
    const tok = parseCell(query);
    if (tok == null) {
      // a cell of the map with no token yet still opens its card
      const xy = query.match(/(-?\d+)\s*[, ]\s*(-?\d+)/);
      const c = xy ? Number(xy[1]) + 128 : -1, r = xy ? Number(xy[2]) + 128 : -1;
      if (c < 0 || r < 0 || c >= IMG_W || r >= IMG_H) {
        toast.error(t.notFound);
        return;
      }
      focus(0, 14, { c, r });
      select(null);
      setSpot({ c, r });
      return;
    }
    focus(tok);
    select(tok);
    setParams({ land: `${tok % COLS - 128},${Math.floor(tok / COLS) - 128}` }, { replace: true });
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

  const total = map?.total ?? 55_524;
  const tierRule = (tier: string) => map?.tiers.find((x) => x.tier === tier);
  const here = me?.districtId === RAINBOW_DISTRICT;
  const plans = useMemo(() => {
    if (!net || !me) return [];
    const fares = { ...DEFAULT_FARES, ...net.fares };
    return planTrips(toRoutes(net), me.districtId, here ? CAPITAL : RAINBOW_DISTRICT, fares).filter((p) => p.legs.length > 0);
  }, [net, me, here]);
  const harbour = net?.hubs.find((h) => h.kind === "port" && h.district !== RAINBOW_DISTRICT && net.routes.some((r) => r[0] === "ferry" && r[1] === h.district && r[2] === RAINBOW_DISTRICT));
  const zone = spot && terrain ? zoneAtCell(terrain, spot.c, spot.r) : null;
  const spotName = spot ? `LAND (${spot.c - 128}, ${spot.r - 128})` : null;

  return (
    <Shell title={t.title} icon={Rainbow} accent="text-fuchsia-300">
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

      <div ref={wrapRef} className="relative h-[52vh] min-h-[280px] w-full touch-none overflow-hidden rounded-2xl border border-border bg-[#12406e] md:h-[60vh]">
        <canvas ref={canvasRef} className="absolute inset-0 cursor-crosshair" />
        {(!map || !terrain) && (
          <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-white/80">
            {error ? t.errors[error] : terrainFailed ? t.errors.network : (<><Loader2 className="h-4 w-4 animate-spin" />{t.loading}</>)}
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
        <Panel title={selected != null ? landName(selected) : spotName ?? t.cell} icon={Layers}>
          {spot == null && <p className="text-sm text-muted-foreground">{t.hint}</p>}
          {selected == null && spot != null && (
            <div className="space-y-2 text-sm">
              <Row k={t.zone} v={zone?.name ?? t.openWater} />
              <p className="text-muted-foreground">{t.noToken}</p>
            </div>
          )}
          {selected != null && (
            <div className="space-y-2 text-sm">
              <p className="text-muted-foreground">{t.token(selected)}</p>
              <Row k={t.zone} v={zone?.name ?? t.openWater} />
              {!cell && !cellFailed && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
              {cellFailed && <p className="text-muted-foreground">{t.errors.network}</p>}
              {cell && (
                <>
                  <Row k={t.rarity} v={cell.rarity || t.rarityUnknown} />
                  <Row k={t.tier} v={<TierChip tier={cell.tier} label={t.tierNames[cell.tier]} />} />
                  <p>{t.plotSize(cell.tiles)} · {t.plotValue(cell.price)}</p>
                  <p className="text-muted-foreground">{t.subsoil(cell.subsoilPct)}</p>
                  {cell.claimed ? (
                    <p className="font-medium text-emerald-300">{cell.mine ? t.mine : t.owned(cell.owner ?? "")}</p>
                  ) : (
                    <>
                      <p className="text-muted-foreground">{t.mist}</p>
                      <p className="text-xs text-muted-foreground">{t.swapNote(map?.swapFee ?? null)}</p>
                      <Link to={`/heritage?token=${selected}`} className={`${btnMain} w-full`}>
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
          <p className="text-sm text-muted-foreground">{t.getThereNote(harbour?.name ?? null)}</p>
          {!session && (
            <Link to="/login" className={`${btnSoft} w-full`}>{t.signIn}</Link>
          )}
          {session && me && <p className="text-sm font-medium text-emerald-300">{here ? t.inRainbowland : t.youAreIn(me.district ?? "")}</p>}
          {session && plans.length === 0 && net && me && <p className="text-xs text-muted-foreground">{t.noRoute}</p>}
          {session && plans.map((p, i) => (
            <button key={i} className={`${i === 0 ? btnMain : btnSoft} w-full justify-between`} disabled={busy} onClick={() => go(p, here)}>
              <span className="flex items-center gap-1.5">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : p.legs.some((l) => l.mode === "ferry") ? <Ship className="h-4 w-4" /> : <Car className="h-4 w-4" />}
                {p.legs.map((l) => (l.mode !== "ferry" && (l.to === RAINBOW_DISTRICT || l.from === RAINBOW_DISTRICT) ? t.overBridge(t.modes[l.mode]) : t.modes[l.mode])).join(" → ")}
              </span>
              <span className="tabular-nums">{t.fare(p.fare)}</span>
            </button>
          ))}
        </Panel>

        <Panel title={t.tiers} icon={Gem}>
          <ul className="space-y-1.5 text-sm">
            {TIERS.map((tier) => {
              const r = tierRule(tier);
              return (
                <li key={tier} className="flex items-center justify-between gap-2">
                  <TierChip tier={tier} label={t.tierNames[tier]} />
                  <span className="text-xs text-muted-foreground">{r ? t.tierLine(r.tiles, r.price, r.subsoilPct) : ""}</span>
                </li>
              );
            })}
          </ul>
          <p className="text-xs text-muted-foreground">{t.tierNote}</p>
        </Panel>

        <Panel title={t.zones} icon={Rainbow}>
          <ul className="grid grid-cols-2 gap-1.5 text-sm">
            {(terrain?.zones ?? []).map((z) => (
              <li key={z.name}>
                <button className="flex items-center gap-2 text-left hover:underline" onClick={() => focus(0, 3, z)}>
                  <span className="h-3 w-3 shrink-0 rounded-sm" style={{ background: `rgb(${z.color.join(",")})` }} />
                  {z.name}
                </button>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">{t.zonesNote}</p>
          <Link to="/prism-hills" className={`${btnSoft} w-full`}>
            <Mountain className="h-4 w-4" />
            {t.toPrism}
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

const TierChip = ({ tier, label }: { tier: (typeof TIERS)[number]; label: string }) => (
  <span className="inline-flex items-center gap-1.5">
    <span className="h-3 w-3 rounded-full" style={{ background: `rgb(${TIER_COLOR[tier].join(",")})`, boxShadow: tier === "cyber" ? "0 0 8px rgb(255,46,214)" : undefined }} />
    {label}
  </span>
);

export default Rainbowland;
