import { useCallback, useEffect, useState } from "react";
import { Loader2, ShoppingCart } from "lucide-react";
import { toast } from "sonner";
import { useLanguage } from "@/i18n/LanguageContext";
import { useAccount } from "@/game/account/AccountContext";
import { accountLocale } from "@/game/account/strings";
import { fetchExchangeAdmin, micro, setExchangeParam, setExchangeSetting, type ExchangeAdmin } from "./api";
import { exchangeStrings } from "./strings";

/** Founder's view of Tide sales: totals, the project wallet, rules and transfers to check by hand. */
const AdminExchange = ({ founder }: { founder: boolean }) => {
  const { language } = useLanguage();
  const t = exchangeStrings(language);
  const ta = t.admin;
  const { session, signOut } = useAccount();
  const [data, setData] = useState<ExchangeAdmin | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [deposit, setDeposit] = useState("");
  const [busy, setBusy] = useState(false);

  const take = useCallback(
    (r: Awaited<ReturnType<typeof fetchExchangeAdmin>>) => {
      if (r.ok) {
        setData(r.data);
        setDeposit((d) => d || r.data.settings.deposit_address || "");
        return true;
      }
      if (r.error === "session") signOut();
      else toast.error(t.errors[r.error]);
      return false;
    },
    [signOut, t],
  );

  useEffect(() => {
    if (session) void fetchExchangeAdmin(session).then(take);
  }, [session, take]);

  if (!session) return null;
  if (!data) return <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />;

  const save = async (p: Promise<Awaited<ReturnType<typeof fetchExchangeAdmin>>>) => {
    setBusy(true);
    if (take(await p)) toast.success("✓");
    setBusy(false);
  };
  const when = (iso: string) => new Date(iso).toLocaleString(accountLocale(language), { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  const s = data.sold;
  const tiles = [
    [ta.card, `${s.card.tide.toLocaleString("en")} TIDE`, `€${(s.card.eurCents / 100).toFixed(2)} · ${s.card.orders}`],
    [ta.usdt, `${s.usdt.tide.toLocaleString("en")} TIDE`, `${micro(s.usdt.micro)} USDT · ${s.usdt.orders}`],
    [ta.cro, `${s.cro.tide.toLocaleString("en")} TIDE`, `${micro(s.cro.micro)} CRO · ${s.cro.orders}`],
    [ta.market, `${s.market.tide.toLocaleString("en")} TIDE`, `fees ${s.market.fees.toLocaleString("en")} · ${s.market.trades}`],
  ];
  const keys = Object.keys(data.params).filter((k) => !k.startsWith("cro_")).sort();

  return (
    <section className="space-y-4 rounded-2xl border border-border bg-card/80 p-5">
      <h2 className="flex items-center gap-2 font-display text-lg font-bold"><ShoppingCart className="h-5 w-5 text-cyan-300" />{ta.title}</h2>
      <div className="grid gap-3 sm:grid-cols-4">
        {tiles.map(([label, big, small]) => (
          <div key={label} className="rounded-xl border border-border bg-background/50 p-3">
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className="font-display text-lg font-bold">{big}</div>
            <div className="text-xs text-muted-foreground">{small}</div>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        {ta.escrow}: {(data.escrow ?? 0).toLocaleString("en")} TIDE · {ta.lastBlock}: {data.lastBlock ?? "—"}
      </p>

      <div className="space-y-2">
        <div className="text-sm font-semibold">{ta.deposit}</div>
        <div className="flex flex-wrap gap-2">
          <input className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm" placeholder="0x…" value={deposit}
            disabled={!founder} onChange={(e) => setDeposit(e.target.value)} />
          {founder && (
            <button type="button" className="rounded-lg bg-cyan-500 px-3 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50" disabled={busy}
              onClick={() => void save(setExchangeSetting(session, "deposit_address", deposit))}>{ta.setDeposit}</button>
          )}
        </div>
      </div>

      <div>
        <div className="mb-2 text-sm font-semibold">{ta.params}</div>
        <div className="grid gap-2 sm:grid-cols-2">
          {keys.map((k) => (
            <label key={k} className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span className="font-mono">{k}</span>
              <span className="flex gap-1">
                <input className="w-28 rounded-md border border-border bg-background px-2 py-1 text-right text-sm text-foreground" disabled={!founder}
                  value={draft[k] ?? String(data.params[k])} onChange={(e) => setDraft({ ...draft, [k]: e.target.value.replace(/\D/g, "") })} />
                {founder && draft[k] !== undefined && draft[k] !== String(data.params[k]) && (
                  <button type="button" className="rounded-md border border-cyan-400 px-2 text-cyan-300" disabled={busy}
                    onClick={() => void save(setExchangeParam(session, k, Number(draft[k])))}>{ta.saveParam}</button>
                )}
              </span>
            </label>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-1 text-sm font-semibold">{ta.unmatched}</div>
        {data.unmatched.length === 0 ? <p className="text-xs text-muted-foreground">{ta.none}</p> : (
          <ul className="space-y-1 text-xs text-muted-foreground">
            {data.unmatched.map((u) => (
              <li key={u.tx} className="break-all">{when(u.seenAt)} · {u.token} {u.amount} · from {u.from} · tx {u.tx}</li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <div className="mb-1 text-sm font-semibold">{ta.orders}</div>
        <ul className="space-y-1 text-xs text-muted-foreground">
          {data.orders.map((o) => (
            <li key={o.id} className="flex justify-between gap-2">
              <span>#{o.id} {when(o.createdAt)} · {o.who} · {o.tide.toLocaleString("en")} TIDE · {o.method === "card" ? `€${(o.amount / 100).toFixed(2)}` : `${micro(o.amount)} ${o.currency}`}</span>
              <span>{t.statuses[o.status]}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
};

export default AdminExchange;
