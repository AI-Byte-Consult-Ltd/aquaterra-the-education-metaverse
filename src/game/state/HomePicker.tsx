import { useMemo, useState } from "react";
import { Check, Loader2, MapPin, Search } from "lucide-react";
import { useAccount } from "@/game/account/AccountContext";
import { fetchDistricts, setResidence, skipResidence, type CivicStatus } from "./api";
import { useLoad, useStateT } from "./ui";

/**
 * Sign-up step after the name: the citizen picks a home district.
 * Skipping makes First Light City the home; the server lets the first real choice through without the 30-day wait.
 */
export default function HomePicker({ onDone }: { onDone: (c: CivicStatus) => void }) {
  const { t } = useStateT();
  const { session, signOut } = useAccount();
  const list = useLoad(fetchDistricts, []);
  const [pick, setPick] = useState<number | null>(null);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<"pick" | "skip" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const groups = useMemo(() => {
    const ds = (list.data?.districts ?? []).filter((d) => !d.governedBy || d.governedBy === d.name);
    const term = q.trim().toLowerCase();
    const shown = term ? ds.filter((d) => d.name.toLowerCase().includes(term) || d.land.toLowerCase().includes(term)) : ds;
    const by = new Map<string, typeof ds>();
    for (const d of [...shown].sort((a, b) => Number(b.capital) - Number(a.capital) || a.id - b.id)) {
      by.set(d.land, [...(by.get(d.land) ?? []), d]);
    }
    return [...by.entries()];
  }, [list.data, q]);

  const send = async (kind: "pick" | "skip") => {
    if (!session || busy) return;
    setBusy(kind);
    setError(null);
    const r = kind === "skip" || pick === null ? await skipResidence(session) : await setResidence(session, pick);
    setBusy(null);
    if (r.ok) onDone(r.data);
    else if (r.error === "session") signOut();
    else setError(t.errors[r.error]);
  };

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <h1 className="flex items-center gap-2 font-display text-2xl font-bold"><MapPin className="h-6 w-6 text-primary" />{t.pickHomeTitle}</h1>
        <p className="text-sm text-muted-foreground">{t.pickHomeIntro}</p>
      </div>
      <label className="relative block">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t.pickHomeSearch}
          aria-label={t.pickHomeSearch}
          className="h-10 w-full rounded-md border border-input bg-background/60 pl-9 pr-3 text-sm outline-none focus:border-primary"
        />
      </label>
      <div className="max-h-[45vh] space-y-3 overflow-y-auto pr-1">
        {!list.data && !list.error && <p className="text-sm text-muted-foreground">{t.loading}</p>}
        {list.error && <p className="text-sm text-destructive">{t.errors[list.error]}</p>}
        {groups.map(([land, ds]) => (
          <div key={land}>
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{land}</div>
            <div className="grid grid-cols-2 gap-1.5">
              {ds.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => setPick(d.id)}
                  aria-pressed={pick === d.id}
                  className={`flex items-center justify-between gap-1 rounded-md border px-2.5 py-2 text-left text-sm ${pick === d.id ? "border-primary bg-primary/15 text-foreground" : "border-border hover:border-primary/60"}`}
                >
                  <span className="min-w-0 truncate">{d.name}</span>
                  {pick === d.id ? <Check className="h-4 w-4 shrink-0 text-primary" /> : d.capital && <span className="hidden shrink-0 text-[10px] text-amber-300 sm:inline">{t.capitalTag}</span>}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex flex-col gap-2">
        <button
          type="button"
          disabled={pick === null || !!busy}
          onClick={() => send("pick")}
          className="flex h-11 items-center justify-center gap-2 rounded-md bg-primary text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {busy === "pick" && <Loader2 className="h-4 w-4 animate-spin" />}
          {t.makeHome}
        </button>
        <button
          type="button"
          disabled={!!busy}
          onClick={() => send("skip")}
          className="flex h-10 items-center justify-center gap-2 rounded-md border border-border text-sm text-muted-foreground hover:text-foreground disabled:opacity-50"
        >
          {busy === "skip" && <Loader2 className="h-4 w-4 animate-spin" />}
          {t.pickHomeSkip}
        </button>
      </div>
    </div>
  );
}
