import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowLeft, Brain, Building2, Coins, Cpu, Crown, Droplet, Gamepad2, Footprints, HelpCircle, Home, Landmark, Link2, Loader2, Maximize2, MapPin, RotateCcw, RotateCw, Route as RoadIcon, Search, Sparkles, UserRound, Users, Waves, X, ZoomIn, ZoomOut, Trophy, Rainbow, Orbit as OrbitIcon } from "lucide-react";
import { NicsChatButton } from "@/game/nics/NicsChat";
import { toast } from "sonner";
import { useLanguage } from "@/i18n/LanguageContext";
import { DEFAULT_WORLD, findPlotByAddress, generateWorld, type Kind, type Plot, type World } from "@/game/world/generator";
import { buildingFor, builtBuilding, hasHouse, type Built } from "@/game/world/buildings";
import PlotView from "@/game/build/PlotView";
import TowerPanel from "@/game/heritage/TowerPanel";
import type { TowerId } from "@/game/heritage/api";
import { towerOnPlot } from "@/game/world/landmarks";
import PlotPreview from "@/game/build/PlotPreview";
import { fetchBuildMap, fetchMyBuildings, toBuilt, type BuildRules, type MyBuilding } from "@/game/build/api";
import { buildStrings } from "@/game/build/strings";
import { WorldRenderer } from "@/game/world/renderer";
import { worldLocale, worldStrings } from "@/game/world/strings";
import { useAccount } from "@/game/account/AccountContext";
import { accountStrings } from "@/game/account/strings";
import { useEconomy, type PlotOwner } from "@/game/economy/EconomyContext";
import { buyPlot, dailyIncome } from "@/game/economy/api";
import { plotPrice } from "@/game/economy/pricing";
import { economyStrings } from "@/game/economy/strings";
import TideChip from "@/game/economy/TideChip";
import type { CivicId } from "@/game/world/civic";
import { fetchCivic, fetchProposals, type Proposal } from "@/game/state/api";
import { stateStrings } from "@/game/state/strings";
import { chamberOf } from "@/game/state/ui";
import { buyHub, fetchNetwork, travel, type HubInfo, type Location, type NetworkInfo } from "@/game/travel/api";
import { TripPlayer, dropHue } from "@/game/travel/drop";
import type { Leg } from "@/game/travel/network";
import { travelStrings } from "@/game/travel/strings";
import { HubCard, TravelOptions, tripSegments } from "@/game/travel/ui";
import PlotArcade from "@/game/arcade/PlotArcade";
import { fetchArcadeMap, type MapAttraction } from "@/game/arcade/api";
import { arcadeStrings } from "@/game/arcade/strings";
import { DEFAULT_LAWS, dealDuty, useLaws } from "@/game/bank/api";
import { bankStrings } from "@/game/bank/strings";
import { roadsStrings } from "@/game/roads/strings";
import { questsStrings } from "@/game/quests/strings";
import { orbitStrings } from "@/game/orbit/strings";
import { RoadsHere } from "@/game/roads/RoadsHere";
import { useBankT } from "@/game/bank/ui";
import { avatarOf, fetchResidents, type ResidentsMap } from "@/game/residents/api";
import { spread } from "@/game/residents/avatars";
import AvatarPreview from "@/game/residents/AvatarPreview";
import { residentsStrings } from "@/game/residents/strings";
import { useMyAvatar } from "@/game/residents/useMyAvatar";
import Tour, { tourDone } from "@/game/tour/Tour";
import { tourStrings } from "@/game/tour/strings";

const ARCADE_GLYPH: Record<MapAttraction["template"], string> = { quiz: "?", crystals: "◆", maze: "#", range: "◎", race: "≈" };

/** One tile is 20 × 20 m in the game world. */
const TILE_M2 = 400;
const TILE_M = 20;

type Selection =
  | { kind: "plot"; plot: Plot }
  | { kind: "tower"; id?: TowerId }
  | { kind: "civic"; id: CivicId }
  | { kind: "tile"; tile: Kind; district: number }
  | { kind: "hub"; id: string }
  | null;

/** Road tiles: tapping one shows the roads of its district, to buy or repair. */
const ROAD_TILES = new Set<Kind>(["road", "street", "bridge"] as Kind[]);

/** Tiles of a station, a harbour's shore or an airport that open its card when tapped. */
const HUB_TILES: Partial<Record<Kind, number>> = { station: 2, rail: 1, terminal: 9, apron: 12, runway: 18, pier: 4, shallow: 2, ocean: 2, beach: 2 };

