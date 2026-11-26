/*
 * The card of a tower on the map: its floors and apartments as the old NFTs describe them
 * (one NFT, one apartment), who already lives where, and the way to swap an NFT in.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Anchor, Building2, Coins, Link2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { collectApartments, fetchTower, type TowerId, type TowerView } from "./api";
import { heritageStrings } from "./strings";
import type { Language } from "@/i18n/translations";

const en = {
  names: { "first-light": "First Light Tower", "second-light": "Second Light Tower" } as Record<TowerId, string>,
  about: {
    "first-light":
      "The heart of the world and home of NICS AI. Every apartment is one Radiant Residences NFT on Cronos, with the floor, number, view and size of the NFT.",
    "second-light":
      "The tallest tower in AquaTerra, on the lake shore of First Light City. Every apartment is one Radiant Residences Tower 2 NFT on Cronos, 1:1.",
  } as Record<TowerId, string>,
  floors: "Floors",
  apartments: "Apartments",
  owned: "Swapped in",
  income: (v: number) => `${v} TIDE a day per apartment (stores and offices x2, penthouses x5)`,
  types: "Types",
  floor: "Floor",
  free: "Free: its NFT holder can swap in",
  mine: "Yours",
  m2: (v: number) => `${v} m²`,
  beds: (v: number) => `${v} bd`,
  swap: "Swap your NFT for its apartment",
  collect: "Collect apartment income",
  collected: (net: number, tax: number) => `+${net} TIDE (tax ${tax} TIDE to the State Treasury)`,
  contract: "Contract on Cronos",
  loading: "Loading apartments…",
  none: "Apartments appear here as soon as the NFT data is loaded.",
};

export default function TowerPanel({ tower, session, language, children }: { tower: TowerId; session: string | null; language: Language; children?: ReactNode }) {
  const t = en;
  const th = heritageStrings(language);
  const [view, setView] = useState<TowerView | null>(null);
  const [failed, setFailed] = useState(false);
  const [floor, setFloor] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    setView(null);
    setFailed(false);
    setFloor(null);
    void fetchTower(tower, session).then((r) => {
      if (!live) return;
      if (r.ok) setView(r.data);
      else setFailed(true);
    });
    return () => {
      live = false;
    };
  }, [tower, session]);

  const rows = useMemo(() => view?.apartments ?? [], [view]);
  const floors = useMemo(() => [...new Set(rows.map((a) => a[1]))].sort((a, b) => b - a), [rows]);
  const types = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of rows) m.set(a[3], (m.get(a[3]) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [rows]);
  const mine = rows.filter((a) => a[8]).length;
  const shown = floor ?? floors[0] ?? null;
  const onFloor = rows.filter((a) => a[1] === shown);

  const collect = async () => {
    if (!session) return;
    setBusy(true);
    const r = await collectApartments(session);
    setBusy(false);
    if (r.ok) toast.success(t.collected(r.data.net, r.data.tax));
    else toast.error(th.errors[r.error] ?? r.error);
  };

  return (
    <div className="space-y-3 pr-6">
      <div className="flex items-center gap-2">
        <Building2 className="h-5 w-5 text-primary" />
        <h2 className="font-display text-lg font-bold">{t.names[tower]}</h2>
      </div>
      <p className="text-sm text-muted-foreground">{t.about[tower]}</p>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm">
        <dt className="text-muted-foreground">{t.floors}</dt>
        <dd className="font-medium">{view?.tower.floors ?? (tower === "first-light" ? 108 : "…")}</dd>
        <dt className="text-muted-foreground">{t.apartments}</dt>
        <dd className="font-medium">{rows.length ? rows.length.toLocaleString("en") : "…"}</dd>
        <dt className="text-muted-foreground">{t.owned}</dt>
        <dd className="font-medium">{view ? view.tower.owned.toLocaleString("en") : "…"}</dd>
      </dl>
      {view && <p className="text-xs text-muted-foreground">{t.income(view.tower.income)}</p>}
      {!view && !failed && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {t.loading}
        </p>
      )}
      {view && rows.length === 0 && <p className="text-xs text-muted-foreground">{t.none}</p>}
      {types.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {t.types}: {types.map(([k, v]) => `${k} ${v.toLocaleString("en")}`).join(" · ")}
        </p>
      )}
      {floors.length > 0 && (
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">{t.floor}</span>
            <select
              className="h-9 flex-1 rounded-md border border-border bg-background px-2 text-base md:text-sm"
              value={shown ?? ""}
              onChange={(e) => setFloor(Number(e.target.value))}
            >
              {floors.map((f) => (
                <option key={f} value={f}>
                  {f} · {rows.filter((a) => a[1] === f).length}
                </option>
              ))}
            </select>
          </label>
          <ul className="max-h-44 space-y-1 overflow-y-auto text-xs">
            {onFloor.map((a) => (
              <li key={a[0]} className={`rounded-md border px-2 py-1.5 ${a[8] ? "border-cyan-300 bg-cyan-400/10" : "border-border"}`}>
                <div className="flex justify-between gap-2">
                  <span className="font-semibold">
                    {a[2]} · {a[3]}
                  </span>
                  <span className="text-muted-foreground">#{a[0]}</span>
                </div>
                <div className="text-muted-foreground">
                  {[a[4] && `${a[4]} view`, a[5] && t.m2(a[5]), a[6] && t.beds(a[6])].filter(Boolean).join(" · ")}
                  {" · "}
                  <span className={a[8] ? "text-cyan-200" : a[7] ? "text-foreground" : ""}>{a[8] ? t.mine : a[7] ?? t.free}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
      {mine > 0 && session && (
        <button
          className="flex h-10 w-full items-center justify-center gap-2 rounded-md border border-cyan-300 text-sm font-semibold text-cyan-200 hover:bg-cyan-400/10 disabled:opacity-50"
          disabled={busy}
          onClick={() => void collect()}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Coins className="h-4 w-4" />}
          {t.collect}
        </button>
      )}
      <Link to="/heritage" className="flex items-center gap-1.5 text-sm text-cyan-300 hover:underline">
        <Anchor className="h-4 w-4" />
        {t.swap}
      </Link>
      {view?.tower.contract && (
        <a
          href={`https://explorer.cronos.org/token/${view.tower.contract}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
        >
          <Link2 className="h-4 w-4" />
          {t.contract}
        </a>
      )}
      {children}
    </div>
  );
}
