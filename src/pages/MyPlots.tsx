import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Anchor, ArrowLeft, Building2, Factory, Globe2, Home, MapPin, Search, Sprout } from "lucide-react";
import { useAccount } from "@/game/account/AccountContext";
import { useEconomy } from "@/game/economy/EconomyContext";
import { fetchMyBuildings, type MyBuilding } from "@/game/build/api";
import { fetchMyPiers, PIER_NAMES, type MyPier } from "@/game/build/piers";
import { fetchMyFarm } from "@/game/farm/api";
import { fetchCatalog } from "@/game/industry/api";
import { farmStrings, goodName } from "@/game/farm/strings";

const tfarm = farmStrings("en");

type Filter = "all" | "empty" | "built" | "farm" | "works" | "pier";

const FILTERS: [Filter, string][] = [
  ["all", "All"],
  ["empty", "Open land"],
  ["built", "Built"],
  ["farm", "Farms"],
  ["works", "Companies"],
  ["pier", "Piers"],
];

/**
 * All plots of the signed-in resident in one list: what stands on each, and the way
 * to it on the map. The world map opens one plot at a time; this is where you see them all.
 */
const MyPlots = () => {
  const { session } = useAccount();
  const { wallet } = useEconomy();
  const [buildings, setBuildings] = useState<Map<number, MyBuilding>>(new Map());
  const [piers, setPiers] = useState<Map<number, MyPier>>(new Map());
  const [farms, setFarms] = useState<Map<number, string>>(new Map());
  const [works, setWorks] = useState<Map<number, string>>(new Map());
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [district, setDistrict] = useState("");

  useEffect(() => {
    if (!session) return;
    void fetchMyBuildings(session).then((r) => r.ok && setBuildings(new Map(r.data.mine.map((b) => [b.plotId, b]))));
    void fetchMyPiers(session).then((r) => r.ok && setPiers(new Map(r.data.mine.map((p) => [p.plotId, p]))));
    void fetchMyFarm(session).then((r) => r.ok && setFarms(new Map(r.data.plots.flatMap((p) => (p.field ? [[p.plotId, goodName(tfarm, p.field.crop)] as const] : [])))));
    void fetchCatalog(session).then((r) => r.ok && setWorks(new Map((r.data.plots ?? []).flatMap((p) => (p.works ? [[p.plotId, p.works.kind] as const] : [])))));
  }, [session]);

  const plots = useMemo(() => wallet?.plots ?? [], [wallet]);
  const districts = useMemo(() => [...new Set(plots.map((p) => p.district))].sort(), [plots]);
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return plots
      .filter((p) => !district || p.district === district)
      .filter((p) => !s || p.address.toLowerCase().includes(s) || p.district.toLowerCase().includes(s))
      .filter((p) => {
        const b = buildings.has(p.id);
        const f = farms.has(p.id);
        const w = works.has(p.id);
        if (filter === "empty") return !b && !f && !w;
        if (filter === "built") return b;
        if (filter === "farm") return f;
        if (filter === "works") return w;
        if (filter === "pier") return piers.has(p.id);
        return true;
      })
      .sort((a, b) => a.district.localeCompare(b.district) || a.address.localeCompare(b.address, "en", { numeric: true }));
  }, [plots, q, filter, district, buildings, farms, works, piers]);

  if (!session) return null;
  const at = (address: string, open: boolean) => `/world?at=${encodeURIComponent(address)}${open ? "&open=1" : ""}`;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="flex items-center justify-between gap-2 px-4 py-3">
        <Link to="/world" className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
          AquaTerra
        </Link>
        <Link to="/profile" className="text-sm text-muted-foreground hover:text-foreground">
          Profile
        </Link>
      </header>
      <main className="mx-auto max-w-4xl space-y-4 px-4 pb-16">
        <section className="space-y-3 rounded-2xl border border-amber-400/30 bg-gradient-to-br from-amber-500/10 via-card/80 to-card/80 p-5">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h1 className="font-display text-2xl font-bold">My plots</h1>
              <p className="text-sm text-muted-foreground">
                {plots.length.toLocaleString("en")} plots in {districts.length} {districts.length === 1 ? "district" : "districts"} · {buildings.size} built · {farms.size} farms ·{" "}
                {works.size} companies · {piers.size} piers
              </p>
            </div>
            <Link to="/world" className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline">
              <Globe2 className="h-4 w-4" />
              All on the map
            </Link>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <label className="flex h-10 flex-1 items-center gap-2 rounded-md border border-border bg-background px-3">
              <Search className="h-4 w-4 text-muted-foreground" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Address or district" className="w-full bg-transparent text-base outline-none sm:text-sm" />
            </label>
            <select value={district} onChange={(e) => setDistrict(e.target.value)} className="h-10 rounded-md border border-border bg-background px-2 text-base sm:text-sm">
              <option value="">All districts</option>
              {districts.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {FILTERS.map(([f, label]) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                aria-pressed={filter === f}
                className={`h-8 rounded-full border px-3 text-xs ${filter === f ? "border-amber-300 bg-amber-400/20 text-amber-100" : "border-border text-muted-foreground"}`}
              >
                {label}
              </button>
            ))}
          </div>
        </section>

        {!wallet ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : plots.length === 0 ? (
          <p className="rounded-xl border border-border p-4 text-sm text-muted-foreground">
            You do not own land yet. Open the <Link to="/world" className="text-primary underline">world map</Link> and buy a plot.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {shown.map((p) => {
              const b = buildings.get(p.id);
              const pr = piers.get(p.id);
              const crop = farms.get(p.id);
              const wk = works.get(p.id);
              return (
                <li key={p.id} className="flex flex-col gap-2 rounded-lg border border-border bg-card/60 p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <MapPin className="h-4 w-4 shrink-0 text-amber-300" />
                      <span className="truncate font-medium">{p.address}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 pl-5 text-xs text-muted-foreground">
                      <span>{p.district}</span>
                      {b && (
                        <span className="flex items-center gap-1 text-cyan-200">
                          {b.kind === "tower" ? <Building2 className="h-3.5 w-3.5" /> : <Home className="h-3.5 w-3.5" />}
                          {b.kind === "tower" ? (b.floors ? `${b.floors} floors` : "Foundation") : "Cottage"}
                        </span>
                      )}
                      {crop && (
                        <span className="flex items-center gap-1 text-emerald-300">
                          <Sprout className="h-3.5 w-3.5" />
                          {crop}
                        </span>
                      )}
                      {wk && (
                        <span className="flex items-center gap-1 text-orange-300">
                          <Factory className="h-3.5 w-3.5" />
                          {wk}
                        </span>
                      )}
                      {pr && (
                        <span className="flex items-center gap-1 text-sky-300">
                          <Anchor className="h-3.5 w-3.5" />
                          {PIER_NAMES[pr.level]} · {pr.access}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-1.5 pl-5 sm:pl-0">
                    <Link to={at(p.address, false)} className="flex h-9 items-center rounded-md border border-border px-3 text-sm hover:border-primary">
                      On the map
                    </Link>
                    <Link to={at(p.address, true)} className="flex h-9 items-center rounded-md bg-cyan-400 px-3 text-sm font-semibold text-black hover:bg-cyan-300">
                      Open plot
                    </Link>
                  </div>
                </li>
              );
            })}
            {shown.length === 0 && <li className="p-3 text-sm text-muted-foreground">No plots match.</li>}
          </ul>
        )}
      </main>
    </div>
  );
};

export default MyPlots;
