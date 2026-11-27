import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Crown, Loader2, Trophy } from "lucide-react";
import { useLanguage } from "@/i18n/LanguageContext";
import { useAccount } from "@/game/account/AccountContext";
import { Shell } from "@/game/state/ui";
import { fetchRichList, type RichList } from "@/game/rich/api";
import { richStrings } from "@/game/rich/strings";

const medal = ["text-amber-300", "text-slate-200", "text-orange-400"];

/** /rich: public ranking of residents by net worth, straight from the ledger. */
const Rich = () => {
  const { language } = useLanguage();
  const t = richStrings(language);
  const { session } = useAccount();
  const [list, setList] = useState<RichList | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");

  const load = useCallback(async () => {
    setState("loading");
    const r = await fetchRichList();
    setList(r);
    setState(r ? "ok" : "error");
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Shell title={t.title} icon={Trophy} back={{ to: session ? "/world" : "/", label: t.back }}>
      <p className="mb-1 text-sm text-muted-foreground">{t.intro}</p>
      <p className="mb-5 text-xs text-muted-foreground">{t.formula}</p>

      {state === "loading" && <Loader2 className="mx-auto my-10 h-6 w-6 animate-spin text-muted-foreground" />}
      {state === "error" && (
        <p className="text-sm text-red-300">
          {t.error}{" "}
          <button onClick={() => void load()} className="underline">{t.retry}</button>
        </p>
      )}

      {state === "ok" && list && (
        <>
          {list.residents.length === 0 ? (
            <p className="text-sm">{t.empty}</p>
          ) : (
            <ol className="space-y-2">
              {list.residents.map((r) => (
                <li key={r.rank} className={`flex items-center gap-3 rounded-xl border p-3 ${r.rank <= 3 ? "border-amber-400/40 bg-amber-400/5" : "border-border bg-card/60"}`}>
                  <span className={`w-8 shrink-0 text-center font-display text-xl font-bold ${medal[r.rank - 1] ?? "text-muted-foreground"}`}>{r.rank}</span>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 truncate font-semibold">
                      {r.founder && <Crown className="h-4 w-4 shrink-0 text-amber-300" aria-label={t.founder} />}
                      <span className="truncate">{r.name || t.unnamed}</span>
                      {r.handle && <span className="shrink-0 text-xs font-normal text-cyan-300/80">@{r.handle}</span>}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {[
                        `${t.tide_} ${r.tide.toLocaleString("en")}`,
                        `${t.land} ${r.land.toLocaleString("en")} · ${t.plots(r.plots)}`,
                        r.build > 0 ? `${t.buildings} ${r.build.toLocaleString("en")} · ${t.houses(r.buildings)}` : null,
                        r.deposit > 0 ? t.deposit(r.deposit) : null,
                        r.debt > 0 ? t.debt(r.debt) : null,
                      ].filter(Boolean).join("  ·  ")}
                    </p>
                  </div>
                  <span className={`shrink-0 text-right font-display text-base font-bold md:text-lg ${r.worth < 0 ? "text-red-300" : "text-foreground"}`}>{t.tide(r.worth)}</span>
                </li>
              ))}
            </ol>
          )}
          <p className="mt-3 text-xs text-muted-foreground">{t.total(list.total)} · {t.updated(list.at)}</p>
        </>
      )}

      <div className="mt-8 rounded-2xl border border-primary/40 bg-primary/5 p-5">
        {session ? (
          <Link to="/world" className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground">{t.world}</Link>
        ) : (
          <>
            <p className="mb-3 text-sm">{t.join2}</p>
            <Link to="/login?next=/world" className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground">{t.join}</Link>
          </>
        )}
      </div>
    </Shell>
  );
};

export default Rich;
