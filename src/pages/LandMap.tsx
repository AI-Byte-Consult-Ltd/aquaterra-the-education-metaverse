import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  Home, Store, Building2, GraduationCap, Droplets, Landmark, ZoomIn, ZoomOut, Maximize2, ArrowLeft,
  X, Car, Wrench, Anchor, Coins, Footprints, Waves,
} from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useLanguage } from "@/i18n/LanguageContext";
import {
  CONTINENTS, PARCELS, WORLD_BOUNDS, WORLD_FACTS, districtOf, continentOf, parcelAtWorld, officialCoord,
  type Parcel, type ParcelType, type ParcelAsset,
} from "@/data/landMap";
import { loadTileMap, unpackTile, isEmptyTile, type LoadedTileMap } from "@/data/tileMap";

const CELL = 22;
const GAP = 2;
const MIN_SCALE = 0.02;
const MAX_SCALE = 6;
const TAP_THRESHOLD = 6;

type Selected = { kind: "parcel"; parcel: Parcel } | { kind: "ocean"; wx: number; wy: number } | null;

const ASSET_ICON: Record<ParcelAsset["icon"], typeof Home> = {
  house: Home,
  vehicle: Car,
  workshop: Wrench,
  dock: Anchor,
};

const TYPE_COLOR: Record<ParcelType, string> = {
  residential: "hsl(var(--primary))",
  commercial: "hsl(var(--secondary))",
  tower: "hsl(250 78% 72%)",
  education: "#E8B455",
  resource: "#4FB3D9",
  landmark: "hsl(var(--muted-foreground))",
};

const TYPE_ICON: Record<ParcelType, typeof Home> = {
  residential: Home,
  commercial: Store,
  tower: Building2,
  education: GraduationCap,
  resource: Droplets,
  landmark: Landmark,
};

