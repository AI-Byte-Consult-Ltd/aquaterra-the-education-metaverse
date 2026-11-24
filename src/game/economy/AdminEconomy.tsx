import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Coins, Landmark, Loader2, Scale } from "lucide-react";
import { toast } from "sonner";
import { useLanguage } from "@/i18n/LanguageContext";
import { useAccount } from "@/game/account/AccountContext";
import { accountLocale } from "@/game/account/strings";
import { fetchOverview, grantTide, setParam, type EconomyError, type EconomyOverview, type EconomyParams } from "./api";
import { useEconomy } from "./EconomyContext";
import { economyStrings } from "./strings";

const EDITABLE: (keyof EconomyParams)[] = ["welcome_grant", "income_bp_per_day", "income_cap_days", "transfer_fee_bp", "max_plots_per_citizen", "max_grant"];

/** Founder and admins see the ledger; only the founder can grant and change rules (the server checks). */
const AdminEconomy = ({ founder }: { founder: boolean }) => {
  const { language } = useLanguage();
  const t = economyStrings(language);
  const { session, signOut } = useAccount();
  const { refresh } = useEconomy();
  const [data, setData] = useState<EconomyOverview | null>(null);
  const [error, setError] = useState<EconomyError | null>(null);
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Partial<Record<keyof EconomyParams, string>>>({});

  const handle = useCallback(
    (r: Awaited<ReturnType<typeof fetchOverview>>) => {
      if (r.ok) {
        setData(r.data);
        setError(null);
        return true;
      }
      if (r.error === "session") signOut();
      else setError(r.error);
      return false;
    },
    [signOut],
  );

  useEffect(() => {
    if (session) void fetchOverview(session).then(handle);
  }, [session, handle]);

  if (!session) return null;
  const n = (v: number) => v.toLocaleString("en");
  const when = (iso: string) => new Date(iso).toLocaleString(accountLocale(language), { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

  const grant = async (e: FormEvent) => {
    e.preventDefault();
    const amt = Math.trunc(Number(amount));
    if (!to.trim() || !(amt >= 1)) return toast.error(t.errors.amount);
    setBusy(true);
    const r = await grantTide(session, to, amt, memo);
    setBusy(false);
    if (handle(r)) {
      toast.success(`${t.granted}: ${t.tide(amt)}`);
      setAmount("");
      setMemo("");
      void refresh();
    } else if (!r.ok) toast.error(t.errors[r.error]);
  };

  const save = async (key: keyof EconomyParams) => {
    const v = Math.trunc(Number(draft[key]));
    if (!Number.isFinite(v) || v < 0) return toast.error(t.errors.amount);
    const r = await setParam(session, key, v);
    if (handle(r)) {
      toast.success(t.paramLabels[key as keyof typeof t.paramLabels]);
      setDraft((d) => ({ ...d, [key]: undefined }));
    } else if (!r.ok) toast.error(t.errors[r.error]);
  };

  if (error && !data) return <p className="text-sm text-destructive">{t.errors[error]}</p>;
  if (!data)
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />…
      </p>
    );

  const circulating = data.supply - data.treasury - data.stateTreasury;
  const tiles = [
    { icon: Landmark, label: t.reserve, value: data.treasury },
    { icon: Scale, label: t.stateTreasury, value: data.stateTreasury },
    { icon: Coins, label: t.inCirculation, value: circulating },
    { icon: Coins, label: t.landSales, value: data.landSales },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-display text-xl font-bold">{t.adminTitle}</h2>
        <p className="text-sm text-muted-foreground">{t.adminIntro}</p>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {tiles.map(({ icon: Icon, label, value }) => (
          <div key={label} className="rounded-xl border border-border px-4 py-3">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Icon className="h-3.5 w-3.5" />
              {label}
            </div>
            <div className="font-display text-xl font-bold tabular-nums">{n(value)}</div>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        {t.supply}: {t.tide(data.supply)} · {t.plotsSold(data.plotsSold, data.catalog)} · {data.wallets} wallets
      </p>

      <div className="grid gap-4 md:grid-cols-2">
        {founder && (
          <form onSubmit={grant} className="space-y-2 rounded-xl border border-border p-4">
            <h3 className="font-semibold">{t.grantTitle}</h3>
            <input value={to} onChange={(e) => setTo(e.target.value)} placeholder={t.grantTo} className="h-9 w-full rounded-md border border-input bg-background/60 px-3 text-sm outline-none focus:border-primary" />
            <div className="flex gap-2">
              <input value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))} inputMode="numeric" placeholder="1000" className="h-9 w-28 rounded-md border border-input bg-background/60 px-3 text-sm tabular-nums outline-none focus:border-primary" />
              <input value={memo} onChange={(e) => setMemo(e.target.value)} maxLength={80} placeholder={t.sendMemo} className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background/60 px-3 text-sm outline-none focus:border-primary" />
            </div>
            <button type="submit" disabled={busy} className="flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-60">
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {t.grant}
            </button>
          </form>
        )}
        <div className="space-y-2 rounded-xl border border-border p-4">
          <h3 className="font-semibold">{t.paramsTitle}</h3>
          {EDITABLE.map((key) => (
            <div key={key} className="flex items-center gap-2 text-sm">
              <span className="min-w-0 flex-1 text-muted-foreground">{t.paramLabels[key as keyof typeof t.paramLabels]}</span>
              {founder ? (
                <>
                  <input
                    value={draft[key] ?? String(data.params[key] ?? "")}
                    onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value.replace(/\D/g, "") }))}
                    inputMode="numeric"
                    className="h-8 w-24 rounded-md border border-input bg-background/60 px-2 text-right tabular-nums outline-none focus:border-primary"
                  />
                  <button onClick={() => save(key)} disabled={draft[key] === undefined} className="h-8 rounded-md border border-border px-2 text-xs hover:border-primary disabled:opacity-40">
                    {t.saveParam}
                  </button>
                </>
              ) : (
                <span className="font-medium tabular-nums">{n(data.params[key] ?? 0)}</span>
              )}
            </div>
          ))}
          <p className="text-xs text-muted-foreground">{t.paramsNote}</p>
        </div>
      </div>

      <div>
        <h3 className="mb-2 font-semibold">{t.holders}</h3>
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[520px] text-left text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Email</th>
                <th className="px-3 py-2 text-right font-medium">{t.colBalance}</th>
                <th className="px-3 py-2 text-right font-medium">{t.colPlots}</th>
              </tr>
            </thead>
            <tbody>
              {data.holders.map((h) => (
                <tr key={h.email} className="border-t border-border">
                  <td className="px-3 py-2 font-medium">{h.name}</td>
                  <td className="px-3 py-2 text-muted-foreground">{h.email}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{n(h.balance)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{h.plots}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h3 className="mb-2 font-semibold">{t.ledgerTitle}</h3>
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">{t.colWhen}</th>
                <th className="px-3 py-2 font-medium">{t.colKind}</th>
                <th className="px-3 py-2 font-medium">{t.colFrom}</th>
                <th className="px-3 py-2 font-medium">{t.colTo}</th>
                <th className="px-3 py-2 text-right font-medium">{t.colAmount}</th>
              </tr>
            </thead>
            <tbody>
              {data.ledger.map((l) => (
                <tr key={l.id} className="border-t border-border">
                  <td className="px-3 py-2 text-muted-foreground">{when(l.at)}</td>
                  <td className="px-3 py-2">{t.kinds[l.kind] ?? l.kind}{l.memo ? <span className="text-muted-foreground"> · {l.memo}</span> : null}</td>
                  <td className="px-3 py-2">{l.from ?? "—"}</td>
                  <td className="px-3 py-2">{l.to ?? "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{n(l.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default AdminEconomy;
