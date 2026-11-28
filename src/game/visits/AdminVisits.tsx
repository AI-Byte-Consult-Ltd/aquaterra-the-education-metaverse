import { useCallback, useEffect, useState } from "react";
import { BarChart3, Loader2 } from "lucide-react";
import { useLanguage } from "@/i18n/LanguageContext";
import { useAccount } from "@/game/account/AccountContext";
import { fetchVisitStats, type VisitCount, type VisitStats, type VisitTop, type VisitsError } from "./api";
import { visitsStrings } from "./strings";

/** /admin: visitors for a day, a week and a month. The server checks the role too. */
const AdminVisits = () => {
  const { language } = useLanguage();
  const t = visitsStrings(language);
  const { session } = useAccount();
  const [data, setData] = useState<VisitStats | null>(null);
  const [error, setError] = useState<VisitsError | null>(null);

  const load = useCallback(() => {
    if (!session) return;
    setError(null);
    fetchVisitStats(session).then((r) => (r.ok ? setData(r.data) : setError(r.error)));
  }, [session]);
  useEffect(load, [load]);

  const n = (v: number) => v.toLocaleString("en");
  const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  const zone = (k: string) => (k === "(unknown)" ? t.unknown : k.replace(/_/g, " ").split("/").reverse().join(", "));
  const label = (kind: string, k: string) =>
    kind === "sources" ? (k === "(direct)" ? t.direct : k) : kind === "zones" ? zone(k) : kind === "devices" ? t.device[k] ?? t.unknown : k === "(unknown)" ? t.unknown : k;

  const Card = ({ title, c }: { title: string; c: VisitCount }) => (
    <div className="rounded-xl border border-border px-4 py-3">
      <div className="text-xs text-muted-foreground">{title}</div>
      <div className="font-display text-2xl font-bold">{n(c.visitors)} <span className="text-sm font-normal text-muted-foreground">{t.visitors}</span></div>
      <div className="text-xs text-muted-foreground">{n(c.views)} {t.views} · {n(c.residents)} {t.residents}</div>
    </div>
  );

  const List = ({ kind, rows }: { kind: string; rows?: VisitTop[] }) => {
    const max = Math.max(1, ...(rows ?? []).map((r) => r.visitors));
    return (
      <div className="rounded-xl border border-border p-3">
        <div className="mb-2 text-sm font-medium">{t[kind as "pages"]}</div>
        {!rows?.length ? (
          <p className="text-xs text-muted-foreground">—</p>
        ) : (
          <ul className="space-y-1.5">
            {rows.map((r) => (
              <li key={r.key} className="text-xs">
                <div className="flex justify-between gap-2">
                  <span className="truncate">{label(kind, r.key)}</span>
                  <span className="shrink-0 text-muted-foreground">{n(r.visitors)}</span>
                </div>
                <div className="mt-0.5 h-1 rounded bg-muted"><div className="h-1 rounded bg-primary" style={{ width: `${(r.visitors / max) * 100}%` }} /></div>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  };

  const peak = Math.max(1, ...(data?.days ?? []).map((d) => d.visitors));

  return (
    <div>
      <h2 className="flex items-center gap-2 font-display text-xl font-bold"><BarChart3 className="h-5 w-5" />{t.title}</h2>
      <p className="mb-4 text-sm text-muted-foreground">{t.intro}</p>
      {error ? (
        <p className="text-sm text-destructive">{t.errors[error]} <button onClick={load} className="text-primary hover:underline">{t.retry}</button></p>
      ) : !data ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{t.loading}</p>
      ) : (
        <>
          <div className="mb-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Card title={t.today} c={data.today} />
            <Card title={t.week} c={data.week} />
            <Card title={t.month} c={data.month} />
          </div>
          <p className="mb-4 text-xs text-muted-foreground">
            {data.since ? t.since(when(data.since)) : t.none} · {t.own(data.own_week)}
          </p>

          <div className="mb-4 rounded-xl border border-border p-3">
            <div className="mb-2 text-sm font-medium">{t.days}</div>
            <div className="flex h-24 items-end gap-1">
              {data.days.map((d) => (
                <div key={d.day} className="flex flex-1 flex-col items-center gap-1" title={`${d.day}: ${d.visitors} ${t.visitors}, ${d.views} ${t.views}`}>
                  <span className="text-[10px] text-muted-foreground">{d.visitors || ""}</span>
                  <div className="w-full rounded-t bg-primary/80" style={{ height: `${(d.visitors / peak) * 64}px`, minHeight: d.visitors ? 2 : 0 }} />
                  <span className="text-[10px] text-muted-foreground">{d.day.slice(8)}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {(["sources", "zones", "pages", "devices", "languages"] as const).map((k) => <List key={k} kind={k} rows={data.top[k]} />)}
          </div>

          <div className="overflow-x-auto rounded-xl border border-border">
            <div className="px-3 pt-3 text-sm font-medium">{t.recent}</div>
            <table className="w-full min-w-[560px] text-left text-xs">
              <thead className="text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">{t.colWhen}</th>
                  <th className="px-3 py-2 font-medium">{t.colPage}</th>
                  <th className="px-3 py-2 font-medium">{t.colFrom}</th>
                  <th className="px-3 py-2 font-medium">{t.colZone}</th>
                  <th className="px-3 py-2 font-medium">{t.colDevice}</th>
                </tr>
              </thead>
              <tbody>
                {data.recent.map((r, i) => (
                  <tr key={i} className="border-t border-border">
                    <td className="px-3 py-1.5 text-muted-foreground">{when(r.at)}</td>
                    <td className="px-3 py-1.5">{r.path}{r.resident && <span className="ml-1 text-primary">· {t.resident}</span>}</td>
                    <td className="px-3 py-1.5 text-muted-foreground">{r.source ?? t.direct}</td>
                    <td className="px-3 py-1.5 text-muted-foreground">{r.tz ? zone(r.tz) : t.unknown}</td>
                    <td className="px-3 py-1.5 text-muted-foreground">{r.device ? t.device[r.device] : t.unknown}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!data.recent.length && <p className="px-3 pb-3 text-xs text-muted-foreground">{t.none}</p>}
          </div>
        </>
      )}
    </div>
  );
};

export default AdminVisits;
