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
  const wrapRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef({ active: false, lastX: 0, lastY: 0, downX: 0, downY: 0, moved: false });

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

  const bridge = useMemo(() => {
    const aur = CONTINENTS.find((c) => c.id === "AUR")!;
    const mer = CONTINENTS.find((c) => c.id === "MER")!;
    const x1 = (aur.worldOffset[0] + aur.cols) * CELL;
    const y1 = (aur.worldOffset[1] + 10) * CELL;
    const x2 = mer.worldOffset[0] * CELL;
    const y2 = (mer.worldOffset[1] + 9) * CELL;
    return { x1, y1, x2, y2 };
  }, []);

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
            <svg width={worldW} height={worldH} style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`, transformOrigin: "0 0" }}>
              <defs>
                <linearGradient id="water" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="hsl(var(--gradient-start))" />
                  <stop offset="50%" stopColor="hsl(var(--gradient-mid))" />
                  <stop offset="100%" stopColor="hsl(var(--gradient-end))" />
                </linearGradient>
              </defs>
              <rect x={0} y={0} width={worldW} height={worldH} fill="url(#water)" />
              <line
                x1={bridge.x1} y1={bridge.y1} x2={bridge.x2} y2={bridge.y2}
                stroke="hsl(var(--muted-foreground))" strokeWidth={3} strokeDasharray="3 7" opacity={0.5}
              />
              {PARCELS.map((p) => {
                const dimmed = continentFilter !== "all" && p.continentId !== continentFilter;
                const isSelected = selected?.kind === "parcel" && selected.parcel.id === p.id;
                return (
                  <rect
                    key={p.id}
                    x={p.wx * CELL + GAP / 2}
                    y={p.wy * CELL + GAP / 2}
                    width={CELL - GAP}
                    height={CELL - GAP}
                    rx={3}
                    fill={TYPE_COLOR[p.type]}
                    opacity={dimmed ? 0.15 : p.status === "reserved" ? 0.85 : 0.65}
                    stroke={isSelected ? "hsl(var(--foreground))" : "transparent"}
                    strokeWidth={isSelected ? 2 : 0}
                  />
                );
              })}
              {selected?.kind === "ocean" && (
                <rect
                  x={selected.wx * CELL + GAP / 2}
                  y={selected.wy * CELL + GAP / 2}
                  width={CELL - GAP}
                  height={CELL - GAP}
                  rx={3}
                  fill="none"
                  stroke="hsl(var(--foreground))"
                  strokeWidth={2}
                />
              )}
            </svg>

            <div className="absolute bottom-3 right-3 flex flex-col gap-1.5">
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