const STR = {
  en: {
    back: "Back to Aquaterra",
    eyebrow: "Aquaterra World · v1",
    title: "Land Map",
    subtitle: "A first-generation parcel grid across Aquaterra's continents — a fresh coordinate system, built from scratch, not tied to any legacy contract.",
    statTotal: "Parcels mapped",
    statAvailable: "Available",
    statReserved: "Reserved",
    statContinents: "Continents",
    filterAll: "All",
    legendTitle: "Legend",
    typeLabel: { residential: "Residential", commercial: "Commercial", tower: "Tower", education: "Education", resource: "Resource", landmark: "Landmark" },
    statusLabel: { available: "Available", reserved: "Reserved" },
    fieldId: "Parcel",
    fieldCoords: "Coordinates",
    fieldDistrict: "District",
    fieldContinent: "Continent",
    fieldType: "Type",
    fieldStatus: "Status",
    fieldSize: "Size",
    fieldWaterfront: "Waterfront",
    fieldApartments: "Apartments inside",
    fieldResource: "Resource",
    fieldOwner: "Owner",
    ownerUnclaimed: "Unclaimed",
    fieldAssets: "Assets",
    noAssets: "No assets yet — empty lot",
    fieldReward: "Daily reward",
    perDay: "RAVERSE/day",
    fieldToll: "Toll to cross",
    tollFree: "Free to cross",
    close: "Close",
    oceanTitle: "Open ocean",
    oceanBody: "No parcel here yet — unclaimed open water, free to cross. Part of the vast unexplored grid.",
    yes: "Yes",
    no: "No",
    zoomIn: "Zoom in",
    zoomOut: "Zoom out",
    reset: "Fit to screen",
    dragHint: "Drag to pan, scroll or pinch to zoom, tap any square — anywhere in the 640×640 world",
    officialFacts: (f: typeof WORLD_FACTS) =>
      `Officially: ${f.totalLands.toLocaleString("en-US")} LANDs on a ${f.gridSize}x${f.gridSize} grid (coords ${f.coordMin}..${f.coordMax}), ~${f.mintedLands.toLocaleString("en-US")} minted, priced in $${f.token} (${f.tokenSupply} supply, ${f.chain}).`,
    disclaimer: "Concept map, v1 — the grid now spans the full official 640×640 extent. Ownership, assets and rewards shown here are illustrative simulations, not yet read from the real contracts or marketplace.",
  },
  ru: {
    back: "Назад на Aquaterra",
    eyebrow: "Мир Aquaterra · v1",
    title: "Карта земельных участков",
    subtitle: "Сетка участков первого поколения по континентам Aquaterra — новая система координат, построена с нуля, без привязки к старым контрактам.",
    statTotal: "Участков на карте",
    statAvailable: "Свободно",
    statReserved: "Зарезервировано",
    statContinents: "Континентов",
    filterAll: "Все",
    legendTitle: "Легенда",
    typeLabel: { residential: "Жильё", commercial: "Коммерция", tower: "Небоскрёб", education: "Образование", resource: "Ресурс", landmark: "Достопримечательность" },
    statusLabel: { available: "Свободно", reserved: "Зарезервировано" },
    fieldId: "Участок",
    fieldCoords: "Координаты",
    fieldDistrict: "Район",
    fieldContinent: "Континент",
    fieldType: "Тип",
    fieldStatus: "Статус",
    fieldSize: "Площадь",
    fieldWaterfront: "У воды",
    fieldApartments: "Апартаментов внутри",
    fieldResource: "Ресурс",
    fieldOwner: "Владелец",
    ownerUnclaimed: "Не занят",
    fieldAssets: "Активы",
    noAssets: "Активов пока нет — пустой участок",
    fieldReward: "Доход в день",
    perDay: "RAVERSE/день",
    fieldToll: "Плата за проход",
    tollFree: "Проход бесплатный",
    close: "Закрыть",
    oceanTitle: "Открытый океан",
    oceanBody: "Участка здесь пока нет — свободные воды, проход бесплатный. Часть необжитой территории сетки.",
    yes: "Да",
    no: "Нет",
    zoomIn: "Приблизить",
    zoomOut: "Отдалить",
    reset: "Показать всё",
    dragHint: "Тяните для перемещения, крутите колесо для масштаба, нажмите на любую клетку — в любой точке мира 640×640",
    officialFacts: (f: typeof WORLD_FACTS) =>
      `Официально: ${f.totalLands.toLocaleString("ru-RU")} участков на сетке ${f.gridSize}x${f.gridSize} (координаты ${f.coordMin}..${f.coordMax}), ~${f.mintedLands.toLocaleString("ru-RU")} уже сминтовано, цены в $${f.token} (${f.tokenSupply}, ${f.chain}).`,
    disclaimer: "Концептуальная карта, версия 1 — сетка теперь охватывает весь официальный размер 640×640. Владение, активы и доход здесь — иллюстративная симуляция, данные пока не читаются из реальных контрактов или маркетплейса.",
  },
} as const;

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

