import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Home, Store, Building2, GraduationCap, Droplets, Landmark, ZoomIn, ZoomOut, Maximize2, ArrowLeft } from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useLanguage } from "@/i18n/LanguageContext";
import { CONTINENTS, PARCELS, WORLD_BOUNDS, WORLD_FACTS, districtOf, continentOf, type Parcel, type ParcelType } from "@/data/landMap";

const CELL = 22;
const GAP = 2;

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
    panelEmptyTitle: "Select a parcel",
    panelEmptyBody: "Click any tile on the map to see its district, type and status.",
    fieldId: "Parcel",
    fieldDistrict: "District",
    fieldContinent: "Continent",
    fieldType: "Type",
    fieldStatus: "Status",
    fieldSize: "Size",
    fieldWaterfront: "Waterfront",
    fieldApartments: "Apartments inside",
    fieldResource: "Resource",
    yes: "Yes",
    no: "No",
    zoomIn: "Zoom in",
    zoomOut: "Zoom out",
    reset: "Fit to screen",
    dragHint: "Drag to pan, scroll or pinch to zoom",
    officialFacts: (f: typeof WORLD_FACTS) =>
      `Officially: ${f.totalLands.toLocaleString("en-US")} LANDs on a ${f.gridSize}x${f.gridSize} grid (coords ${f.coordMin}..${f.coordMax}), ~${f.mintedLands.toLocaleString("en-US")} minted, priced in $${f.token} (${f.tokenSupply} supply, ${f.chain}).`,
    disclaimer: "Concept map, v1 — an illustrative subset built from scratch for planning, not the real 640x640 grid above. Real land & apartment NFTs on Cronos are not represented here yet.",
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
    panelEmptyTitle: "Выберите участок",
    panelEmptyBody: "Нажмите на любую клетку карты, чтобы увидеть район, тип и статус.",
    fieldId: "Участок",
    fieldDistrict: "Район",
    fieldContinent: "Континент",
    fieldType: "Тип",
    fieldStatus: "Статус",
    fieldSize: "Площадь",
    fieldWaterfront: "У воды",
    fieldApartments: "Апартаментов внутри",
    fieldResource: "Ресурс",
    yes: "Да",
    no: "Нет",
    zoomIn: "Приблизить",
    zoomOut: "Отдалить",
    reset: "Показать всё",
    dragHint: "Тяните для перемещения, крутите колесо для масштаба",
    officialFacts: (f: typeof WORLD_FACTS) =>
      `Официально: ${f.totalLands.toLocaleString("ru-RU")} участков на сетке ${f.gridSize}x${f.gridSize} (координаты ${f.coordMin}..${f.coordMax}), ~${f.mintedLands.toLocaleString("ru-RU")} уже сминтовано, цены в $${f.token} (${f.tokenSupply}, ${f.chain}).`,
    disclaimer: "Концептуальная карта, версия 1 — уменьшенный иллюстративный набросок, не настоящая сетка 640×640 выше. Реальные NFT земель и апартаментов на Cronos здесь пока не отражены.",
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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState({ scale: 1, x: 20, y: 20 });
  const wrapRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef({ active: false, lastX: 0, lastY: 0 });

  const worldW = WORLD_BOUNDS.maxX * CELL;
  const worldH = WORLD_BOUNDS.maxY * CELL;

  const fitToScreen = useCallback(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const pad = 24;
    const scale = clamp(Math.min((wrap.clientWidth - pad * 2) / worldW, (wrap.clientHeight - pad * 2) / worldH), 0.3, 3);
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
      const newScale = clamp(v.scale * factor, 0.3, 4);
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
    dragRef.current = { active: true, lastX: e.clientX, lastY: e.clientY };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current.active) return;
    const dx = e.clientX - dragRef.current.lastX;
    const dy = e.clientY - dragRef.current.lastY;
    dragRef.current.lastX = e.clientX;
    dragRef.current.lastY = e.clientY;
    setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
  }, []);

  const onPointerUp = useCallback(() => {
    dragRef.current.active = false;
  }, []);

  const stats = useMemo(() => {
    const total = PARCELS.length;
    const available = PARCELS.filter((p) => p.status === "available").length;
    const reserved = total - available;
    return { total, available, reserved, continents: CONTINENTS.length };
  }, []);

  const selected: Parcel | null = useMemo(() => PARCELS.find((p) => p.id === selectedId) ?? null, [selectedId]);

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

        <div className="grid lg:grid-cols-[minmax(0,1fr)_320px] gap-5">
          <div className="relative min-w-0">
            <div
              ref={wrapRef}
              onWheel={onWheel}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerLeave={onPointerUp}
              className="glass rounded-2xl overflow-hidden relative w-full min-w-0"
              style={{ height: "min(62vh, 560px)", touchAction: "none", cursor: "grab" }}
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
                  const isSelected = p.id === selectedId;
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
                      onClick={() => setSelectedId(p.id)}
                      style={{ cursor: "pointer" }}
                    />
                  );
                })}
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
              <div className="absolute bottom-3 left-3 text-xs text-muted-foreground bg-background/40 backdrop-blur px-2 py-1 rounded-md">
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

          <Card className="glass border-primary/10 h-fit lg:sticky lg:top-28">
            <CardContent className="p-5">
              {!selected ? (
                <div>
                  <h3 className="font-display font-semibold text-lg mb-2">{t.panelEmptyTitle}</h3>
                  <p className="text-sm text-muted-foreground">{t.panelEmptyBody}</p>
                </div>
              ) : (
                <ParcelDetails parcel={selected} t={t} lang={lang} />
              )}
            </CardContent>
          </Card>
        </div>

        <p className="text-xs text-muted-foreground mt-6 max-w-2xl">{t.disclaimer}</p>
      </div>
      <Footer />
    </main>
  );
};

function ParcelDetails({ parcel, t, lang }: { parcel: Parcel; t: (typeof STR)["en"]; lang: "en" | "ru" }) {
  const district = districtOf(parcel);
  const continent = continentOf(parcel);
  const Icon = TYPE_ICON[parcel.type];

  const row = (label: string, value: React.ReactNode) => (
    <div className="flex items-center justify-between py-2 border-b border-border/60 last:border-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-medium text-foreground text-right">{value}</span>
    </div>
  );

  const name = parcel.buildingName ?? parcel.placeName?.[lang];

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <span className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${TYPE_COLOR[parcel.type]}30` }}>
          <Icon className="w-4 h-4" style={{ color: TYPE_COLOR[parcel.type] }} />
        </span>
        <h3 className="font-display font-semibold text-lg leading-tight">{name ?? parcel.id}</h3>
      </div>
      {name && <p className="text-xs text-muted-foreground/70 font-mono mb-1">{parcel.id}</p>}
      <p className="text-xs text-muted-foreground mb-3">{district.blurb[lang]}</p>
      <div>
        {row(t.fieldContinent, continent.name)}
        {row(t.fieldDistrict, district.name)}
        {row(t.fieldType, t.typeLabel[parcel.type])}
        {row(t.fieldStatus, t.statusLabel[parcel.status])}
        {row(t.fieldSize, `${parcel.sizeM2} m²`)}
        {row(t.fieldWaterfront, parcel.waterfront ? t.yes : t.no)}
        {parcel.apartments && row(t.fieldApartments, parcel.apartments)}
        {parcel.resourceType && row(t.fieldResource, parcel.resourceType)}
      </div>
    </div>
  );
}

export default LandMap;