const City = () => {
  const { language } = useLanguage();
  const t = worldStrings(language);
  const ta = accountStrings(language);
  const { player, session, signOut } = useAccount();
  const te = economyStrings(language);
  const ts = stateStrings(language);
  const tBank = bankStrings(language);
  const tr = roadsStrings(language);
  const tq = questsStrings(language);
  const to = orbitStrings(language);
  const tt = travelStrings(language);
  // open votes, for the lights on the plaza buildings and their cards
  const [openVotes, setOpenVotes] = useState<Proposal[]>([]);
  const [toVote, setToVote] = useState(0);
  useEffect(() => {
    let stop = false;
    const load = async () => {
      const r = await fetchProposals(session, "open");
      if (!stop && r.ok) setOpenVotes(r.data.proposals);
      if (session) {
        const c = await fetchCivic(session);
        if (!stop && c.ok) setToVote(c.data.toVote);
      }
    };
    void load();
    const id = window.setInterval(load, 60_000);
    return () => {
      stop = true;
      window.clearInterval(id);
    };
  }, [session]);
  const civicOpen = useMemo(() => {
    const m = new Map<CivicId, Proposal[]>();
    for (const p of openVotes) {
      if (p.status !== "voting") continue;
      const ch = chamberOf(p.stageBody);
      const id: CivicId | null = ch === "council" || ch === "assembly" || ch === "mayors" ? ch : null;
      if (id) m.set(id, [...(m.get(id) ?? []), p]);
    }
    return m;
  }, [openVotes]);
  useEffect(() => {
    if (rendererRef.current) rendererRef.current.busyCivic = new Set(civicOpen.keys());
  }, [civicOpen]);
  // arcade attractions: a sign over each plot that has one
  const tg = arcadeStrings(language);
  const attractionsRef = useRef<Map<number, { ai: boolean; glyph: string }>>(new Map());
  useEffect(() => {
    let stop = false;
    const load = async () => {
      const r = await fetchArcadeMap();
      if (stop || !r.ok) return;
      attractionsRef.current = new Map(r.data.attractions.map((a) => [a.plotId, { ai: a.ai, glyph: ARCADE_GLYPH[a.template] ?? "?" }]));
      if (rendererRef.current) rendererRef.current.attractions = attractionsRef.current;
    };
    void load();
    const id = window.setInterval(load, 120_000);
    return () => {
      stop = true;
      window.clearInterval(id);
    };
  }, []);
  const economy = useEconomy();
  const tb = buildStrings(language);
  // what residents built, from the construction office
  const [built, setBuilt] = useState<Map<number, Built>>(new Map());
  const builtRef = useRef(built);
  const [buildRules, setBuildRules] = useState<BuildRules | null>(null);
  const [myBuildings, setMyBuildings] = useState<MyBuilding[]>([]);
  const [plotOpen, setPlotOpen] = useState<Plot | null>(null);
  // first-visit tour, once per resident on this device; the Tour button replays it
  const tTour = tourStrings(language);
  const [tourOpen, setTourOpen] = useState(false);
  useEffect(() => {
    if (player?.email && !tourDone(player.email)) setTourOpen(true);
  }, [player?.email]);
  const loadBuilt = useCallback(async () => {
    const [m, mine] = await Promise.all([fetchBuildMap(), session ? fetchMyBuildings(session) : Promise.resolve(null)]);
    if (m.ok) {
      const next = toBuilt(m.data.buildings);
      builtRef.current = next;
      setBuilt(next);
      setBuildRules(m.data.rules);
      rendererRef.current?.setBuilt(next);
    }
    if (mine?.ok) setMyBuildings(mine.data.mine);
  }, [session]);
  useEffect(() => {
    void loadBuilt();
    const id = window.setInterval(() => void loadBuilt(), 60_000);
    return () => window.clearInterval(id);
  }, [loadBuilt]);
  const ownedRef = useRef<Map<number, boolean>>(new Map());
  useEffect(() => {
    ownedRef.current = new Map([...economy.owners].map(([id, o]) => [id, o.mine]));
    if (rendererRef.current) rendererRef.current.owned = ownedRef.current;
  }, [economy.owners]);
  const city = useMemo(() => generateWorld(DEFAULT_WORLD), []);
  const [params, setParams] = useSearchParams();

  // --- where the resident stands, and the transport network -----------------
  const [net, setNet] = useState<NetworkInfo | null>(null);
  const [me, setMe] = useState<Location | null>(null);
  const [travelling, setTravelling] = useState(false);
  const travellingRef = useRef(false);
  const centred = useRef(false);
  const [myAvatar] = useMyAvatar(session, player?.email);
  const avatar = useMemo(() => avatarOf(myAvatar, dropHue(player?.email ?? "guest")), [myAvatar, player?.email]);
  const hue = avatar.hue;
  const placeDrop = useCallback(
    (loc: Location | null) => {
      const r = rendererRef.current;
      if (!r) return;
      r.player = loc ? { x: loc.x, y: loc.y, hue, label: tt.you, style: avatar.style } : null;
    },
    [hue, avatar.style, tt.you],
  );
  // a new avatar or colour shows at once, where the resident stands
  useEffect(() => {
    const r = rendererRef.current;
    if (r?.player) {
      r.player.hue = hue;
      r.player.style = avatar.style;
    }
  }, [hue, avatar.style]);

  // --- the other residents: real people, where they really are --------------
  const tres = residentsStrings(language);
  const [crowd, setCrowd] = useState<ResidentsMap | null>(null);
  const [showCrowd, setShowCrowd] = useState(true);
  const crowdRef = useRef<ReturnType<typeof spread<ResidentsMap["residents"][number] & { hue: number }>>>([]);
  useEffect(() => {
    if (!session) return;
    let stop = false;
    const load = async () => {
      if (document.hidden) return;
      const r = await fetchResidents(session);
      if (stop || !r.ok) return;
      setCrowd(r.data);
      crowdRef.current = spread(r.data.residents.map((x) => ({ ...x, hue: x.hue ?? dropHue(x.key) })));
      if (rendererRef.current) rendererRef.current.residents = crowdRef.current;
    };
    void load();
    const id = window.setInterval(load, 30_000);
    const onShow = () => !document.hidden && void load();
    document.addEventListener("visibilitychange", onShow);
    return () => {
      stop = true;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [session]);
  useEffect(() => {
    if (rendererRef.current) rendererRef.current.showResidents = showCrowd;
  }, [showCrowd]);
  const loadNetwork = useCallback(async () => {
    const r = await fetchNetwork(session);
    if (!r.ok) {
      if (r.error === "session") signOut();
      return;
    }
    setNet(r.data);
    if (rendererRef.current) rendererRef.current.ports = r.data.hubs.filter((h) => h.kind === "port").map((h) => ({ x: h.x, y: h.y }));
    if (r.data.me && !travellingRef.current) {
      setMe(r.data.me);
      placeDrop(r.data.me);
      // on arrival in the world, the camera looks at the resident's drop
      if (!centred.current && rendererRef.current) {
        centred.current = true;
        if (!params.get("at") && !params.get("plot")) rendererRef.current.focusPoint(r.data.me.x, r.data.me.y, 0.7);
      }
    }
  }, [session, signOut, placeDrop, params]);
  useEffect(() => {
    void loadNetwork();
    const id = window.setInterval(() => void loadNetwork(), 60_000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  const landPlots = useMemo(() => city.plots.filter((p) => !p.water).length, [city]);

  const wrapRef = useRef<HTMLDivElement>(null);
  // the renderer is made again when the language changes: it takes the drop from these
  const netRef = useRef(net);
  const meRef = useRef(me);
  const hueRef = useRef(hue);
  const styleRef = useRef(avatar.style);
  styleRef.current = avatar.style;
  const labelRef = useRef(tt.you);
  netRef.current = net;
  meRef.current = me;
  hueRef.current = hue;
  labelRef.current = tt.you;
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
    r.civicLabels = { council: ts.chambers.council, assembly: ts.chambers.assembly, directorate: ts.chambers.directorate, mayors: ts.chambers.mayors, bank: tBank.bankTitle };
    const size = () => {
      const rect = wrap.getBoundingClientRect();
      r.resize(rect.width, rect.height, Math.min(window.devicePixelRatio || 1, 2));
    };
    size();
    if (builtRef.current.size) r.setBuilt(builtRef.current);
    r.owned = ownedRef.current;
    r.attractions = attractionsRef.current;
    r.residents = crowdRef.current;
    r.fit();
    centred.current = false;
    if (netRef.current) r.ports = netRef.current.hubs.filter((h) => h.kind === "port").map((h) => ({ x: h.x, y: h.y }));
    if (meRef.current) {
      r.player = { x: meRef.current.x, y: meRef.current.y, hue: hueRef.current, label: labelRef.current, style: styleRef.current };
      if (!new URLSearchParams(window.location.search).get("at")) r.focusPoint(meRef.current.x, meRef.current.y, 0.7);
      centred.current = true;
    }
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
      r.towerSelected = s?.kind === "tower" && (s.id ?? "first-light") === "first-light";
      r.secondSelected = s?.kind === "tower" && s.id === "second-light";
      r.selectedCivic = s?.kind === "civic" ? s.id : null;
      if (focus && s?.kind === "hub" && netRef.current) {
        const h = netRef.current.hubs.find((x) => x.id === s.id);
        if (h) r.focusPoint(h.x, h.y, 1);
      }
      if (focus && s?.kind === "plot") {
        r.focusTile(s.plot.anchor.x, s.plot.anchor.y, 1.4);
        // on phones the card covers the lower half: show the plot above it
        if (window.innerWidth < 768) r.pan(0, -window.innerHeight * 0.2);
      }
      if (focus && s?.kind === "tower") {
        if (s.id === "second-light") r.focusSecond();
        else r.focusTower(0.6);
      }
      const next = new URLSearchParams(params);
      // links name the address, which never changes; ids may shift as the world grows
      next.delete("plot");
      if (s?.kind === "plot") next.set("at", s.plot.address);
      else next.delete("at");
      setParams(next, { replace: true });
    },
    [params, setParams, city],
  );

  // deep link: /world?at=12 Coral Street (older links: ?plot=123)
  useEffect(() => {
    if (selection) return;
    const at = params.get("at");
    const id = Number(params.get("plot"));
    const plot = at ? findPlotByAddress(city, at) : params.get("plot") && Number.isInteger(id) ? city.plots[id] : undefined;
    if (plot) select({ kind: "plot", plot }, true);
    // run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- rotation: buttons, Q / E keys, right-drag, two-finger twist -----------
  const rotate = useCallback((dir: 1 | -1) => rendererRef.current?.rotate(dir), []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const el = e.target;
      if (e.ctrlKey || e.metaKey || e.altKey || (el instanceof Element && el.closest("input, textarea, select, [contenteditable]"))) return;
      const k = e.key.toLowerCase();
      if (k === "q") rotate(-1);
      else if (k === "e") rotate(1);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [rotate]);

  // --- pointer input: drag, wheel, pinch, tap --------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const pointers = new Map<number, { x: number; y: number }>();
    let moved = 0;
    let pinchDist = 0;
    /** Right mouse button held: horizontal drag turns the map. */
    let spin: { x: number } | null = null;
    /** Two fingers: the angle between them, and how far they have twisted since the last turn. */
    let twistAngle = 0;
    let twisted = 0;
    const SPIN_PX = 90;
    const TWIST_RAD = (35 * Math.PI) / 180;
    const local = (e: PointerEvent | WheelEvent) => {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };
    const down = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId);
      if (e.pointerType === "mouse" && e.button === 2) {
        spin = { x: local(e).x };
        return;
      }
      pointers.set(e.pointerId, local(e));
      moved = 0;
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
        twistAngle = Math.atan2(b.y - a.y, b.x - a.x);
        twisted = 0;
      }
    };
    const move = (e: PointerEvent) => {
      const r = rendererRef.current;
      if (!r) return;
      const p = local(e);
      if (spin) {
        const dx = p.x - spin.x;
        if (Math.abs(dx) >= SPIN_PX && !r.isTurning) {
          r.rotate(dx > 0 ? 1 : -1);
          spin.x = p.x;
        }
        return;
      }
      const prev = pointers.get(e.pointerId);
      if (!prev) {
        // hover (mouse only)
        const pick = r.pick(p.x, p.y);
        r.hoverPlot = pick?.kind === "plot" ? pick.plotId : null;
        canvas.style.cursor = pick?.kind === "plot" || pick?.kind === "tower" || pick?.kind === "civic" ? "pointer" : "grab";
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
        const ang = Math.atan2(b.y - a.y, b.x - a.x);
        let da = ang - twistAngle;
        if (da > Math.PI) da -= 2 * Math.PI;
        if (da < -Math.PI) da += 2 * Math.PI;
        twistAngle = ang;
        twisted += da;
        if (Math.abs(twisted) >= TWIST_RAD && !r.isTurning) {
          r.rotate(twisted > 0 ? 1 : -1);
          twisted = 0;
        }
        moved += 10;
        return;
      }
      pointers.set(e.pointerId, p);
    };
    const up = (e: PointerEvent) => {
      if (spin && e.pointerType === "mouse" && !pointers.has(e.pointerId)) {
        spin = null;
        return;
      }
      const r = rendererRef.current;
      const p = local(e);
      const wasTap = pointers.size === 1 && moved < 6;
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinchDist = 0;
      if (!r || !wasTap) return;
      const pick = r.pick(p.x, p.y);
      if (pick?.kind === "plot" && towerOnPlot(city, pick.plotId)) select({ kind: "tower", id: "second-light" });
      else if (pick?.kind === "plot") select({ kind: "plot", plot: city.plots[pick.plotId] });
      else if (pick?.kind === "tower") select({ kind: "tower", id: pick.id });
      else if (pick?.kind === "civic") select({ kind: "civic", id: pick.id });
      else if (pick?.kind === "tile") {
        const reach = HUB_TILES[pick.tile];
        const hub = reach
          ? netRef.current?.hubs
              .filter((h) => Math.max(Math.abs(h.x - pick.x), Math.abs(h.y - pick.y)) <= reach)
              .sort((a, b) => Math.hypot(a.x - pick.x, a.y - pick.y) - Math.hypot(b.x - pick.x, b.y - pick.y))[0]
          : undefined;
        if (hub) select({ kind: "hub", id: hub.id });
        else select({ kind: "tile", tile: pick.tile, district: pick.district });
      }
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
    const menu = (e: MouseEvent) => e.preventDefault();
    canvas.addEventListener("contextmenu", menu);
    return () => {
      canvas.removeEventListener("contextmenu", menu);
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", up);
      canvas.removeEventListener("wheel", wheel);
    };
  }, [city, select]);

  /** Send a trip to the server; when it is paid, play it on the map. */
  const go = useCallback(
    async (legs: Leg[], plot: Plot | null) => {
      const r = rendererRef.current;
      if (!session || !me || !net || travellingRef.current) return;
      travellingRef.current = true;
      setTravelling(true);
      const body = [...legs.map((l) => ({ mode: l.mode, to: l.to })), ...(plot ? [{ mode: "walk" as const, plot: plot.id }] : [])];
      const res = await travel(session, body);
      if (!res.ok) {
        travellingRef.current = false;
        setTravelling(false);
        if (res.error === "session") signOut();
        else toast.error(tt.errors[res.error]);
        return;
      }
      const from = r?.player ? { x: r.player.x, y: r.player.y } : { x: me.x, y: me.y };
      const segs = tripSegments(city, net, from, legs, plot ? plot.anchor : null, me.districtId);
      const arrive = () => {
        travellingRef.current = false;
        setTravelling(false);
        setMe(res.data.me);
        placeDrop(res.data.me);
        if (legs.length) toast.success(tt.arrived(res.data.me.district ?? city.districts[res.data.me.districtId]?.name ?? "", res.data.fare));
        void economy.refresh();
        void loadNetwork();
      };
      if (r && segs.length) {
        // long trips are watched from above, walks from where the camera is
        if (legs.length && r.camera.scale > 0.45) r.camera.scale = 0.45;
        r.follow = true;
        r.trip = new TripPlayer(segs, arrive);
      } else arrive();
    },
    [session, me, net, city, signOut, tt, placeDrop, economy, loadNetwork],
  );

  const findMe = () => {
    const r = rendererRef.current;
    if (!r?.player) return;
    r.focusPoint(r.player.x, r.player.y, Math.max(r.camera.scale, 0.7));
  };

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
    <div className="p-safe fixed inset-0 flex flex-col bg-background text-foreground">
      {/* top bar */}
      <header className="z-20 flex flex-wrap items-center gap-2 border-b border-border/60 bg-background/85 px-3 py-2 backdrop-blur md:gap-3 md:px-4">
        <Link to="/" className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
          <span className="sr-only sm:not-sr-only">{t.back}</span>
        </Link>
        <div className="flex min-w-0 items-center gap-2">
          <h1 className="sr-only font-display text-base font-bold sm:not-sr-only md:text-lg">{t.title}</h1>
          <span className="hidden rounded-full border border-primary/40 px-2 py-0.5 text-[11px] font-medium text-primary sm:inline">{t.badge}</span>
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
        <Link
          to="/state"
          title={ts.commonwealth}
          aria-label={ts.commonwealth}
          className="relative ml-auto flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-amber-400/50 bg-amber-400/10 px-2.5 text-sm font-semibold text-amber-200 hover:border-amber-300 md:ml-0"
        >
          <Landmark className="h-4 w-4 text-amber-300" />
          <span className="hidden sm:inline">{ts.commonwealthShort}</span>
          {toVote > 0 && <span className="rounded-full bg-emerald-400 px-1.5 text-[11px] font-bold text-black">{toVote}</span>}
        </Link>
        <Link
          to="/roads"
          title="Roads"
          aria-label="Roads"
          className="flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-emerald-400/50 bg-emerald-400/10 px-2.5 text-sm font-semibold text-emerald-200 hover:border-emerald-300"
        >
          <RoadIcon className="h-4 w-4 text-emerald-300" />
          <span className="hidden sm:inline">{tr.title}</span>
        </Link>
        <Link
          to="/rich"
          title="Richest residents"
          aria-label="Richest residents"
          className="flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-amber-400/50 bg-amber-400/10 px-2.5 text-sm font-semibold text-amber-200 hover:border-amber-300"
        >
          <Trophy className="h-4 w-4 text-amber-300" />
        </Link>
        <Link
          to="/quests"
          title={tq.title}
          aria-label={tq.title}
          className="flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-sky-400/50 bg-sky-400/10 px-2.5 text-sm font-semibold text-sky-200 hover:border-sky-300"
        >
          <Sparkles className="h-4 w-4 text-sky-300" />
          <span className="hidden sm:inline">{tq.short}</span>
        </Link>
        <Link
          to="/rainbowland"
          title="Rainbowland"
          aria-label="Rainbowland"
          className="flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-pink-400/50 bg-gradient-to-r from-rose-500/15 via-amber-400/15 to-violet-500/15 px-2.5 text-sm font-semibold text-pink-100 hover:border-pink-300"
        >
          <Rainbow className="h-4 w-4 text-pink-300" />
          <span className="hidden sm:inline">Rainbowland</span>
        </Link>
        <Link
          to="/orbit"
          title={to.title}
          aria-label={to.title}
          className="flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-indigo-400/50 bg-indigo-400/10 px-2.5 text-sm font-semibold text-indigo-200 hover:border-indigo-300"
        >
          <OrbitIcon className="h-4 w-4 text-indigo-300" />
          <span className="hidden sm:inline">{to.short}</span>
        </Link>
        <Link
          to="/arcade"
          title={tg.arcade}
          aria-label={tg.arcade}
          className="flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-fuchsia-400/50 bg-fuchsia-400/10 px-2.5 text-sm font-semibold text-fuchsia-200 hover:border-fuchsia-300"
        >
          <Gamepad2 className="h-4 w-4 text-fuchsia-300" />
          <span className="hidden sm:inline">{tg.arcade}</span>
        </Link>
        <Link
          to="/mind"
          title="City Mind"
          aria-label="City Mind"
          className="flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-cyan-300/50 bg-cyan-400/10 px-2.5 text-sm font-semibold text-cyan-200 hover:border-cyan-200"
        >
          <Brain className="h-4 w-4 text-cyan-300" />
        </Link>
        <NicsChatButton className="flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-cyan-300/50 bg-cyan-400/10 px-2.5 text-sm font-semibold text-cyan-200 hover:border-cyan-200">
          <Cpu className="h-4 w-4 text-cyan-300" />
          <span className="hidden sm:inline">NICS AI</span>
        </NicsChatButton>
        {player && <TideChip />}
        {player && (
          <Link
            to="/profile"
            title={player.council ? `${ta.councilName} · ${player.council.title}` : ta.profile}
            aria-label={ta.profile}
            className={`flex h-9 max-w-[45%] items-center gap-1.5 rounded-full border bg-background/60 px-2.5 text-sm md:ml-0 ${player.council ? "border-amber-400/70 text-amber-200 hover:border-amber-300" : "border-border hover:border-primary"}`}
          >
            {player.council ? <Crown className="h-4 w-4 shrink-0 text-amber-300" /> : <UserRound className="h-4 w-4 shrink-0 text-primary" />}
            <span className="hidden truncate sm:inline">{player.displayName || ta.noName}</span>
            {player.council && <span className="hidden text-[11px] font-semibold text-amber-300 lg:inline">· {player.council.title}</span>}
          </Link>
        )}
      </header>

      {/* canvas */}
      <div ref={wrapRef} className="relative min-h-0 flex-1 touch-none select-none">
        <canvas ref={canvasRef} className="absolute inset-0 cursor-grab" />

        <div className="pointer-events-none absolute left-3 right-14 top-3 rounded-md md:right-auto bg-background/75 px-2.5 py-1.5 text-xs text-muted-foreground backdrop-blur">
          <div className="font-medium text-foreground">{t.stats(landPlots, city.plots.length - landPlots, city.districts.length, city.airports.length, city.stations.length)}</div>
          <div className="hidden md:block">{t.hint}</div>
        </div>

        {me && (
          <button
            onClick={findMe}
            title={tt.findMe}
            className="absolute bottom-3 left-3 flex max-w-[70%] items-center gap-2 rounded-full border border-cyan-300/50 bg-background/85 px-3 py-1.5 text-sm backdrop-blur hover:border-cyan-200"
          >
            <AvatarPreview avatar={avatar} size={22} className="-my-1 shrink-0" />
            <span className="truncate">{travelling ? tt.going : tt.youAreIn(me.district ?? city.districts[me.districtId]?.name ?? "")}</span>
          </button>
        )}

        {crowd && (
          <button
            onClick={() => setShowCrowd((v) => !v)}
            title={showCrowd ? tres.hideResidents : tres.showResidents}
            aria-pressed={showCrowd}
            className={`absolute left-3 flex max-w-[70%] items-center gap-2 rounded-full border bg-background/85 px-3 py-1 text-xs backdrop-blur ${me ? "bottom-14" : "bottom-3"} ${showCrowd ? "border-emerald-300/50" : "border-border text-muted-foreground"}`}
          >
            <span className={`h-2 w-2 shrink-0 rounded-full ${crowd.online ? "bg-emerald-400 shadow-[0_0_8px] shadow-emerald-400" : "bg-muted-foreground"}`} />
            <span className="truncate">
              {crowd.online ? tres.online(crowd.online) : tres.aloneNow}
              {crowd.recent > crowd.online && <span className="hidden sm:inline">{` · ${tres.recent(crowd.recent)}`}</span>}
            </span>
            <Users className="h-3.5 w-3.5 shrink-0 opacity-70" />
          </button>
        )}

        <div className="absolute right-3 top-3 flex flex-col gap-1.5">
          {[
            { icon: ZoomIn, label: "+", on: () => zoom(1.4) },
            { icon: ZoomOut, label: "−", on: () => zoom(1 / 1.4) },
            { icon: Maximize2, label: "fit", on: () => rendererRef.current?.fit() },
            { icon: RotateCcw, label: t.rotateLeft, on: () => rotate(-1) },
            { icon: RotateCw, label: t.rotateRight, on: () => rotate(1) },
            { icon: Landmark, label: "Second Light Tower", on: () => select({ kind: "tower", id: "second-light" }, true) },
            { icon: Building2, label: t.tower, on: () => select({ kind: "tower" }, true) },
            ...(player ? [{ icon: HelpCircle, label: tTour.label, on: () => { select(null); setTourOpen(true); } }] : []),
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

        {tourOpen && player && !selection && !plotOpen && (
          <Tour email={player.email} balance={economy.wallet?.balance ?? null} onFindMe={findMe} onClose={() => setTourOpen(false)} />
        )}

        {/* selection card: bottom sheet on phones, side card on desktop */}
        {selection && (
          <aside className="absolute inset-x-2 bottom-[max(0.5rem,env(safe-area-inset-bottom))] z-10 max-h-[50dvh] overflow-auto rounded-xl border border-border bg-background/95 p-3 shadow-2xl backdrop-blur animate-in fade-in slide-in-from-bottom-4 md:inset-x-auto md:bottom-auto md:right-16 md:top-3 md:max-h-[calc(100%-1.5rem)] md:w-80 md:p-4 md:slide-in-from-right-4 md:slide-in-from-bottom-0">
            <button onClick={() => select(null)} aria-label={t.close} className="absolute right-4 top-4 z-10 rounded-md bg-background/80 p-0.5 text-muted-foreground hover:text-foreground md:right-5 md:top-5">
              <X className="h-4 w-4" />
            </button>
            {selection.kind === "plot" && <PlotPreview world={city} plot={selection.plot} built={built} className="mb-2 h-[72px] md:mb-2.5 md:h-36" />}
            {selection.kind === "plot" ? (
              <PlotCard
                key={selection.plot.id}
                plot={selection.plot}
                world={city}
                t={t}
                te={te}
                fmt={fmt}
                onCopy={copyLink}
                onOpen={() => setPlotOpen(selection.plot)}
                tb={tb}
                owner={economy.owners.get(selection.plot.id) ?? null}
                balance={economy.wallet?.balance ?? null}
                incomeBp={economy.wallet?.params?.income_bp_per_day ?? 100}
                listed={economy.catalog === 0 || selection.plot.id < economy.catalog}
                here={me ? canBuyHere(city, net, me, selection.plot) : true}
                atPlot={me?.plotId === selection.plot.id}
                myDistrict={me ? me.district ?? city.districts[me.districtId]?.name ?? "" : ""}
                onWalk={() => void go([], selection.plot)}
                busy={travelling}
                tt={tt}
                ta={arcadeStrings(language).arcade}
                travel={
                  me && net ? (
                    <TravelOptions
                      world={city}
                      net={net}
                      me={me}
                      target={plotDistrict(city, net, me, selection.plot)}
                      balance={economy.wallet?.balance ?? null}
                      busy={travelling}
                      t={tt}
                      onGo={(legs) => void go(legs, selection.plot)}
                    />
                  ) : null
                }
                onBuy={async (plot) => {
                  if (!session) return;
                  const r = await buyPlot(session, plot.id);
                  if (!r.ok) {
                    if (r.error === "session") signOut();
                    else toast.error(te.errors[r.error]);
                  } else {
                    toast.success(te.bought(plot.address));
                    // walk onto the new land
                    if (me?.plotId !== plot.id) void go([], plot);
                  }
                  await economy.refresh();
                }}
              />
            ) : selection.kind === "hub" ? (
              (() => {
                const hub = net?.hubs.find((h) => h.id === selection.id);
                if (!hub || !net) return null;
                return (
                  <HubCard
                    hub={hub}
                    world={city}
                    net={net}
                    me={me}
                    balance={economy.wallet?.balance ?? null}
                    busy={travelling}
                    t={tt}
                    onBuy={async (h: HubInfo) => {
                      if (!session) return;
                      const r = await buyHub(session, h.id);
                      if (!r.ok) {
                        if (r.error === "session") signOut();
                        else toast.error(tt.errors[r.error]);
                      } else toast.success(tt.bought(h.name));
                      await Promise.all([economy.refresh(), loadNetwork()]);
                    }}
                    onGo={(legs) => void go(legs, null)}
                    travel={
                      me ? (
                        <TravelOptions world={city} net={net} me={me} target={hub.district} balance={economy.wallet?.balance ?? null} busy={travelling} t={tt} onGo={(legs) => void go(legs, null)} />
                      ) : null
                    }
                  />
                );
              })()
            ) : selection.kind === "civic" ? (
              <CivicCard id={selection.id} open={civicOpen.get(selection.id) ?? []} ts={ts} />
            ) : selection.kind === "tile" ? (
              <div className="space-y-2 pr-6">
                <h2 className="font-display text-lg font-bold">{t.tiles[selection.tile]}</h2>
                {selection.district >= 0 && (
                  <p className="text-sm text-muted-foreground">
                    {city.districts[selection.district].name} · {t.biomes[city.districts[selection.district].biome]}
                  </p>
                )}
                {ROAD_TILES.has(selection.tile) && selection.district >= 0 ? <RoadsHere district={selection.district} /> : <p className="text-xs text-muted-foreground">{t.wild}</p>}
                {selection.district >= 0 && me && net && net.here[String(selection.district)] ? (
                  <p className="text-xs text-cyan-200">{tt.people(net.here[String(selection.district)])}</p>
                ) : null}
                {selection.district >= 0 && me && net && (
                  me.districtId === selection.district ? (
                    <p className="text-xs font-medium text-cyan-200">{tt.here}</p>
                  ) : (
                    <TravelOptions world={city} net={net} me={me} target={selection.district} balance={economy.wallet?.balance ?? null} busy={travelling} t={tt} onGo={(legs) => void go(legs, null)} />
                  )
                )}
              </div>
            ) : (
              <TowerPanel tower={selection.id ?? "first-light"} session={session} language={language}>
                {(selection.id ?? "first-light") === "first-light" && (
                  <>
                    <p className="text-xs text-muted-foreground">
                      {t.aiStatus}: {t.aiStatusValue}
                    </p>
                    <NicsChatButton className="flex h-10 w-full items-center justify-center gap-2 rounded-md bg-cyan-400 text-sm font-semibold text-black hover:bg-cyan-300" />
                    <Link to="/state/council" className="flex items-center gap-1.5 text-sm text-amber-300 hover:underline">
                      <Crown className="h-4 w-4" />
                      {ta.councilName}
                    </Link>
                  </>
                )}
              </TowerPanel>
            )}
          </aside>
        )}
      </div>
      {plotOpen && (
        <PlotView
          world={city}
          plot={plotOpen}
          built={built}
          rules={buildRules}
          mine={myBuildings.find((m) => m.plotId === plotOpen.id) ?? null}
          owner={economy.owners.get(plotOpen.id) ?? null}
          session={session}
          t={tb}
          tw={t}
          onChanged={async () => {
            await Promise.all([loadBuilt(), economy.refresh()]);
          }}
          onClose={() => setPlotOpen(null)}
        />
      )}
    </div>
  );
};

const CIVIC_CHAMBER: Record<Exclude<CivicId, "bank">, string> = { council: "council", assembly: "assembly", directorate: "directorate", mayors: "mayors" };

/** Card of the Bank of First Light on the plaza. */
function BankCard() {
  const { t } = useBankT();
  return (
    <div className="space-y-3 pr-6">
      <div className="flex items-center gap-2">
        <Landmark className="h-5 w-5 text-amber-300" />
        <h2 className="font-display text-lg font-bold">{t.bankTitle}</h2>
      </div>
      <p className="text-sm text-muted-foreground">{t.bankIntro}</p>
      <Link to="/bank" className="flex h-10 w-full items-center justify-center gap-2 rounded-md bg-amber-400 text-sm font-semibold text-black hover:bg-amber-300">
        <Landmark className="h-4 w-4" />
        {t.openBank}
      </Link>
    </div>
  );
}

/** Card of a seat of government on the plaza: what it is, what is open, the way in. */
function CivicCard({ id, open, ts }: { id: CivicId; open: Proposal[]; ts: ReturnType<typeof stateStrings> }) {
  if (id === "bank") return <BankCard />;
  return (
    <div className="space-y-3 pr-6">
      <div className="flex items-center gap-2">
        <Landmark className={`h-5 w-5 ${id === "council" ? "text-amber-300" : "text-primary"}`} />
        <h2 className="font-display text-lg font-bold">{ts.chambers[id]}</h2>
      </div>
      <p className="text-sm text-muted-foreground">{ts.chamberAbout[id]}</p>
      {id !== "directorate" && (
        <div>
          <div className={`mb-1 text-sm font-semibold ${open.length ? "text-emerald-300" : "text-muted-foreground"}`}>{ts.openItems(open.length)}</div>
          <ul className="space-y-1 text-sm">
            {open.slice(0, 4).map((p) => (
              <li key={p.id}>
                <Link to={`/state/p/${p.id}`} className="hover:text-primary">· {p.title}</Link>
              </li>
            ))}
          </ul>
        </div>
      )}
      <Link to={`/state/${CIVIC_CHAMBER[id]}`} className="flex h-10 w-full items-center justify-center gap-2 rounded-md bg-amber-400 text-sm font-semibold text-black hover:bg-amber-300">
        <Landmark className="h-4 w-4" />
        {ts.enterChamber}
      </Link>
    </div>
  );
}

interface PlotCardProps {
  plot: Plot;
  world: World;
  t: ReturnType<typeof worldStrings>;
  te: ReturnType<typeof economyStrings>;
  fmt: (n: number) => string;
  onCopy: () => void;
  onOpen: () => void;
  tb: ReturnType<typeof buildStrings>;
  owner: PlotOwner | null;
  balance: number | null;
  incomeBp: number;
  /** In the server's land registry, so it can be bought. */
  listed: boolean;
  onBuy: (plot: Plot) => Promise<void>;
  /** The resident stands in this plot's district (land is bought only there). */
  here: boolean;
  atPlot: boolean;
  myDistrict: string;
  onWalk: () => void;
  busy: boolean;
  tt: ReturnType<typeof travelStrings>;
  /** Ways to get here, when the resident is elsewhere. */
  travel: React.ReactNode;
  /** Label of the plot's arcade. */
  ta: string;
}

function PlotCard({ plot, world, t, te, fmt, onCopy, onOpen, tb, owner, balance, incomeBp, listed, onBuy, here, atPlot, myDistrict, onWalk, busy, tt, travel, ta }: PlotCardProps) {
  const d = plot.district >= 0 ? world.districts[plot.district] : undefined;
  const price = plotPrice(world, plot);
  const [buying, setBuying] = useState(false);
  // one thing at a time, so the card never needs scrolling
  const [pane, setPane] = useState<"info" | "travel" | "arcade">("info");
  const laws = useLaws();
  const dutyPct = laws?.deal_duty_pct ?? DEFAULT_LAWS.deal_duty_pct;
  const duty = dealDuty(price, dutyPct);
  const short = balance !== null && balance < price + duty ? price + duty - balance : 0;
  const fact = (label: string, value: React.ReactNode, cls = "font-medium") => (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={`truncate text-sm ${cls}`}>{value}</dd>
    </div>
  );
  const small = "inline-flex items-center gap-1 text-xs text-cyan-200 hover:underline disabled:opacity-50";
  return (
    <div className="space-y-2 md:space-y-2.5">
      <div className="flex items-center gap-2 pr-6">
        {plot.water ? <Waves className="h-4 w-4 shrink-0 text-sky-400" /> : <MapPin className="h-4 w-4 shrink-0 text-primary" />}
        <h2 className="truncate font-display text-base font-bold md:text-lg">{plot.address}</h2>
      </div>
      {pane === "info" ? (
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 md:gap-y-1.5">
          {fact(t.district, d?.name ?? (plot.water ? t.openSea : "—"))}
          {fact(t.area, `${fmt(plot.tiles.length * TILE_M2)} ${t.m2}`)}
          {fact(
            t.status,
            owner ? (owner.mine ? te.yours : te.ownedBy(owner.name)) : t.free,
            `font-medium ${owner ? (owner.mine ? "text-amber-300" : "text-rose-300") : "text-emerald-500"}`,
          )}
          {fact(te.price, te.tide(price), "font-semibold text-cyan-200")}
        </dl>
      ) : (
        <div className="space-y-2">
          <button onClick={() => setPane("info")} className={small}>
            <ArrowLeft className="h-3.5 w-3.5" />
            {t.cardBack}
          </button>
          {pane === "travel" ? travel : <PlotArcade key={atPlot ? "at" : "away"} plotId={plot.id} />}
        </div>
      )}
      <div className="flex gap-2">
        <button onClick={onOpen} className="flex h-10 flex-1 items-center justify-center gap-2 rounded-md border border-cyan-400/60 bg-cyan-400/10 text-sm font-semibold text-cyan-100 hover:bg-cyan-400/20">
          <Maximize2 className="h-4 w-4" />
          {tb.openPlot}
        </button>
        {!owner && listed && here && (
          <button
            disabled={buying || short > 0}
            onClick={async () => {
              setBuying(true);
              await onBuy(plot);
              setBuying(false);
            }}
            className="flex h-10 flex-1 items-center justify-center gap-2 rounded-md bg-cyan-400 px-2 text-sm font-semibold text-black hover:bg-cyan-300 disabled:opacity-50"
          >
            {buying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Coins className="h-4 w-4" />}
            <span className="truncate">{buying ? te.buying : te.buy(te.tide(price))}</span>
          </button>
        )}
        {!owner && listed && !here && travel && (
          <button onClick={() => setPane("travel")} className="flex h-10 flex-1 items-center justify-center gap-2 rounded-md bg-cyan-400 px-2 text-sm font-semibold text-black hover:bg-cyan-300">
            <Footprints className="h-4 w-4" />
            {t.cardTravel}
          </button>
        )}
      </div>
      <p className="text-[11px] leading-snug text-muted-foreground md:text-xs">
        {owner
          ? te.yieldNote(dailyIncome(price, incomeBp))
          : !listed
            ? te.notListed
            : !here
              ? tt.buyHereFirst(myDistrict)
              : short > 0
                ? te.needMore(short)
                : duty > 0
                  ? te.dutyNote(duty, dutyPct)
                  : te.yieldNote(dailyIncome(price, incomeBp))}
      </p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {here && !atPlot && (
          <button disabled={busy} onClick={onWalk} className={small}>
            <Footprints className="h-3.5 w-3.5" />
            {tt.walkHere}
          </button>
        )}
        {atPlot && <span className="text-xs font-medium text-cyan-200">{tt.walked}</span>}
        {owner && !here && travel && pane !== "travel" && (
          <button onClick={() => setPane("travel")} className={small}>
            <RoadIcon className="h-3.5 w-3.5" />
            {t.cardTravel}
          </button>
        )}
        {listed && pane !== "arcade" && (
          <button onClick={() => setPane("arcade")} className={small}>
            <Gamepad2 className="h-3.5 w-3.5" />
            {ta}
          </button>
        )}
        <button onClick={onCopy} className={small}>
          <Link2 className="h-3.5 w-3.5" />
          {t.copyLink}
        </button>
      </div>
    </div>
  );
}

/** District a plot is reached through: its own, or for open water the nearest town with a harbour. */
function plotDistrict(world: World, net: NetworkInfo | null, me: Location, plot: Plot): number {
  if (plot.district >= 0) return plot.district;
  const ports = net?.hubs.filter((h) => h.kind === "port") ?? [];
  if (ports.some((h) => h.district === me.districtId)) return me.districtId;
  const near = ports.sort((a, b) => Math.hypot(a.x - plot.anchor.x, a.y - plot.anchor.y) - Math.hypot(b.x - plot.anchor.x, b.y - plot.anchor.y))[0];
  return near?.district ?? 0;
}

/** Same rule as the server: land of this district, or open water from a town with a harbour. */
function canBuyHere(world: World, net: NetworkInfo | null, me: Location, plot: Plot): boolean {
  if (plot.district >= 0) return plot.district === me.districtId;
  return !!net?.hubs.some((h) => h.kind === "port" && h.district === me.districtId);
}

export default City;