const LandMap = () => {
  const { language } = useLanguage();
  const t = STR[language === "ru" ? "ru" : "en"];
  const lang = language === "ru" ? "ru" : "en";

  const [continentFilter, setContinentFilter] = useState<string>("all");
  const [selected, setSelected] = useState<Selected>(null);
  const [view, setView] = useState({ scale: 1, x: 20, y: 20 });
  const [tileMap, setTileMap] = useState<LoadedTileMap | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef({ active: false, lastX: 0, lastY: 0, downX: 0, downY: 0, moved: false });

  useEffect(() => {
    let cancelled = false;
    loadTileMap()
      .then((tm) => { if (!cancelled) setTileMap(tm); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const worldW = WORLD_BOUNDS.maxX * CELL;
  const worldH = WORLD_BOUNDS.maxY * CELL;

  const fitToScreen = useCallback(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const pad = 24;
    const scale = clamp(Math.min((wrap.clientWidth - pad * 2) / worldW, (wrap.clientHeight - pad * 2) / worldH), MIN_SCALE, MAX_SCALE);
    setView({
      scale,
      x: (wrap.clientWidth - worldW * scale) / 2,
      y: (wrap.clientHeight - worldH * scale) / 2,
    });
  }, [worldW, worldH]);

  useEffect(() => {
    fitToScreen();
    window.addEventListener("resize", fitToScreen);
    return () => window.removeEventListener("resize", fitToScreen);
  }, [fitToScreen]);

  const zoomBy = useCallback((factor: number, anchor?: { x: number; y: number }) => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const ax = anchor?.x ?? wrap.clientWidth / 2;
    const ay = anchor?.y ?? wrap.clientHeight / 2;
    setView((v) => {
      const newScale = clamp(v.scale * factor, MIN_SCALE, MAX_SCALE);
      const wx = (ax - v.x) / v.scale;
      const wy = (ay - v.y) / v.scale;
      return { scale: newScale, x: ax - wx * newScale, y: ay - wy * newScale };
    });
  }, []);

  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const rect = wrapRef.current?.getBoundingClientRect();
      const anchor = rect ? { x: e.clientX - rect.left, y: e.clientY - rect.top } : undefined;
      zoomBy(1 - e.deltaY * 0.0015, anchor);
    },
    [zoomBy],
  );

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    dragRef.current = { active: true, lastX: e.clientX, lastY: e.clientY, downX: e.clientX, downY: e.clientY, moved: false };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current.active) return;
    const dx = e.clientX - dragRef.current.lastX;
    const dy = e.clientY - dragRef.current.lastY;
    dragRef.current.lastX = e.clientX;
    dragRef.current.lastY = e.clientY;
    if (Math.hypot(e.clientX - dragRef.current.downX, e.clientY - dragRef.current.downY) > TAP_THRESHOLD) {
      dragRef.current.moved = true;
    }
    setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
  }, []);

  // Every one of the 640x640 cells is selectable -- land or open ocean --
  // so selection is computed from tap position + current view transform
  // rather than depending on a rendered <rect> existing under the pointer.
  const selectAt = useCallback(
    (clientX: number, clientY: number) => {
      const rect = wrapRef.current?.getBoundingClientRect();
      if (!rect) return;
      const worldX = (clientX - rect.left - view.x) / view.scale;
      const worldY = (clientY - rect.top - view.y) / view.scale;
      const gx = Math.floor(worldX / CELL);
      const gy = Math.floor(worldY / CELL);
      if (gx < 0 || gy < 0 || gx >= WORLD_BOUNDS.maxX || gy >= WORLD_BOUNDS.maxY) return;
      const parcel = parcelAtWorld(gx, gy);
      setSelected(parcel ? { kind: "parcel", parcel } : { kind: "ocean", wx: gx, wy: gy });
    },
    [view],
  );

  const onClick = useCallback(
    (e: React.MouseEvent) => {
      if (dragRef.current.moved) return;
      selectAt(e.clientX, e.clientY);
    },
    [selectAt],
  );

  const onPointerLeave = useCallback(() => {
    dragRef.current.active = false;
  }, []);

  const stats = useMemo(() => {
    const total = PARCELS.length;
    const available = PARCELS.filter((p) => p.status === "available").length;
    const reserved = total - available;
    return { total, available, reserved, continents: CONTINENTS.length };
  }, []);

  // Renders the real Tiled-derived world art (once loaded) or a placeholder
  // grid while waiting for the tileset PNG, plus the continent-filter dim
  // overlay and the selection outline -- all in world-pixel coordinates
  // (1 tile = CELL px at scale 1), matching how the old SVG was transformed.
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const dpr = window.devicePixelRatio || 1;
    const cw = wrap.clientWidth;
    const ch = wrap.clientHeight;
    const pxW = Math.round(cw * dpr);
    const pxH = Math.round(ch * dpr);
    if (canvas.width !== pxW || canvas.height !== pxH) {
      canvas.width = pxW;
      canvas.height = pxH;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = false;
    ctx.setTransform(view.scale * dpr, 0, 0, view.scale * dpr, view.x * dpr, view.y * dpr);

    const x0 = clamp(Math.floor(-view.x / view.scale / CELL) - 1, 0, WORLD_BOUNDS.maxX);
    const y0 = clamp(Math.floor(-view.y / view.scale / CELL) - 1, 0, WORLD_BOUNDS.maxY);
    const x1 = clamp(Math.ceil((cw - view.x) / view.scale / CELL) + 1, 0, WORLD_BOUNDS.maxX);
    const y1 = clamp(Math.ceil((ch - view.y) / view.scale / CELL) + 1, 0, WORLD_BOUNDS.maxY);

    // Zoomed out enough that individual tiles would be sub-pixel, drawing all
    // of them (up to 409,600) tanks frame rate during pan/zoom -- and the
    // fully-zoomed-out view is the *default* state on load. Past this
    // threshold, draw the pre-averaged overview bitmap (one drawImage call)
    // instead of point-sampling individual tiles, which aliases badly on
    // this art's tight repeating patterns (fences, crop rows -> stripes).
    const pxPerTile = CELL * view.scale;
    const DETAIL_THRESHOLD_PX = 6;
    const useOverview = pxPerTile < DETAIL_THRESHOLD_PX && !!tileMap?.overview;

    if (!tileMap?.image) {
      // Placeholder while the real tileset PNG isn't in public/tiles/ yet.
      ctx.fillStyle = "hsl(240 40% 12%)";
      ctx.fillRect(x0 * CELL, y0 * CELL, (x1 - x0) * CELL, (y1 - y0) * CELL);
    }

    if (useOverview && tileMap?.overview) {
      const { width: gridW, height: gridH } = tileMap.manifest.grid;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(tileMap.overview, 0, 0, gridW, gridH, 0, 0, gridW * CELL, gridH * CELL);
      ctx.imageSmoothingEnabled = false;
    } else if (tileMap?.image) {
      const { image, manifest, grid } = tileMap;
      const { tileWidth, tileHeight, spacing, columns } = manifest.tileset;
      const gridW = manifest.grid.width;
      for (let ty = y0; ty < y1; ty++) {
        const row = ty * gridW;
        for (let tx = x0; tx < x1; tx++) {
          const packed = grid[row + tx];
          if (isEmptyTile(packed)) continue;
          const { localId, flipH, flipV, flipD } = unpackTile(packed);
          const col = localId % columns;
          const trow = Math.floor(localId / columns);
          const sx = col * (tileWidth + spacing);
          const sy = trow * (tileHeight + spacing);
          const dx = tx * CELL;
          const dy = ty * CELL;
          if (flipH || flipV || flipD) {
            ctx.save();
            ctx.translate(dx + CELL / 2, dy + CELL / 2);
            if (flipD) ctx.transform(0, 1, 1, 0, 0, 0);
            ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
            ctx.drawImage(image, sx, sy, tileWidth, tileHeight, -CELL / 2, -CELL / 2, CELL, CELL);
            ctx.restore();
          } else {
            ctx.drawImage(image, sx, sy, tileWidth, tileHeight, dx, dy, CELL, CELL);
          }
        }
      }
    } else {
      // Full-detail placeholder grid lines (Sandbox-style), only worth
      // drawing once zoomed in enough for individual cells to matter.
      if (pxPerTile >= DETAIL_THRESHOLD_PX) {
        ctx.strokeStyle = "hsl(222 30% 20%)";
        ctx.lineWidth = Math.max(0.5, 0.75 / view.scale);
        for (let ty = y0; ty < y1; ty++) {
          for (let tx = x0; tx < x1; tx++) {
            ctx.strokeRect(tx * CELL + GAP / 2, ty * CELL + GAP / 2, CELL - GAP, CELL - GAP);
          }
        }
      }
    }

    if (continentFilter !== "all") {
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      for (const p of PARCELS) {
        if (p.continentId === continentFilter) continue;
        if (p.wx < x0 || p.wx >= x1 || p.wy < y0 || p.wy >= y1) continue;
        ctx.fillRect(p.wx * CELL, p.wy * CELL, CELL, CELL);
      }
    }

    if (selected) {
      const swx = selected.kind === "parcel" ? selected.parcel.wx : selected.wx;
      const swy = selected.kind === "parcel" ? selected.parcel.wy : selected.wy;
      ctx.strokeStyle = "hsl(210 40% 98%)";
      ctx.lineWidth = 2 / view.scale;
      ctx.strokeRect(swx * CELL + 1, swy * CELL + 1, CELL - 2, CELL - 2);
    }
  }, [view, selected, continentFilter, tileMap]);

  useEffect(() => {
    draw();
  }, [draw]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const ro = new ResizeObserver(() => draw());
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [draw]);

  return (
    <main className="min-h-screen bg-background">
      <Navbar />
      <div className="container pt-28 pb-20">
        <Link to="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6">
          <ArrowLeft className="w-4 h-4" />
          {t.back}
        </Link>

        <span className="text-primary font-display text-sm uppercase tracking-widest mb-3 block">{t.eyebrow}</span>
        <h1 className="font-display text-4xl md:text-5xl font-bold mb-4">{t.title}</h1>
        <p className="text-muted-foreground text-lg max-w-2xl mb-3 leading-relaxed">{t.subtitle}</p>
        <p className="text-xs text-primary/80 font-display tracking-wide max-w-2xl mb-8">{t.officialFacts(WORLD_FACTS)}</p>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
          {[
            { label: t.statTotal, value: stats.total },
            { label: t.statAvailable, value: stats.available },
            { label: t.statReserved, value: stats.reserved },
            { label: t.statContinents, value: stats.continents },
          ].map((s) => (
            <Card key={s.label} className="glass border-primary/10">
              <CardContent className="p-4">
                <div className="font-display text-2xl md:text-3xl font-bold text-foreground tabular-nums">{s.value}</div>
                <div className="text-xs text-muted-foreground mt-1">{s.label}</div>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2 mb-4">
          <button
            onClick={() => setContinentFilter("all")}
            className={`text-sm px-3 py-1.5 rounded-lg border transition-colors ${continentFilter === "all" ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:text-foreground"}`}
          >
            {t.filterAll}
          </button>
          {CONTINENTS.map((c) => (
            <button
              key={c.id}
              onClick={() => setContinentFilter(c.id)}
              className={`text-sm px-3 py-1.5 rounded-lg border transition-colors ${continentFilter === c.id ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:text-foreground"}`}
            >
              {c.name}
            </button>
          ))}
        </div>

        <div className="relative">
          <div
            ref={wrapRef}
            onWheel={onWheel}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerLeave}
            onPointerLeave={onPointerLeave}
            onClick={onClick}
            className="glass rounded-2xl overflow-hidden relative w-full min-w-0"
            style={{ height: "min(70vh, 720px)", touchAction: "none", cursor: "grab" }}
          >
            <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />

            <div
              className="absolute bottom-3 right-3 flex flex-col gap-1.5"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              <Button size="icon" variant="glass" onClick={() => zoomBy(1.25)} title={t.zoomIn}>
                <ZoomIn className="w-4 h-4" />
              </Button>
              <Button size="icon" variant="glass" onClick={() => zoomBy(0.8)} title={t.zoomOut}>
                <ZoomOut className="w-4 h-4" />
              </Button>
              <Button size="icon" variant="glass" onClick={fitToScreen} title={t.reset}>
                <Maximize2 className="w-4 h-4" />
              </Button>
            </div>
            <div className="absolute bottom-3 left-3 right-16 text-xs text-muted-foreground bg-background/40 backdrop-blur px-2 py-1 rounded-md">
              {t.dragHint}
            </div>
          </div>

          <div className="flex flex-wrap gap-3 mt-4">
            {(Object.keys(TYPE_COLOR) as ParcelType[]).map((type) => {
              const Icon = TYPE_ICON[type];
              return (
                <div key={type} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="w-3 h-3 rounded-sm inline-block" style={{ background: TYPE_COLOR[type] }} />
                  <Icon className="w-3.5 h-3.5" />
                  {t.typeLabel[type]}
                </div>
              );
            })}
          </div>
        </div>

        <p className="text-xs text-muted-foreground mt-6 max-w-2xl">{t.disclaimer}</p>
      </div>
      <Footer />

      {selected && (
        <div className="fixed inset-0 z-50 bg-background overflow-y-auto animate-in fade-in duration-150">
          <div className="min-h-full max-w-2xl mx-auto px-5 py-8 sm:py-12">
            <button
              onClick={() => setSelected(null)}
              className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6"
            >
              <X className="w-4 h-4" />
              {t.close}
            </button>
            {selected.kind === "parcel" ? (
              <ParcelDetails parcel={selected.parcel} t={t} lang={lang} />
            ) : (
              <OceanDetails wx={selected.wx} wy={selected.wy} t={t} />
            )}
          </div>
        </div>
      )}
    </main>
  );
};

function ParcelDetails({ parcel, t, lang }: { parcel: Parcel; t: (typeof STR)["en"]; lang: "en" | "ru" }) {
  const district = districtOf(parcel);
  const continent = continentOf(parcel);
  const Icon = TYPE_ICON[parcel.type];

  const row = (label: string, value: React.ReactNode) => (
    <div className="flex items-center justify-between py-2.5 border-b border-border/60 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium text-foreground text-right">{value}</span>
    </div>
  );

  const name = parcel.buildingName ?? parcel.placeName?.[lang];
  const coords = `(${officialCoord(parcel.wx)}, ${officialCoord(parcel.wy)})`;

  return (
    <div>
      <div
        className="rounded-2xl p-6 mb-6 flex items-center gap-4"
        style={{ background: `linear-gradient(135deg, ${TYPE_COLOR[parcel.type]}30, transparent)`, border: `1px solid ${TYPE_COLOR[parcel.type]}40` }}
      >
        <span className="w-14 h-14 rounded-xl flex items-center justify-center shrink-0" style={{ background: `${TYPE_COLOR[parcel.type]}30` }}>
          <Icon className="w-7 h-7" style={{ color: TYPE_COLOR[parcel.type] }} />
        </span>
        <div className="min-w-0">
          <h3 className="font-display font-bold text-2xl leading-tight truncate">{name ?? parcel.id}</h3>
          <p className="text-xs text-muted-foreground/70 font-mono mt-0.5">{parcel.id} · {coords}</p>
        </div>
      </div>

      <p className="text-sm text-muted-foreground mb-5">{district.blurb[lang]}</p>

      <div className="mb-5">
        {row(t.fieldContinent, continent.name)}
        {row(t.fieldDistrict, district.name)}
        {row(t.fieldType, t.typeLabel[parcel.type])}
        {row(t.fieldStatus, t.statusLabel[parcel.status])}
        {row(t.fieldSize, `${parcel.sizeM2} m²`)}
        {row(t.fieldWaterfront, parcel.waterfront ? t.yes : t.no)}
        {parcel.apartments && row(t.fieldApartments, parcel.apartments)}
        {parcel.resourceType && row(t.fieldResource, parcel.resourceType)}
        {row(t.fieldOwner, parcel.owner ?? t.ownerUnclaimed)}
      </div>

      <div className="grid grid-cols-2 gap-3 mb-5">
        <div className="glass rounded-xl p-4 border-primary/10">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
            <Coins className="w-3.5 h-3.5" />
            {t.fieldReward}
          </div>
          <div className="font-display text-lg font-bold tabular-nums">
            {parcel.dailyReward > 0 ? `${parcel.dailyReward} ${t.perDay}` : "—"}
          </div>
        </div>
        <div className="glass rounded-xl p-4 border-primary/10">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
            <Footprints className="w-3.5 h-3.5" />
            {t.fieldToll}
          </div>
          <div className="font-display text-lg font-bold tabular-nums">
            {parcel.tollFee > 0 ? `${parcel.tollFee} ${t.perDay.split("/")[0]}` : t.tollFree}
          </div>
        </div>
      </div>

      <div>
        <h4 className="text-xs text-muted-foreground mb-2">{t.fieldAssets}</h4>
        {parcel.assets.length === 0 ? (
          <p className="text-sm text-muted-foreground/70 italic">{t.noAssets}</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {parcel.assets.map((a, i) => {
              const AIcon = ASSET_ICON[a.icon];
              return (
                <span key={i} className="inline-flex items-center gap-1.5 text-sm bg-muted/50 rounded-lg px-3 py-1.5">
                  <AIcon className="w-3.5 h-3.5" />
                  {a.label[lang]}
                </span>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function OceanDetails({ wx, wy, t }: { wx: number; wy: number; t: (typeof STR)["en"] }) {
  const coords = `(${officialCoord(wx)}, ${officialCoord(wy)})`;
  return (
    <div>
      <div className="rounded-2xl p-6 mb-6 flex items-center gap-4 glass border-primary/10">
        <span className="w-14 h-14 rounded-xl flex items-center justify-center shrink-0 bg-[#4FB3D9]/20">
          <Waves className="w-7 h-7" style={{ color: "#4FB3D9" }} />
        </span>
        <div>
          <h3 className="font-display font-bold text-2xl leading-tight">{t.oceanTitle}</h3>
          <p className="text-xs text-muted-foreground/70 font-mono mt-0.5">{coords}</p>
        </div>
      </div>
      <p className="text-sm text-muted-foreground mb-5">{t.oceanBody}</p>
      <div className="flex items-center justify-between py-2.5 border-b border-border/60">
        <span className="text-sm text-muted-foreground">{t.fieldToll}</span>
        <span className="text-sm font-medium text-foreground">{t.tollFree}</span>
      </div>
    </div>
  );
}

export default LandMap;
