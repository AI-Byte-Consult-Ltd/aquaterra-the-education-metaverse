import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useLanguage } from "@/i18n/LanguageContext";
import { useAccount } from "@/game/account/AccountContext";
import { fetchBuildAdmin, setBuildParam, type BuildAdmin, type BuildParamKey } from "./api";
import { buildStrings } from "./strings";

/** Construction rates in /admin. The founder edits them; the centre height limit and the income tax are laws. */
export default function AdminBuild({ founder }: { founder: boolean }) {
  const { language } = useLanguage();
  const t = buildStrings(language);
  const { session } = useAccount();
  const [data, setData] = useState<BuildAdmin | null>(null);
  const [failed, setFailed] = useState(false);
  const [draft, setDraft] = useState<Partial<Record<BuildParamKey, string>>>({});
  const load = useCallback(async () => {
    if (!session) return;
    const r = await fetchBuildAdmin(session);
    if (r.ok) setData(r.data);
    else setFailed(true);
  }, [session]);
  useEffect(() => {
    void load();
  }, [load]);

  if (!data)
    return failed ? <p className="text-sm text-muted-foreground">{t.serverDown}</p> : <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />;

  const save = async (key: BuildParamKey) => {
    if (!session) return;
    const r = await setBuildParam(session, key, Number(draft[key]));
    if (!r.ok) toast.error(t.errors[r.error]);
    else {
      setData(r.data);
      setDraft((d) => ({ ...d, [key]: undefined }));
      toast.success(t.saved);
    }
  };
  const keys = Object.keys(t.params) as BuildParamKey[];
  return (
    <div className="space-y-3">
      <div>
        <h2 className="font-display text-xl font-bold">{t.adminTitle}</h2>
        <p className="text-sm text-muted-foreground">{t.adminNote}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {t.adminCounts(data.counts)} · {t.adminMoney(data.spent, data.permits, data.incomeTax)}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {t.centreLimit(data.rules.centreHeight)} · {data.rules.incomeTaxPct}%
        </p>
      </div>
      <div className="grid gap-x-6 gap-y-1.5 rounded-xl border border-border p-4 md:grid-cols-2">
        {keys.map((key) => (
          <div key={key} className="flex items-center gap-2 text-sm">
            <span className="min-w-0 flex-1 text-muted-foreground">{t.params[key]}</span>
            {founder ? (
              <>
                <input
                  value={draft[key] ?? String(data.rules.params[key] ?? "")}
                  onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value.replace(/\D/g, "") }))}
                  inputMode="numeric"
                  className="h-8 w-24 rounded-md border border-input bg-background/60 px-2 text-right tabular-nums outline-none focus:border-primary"
                />
                <button onClick={() => save(key)} disabled={draft[key] === undefined} className="h-8 rounded-md border border-border px-2 text-xs hover:border-primary disabled:opacity-40">
                  {t.save}
                </button>
              </>
            ) : (
              <span className="font-medium tabular-nums">{(data.rules.params[key] ?? 0).toLocaleString("en")}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
