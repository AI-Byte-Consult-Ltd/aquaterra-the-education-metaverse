import { useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { ArrowDownLeft, ArrowLeft, ArrowUpRight, Coins, Globe2, Loader2, MapPin, Send, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useLanguage } from "@/i18n/LanguageContext";
import { useAccount } from "@/game/account/AccountContext";
import { accountLocale, accountStrings } from "@/game/account/strings";
import { useEconomy } from "@/game/economy/EconomyContext";
import { claimIncome, dailyIncome, sendTide, transferFee, type EconomyError } from "@/game/economy/api";
import { economyStrings } from "@/game/economy/strings";
import BuyTide from "@/game/exchange/BuyTide";

/** Default rules, shown until the server sends its own. */
const DEFAULT_RULES = { income_bp_per_day: 100, income_cap_days: 7, transfer_fee_bp: 100 };

const Wallet = () => {
  const { language } = useLanguage();
  const t = economyStrings(language);
  const ta = accountStrings(language);
  const { session, signOut } = useAccount();
  const { wallet, refresh } = useEconomy();
  const rules = { ...DEFAULT_RULES, ...(wallet?.params ?? {}) };

  const [claiming, setClaiming] = useState(false);
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<EconomyError | null>(null);

  const pending = wallet?.plots.reduce((s, p) => s + p.pending, 0) ?? 0;
  const amt = Math.trunc(Number(amount));
  const fee = transferFee(amt, rules.transfer_fee_bp);
  const when = (iso: string) =>
    new Date(iso).toLocaleString(accountLocale(language), { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  const pct = useMemo(() => (rules.income_bp_per_day / 100).toLocaleString("en", { maximumFractionDigits: 2 }), [rules.income_bp_per_day]);

  if (!session) return null;

  const onError = (e: EconomyError) => {
    if (e === "session") signOut();
    else toast.error(t.errors[e]);
  };

  const collect = async () => {
    setClaiming(true);
    const r = await claimIncome(session);
    setClaiming(false);
    if (!r.ok) return onError(r.error);
    toast.success(t.collected(r.data.amount));
    void refresh();
  };

  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (!to.trim()) return setError("no_citizen");
    if (!Number.isInteger(amt) || amt < 1) return setError("amount");
    setError(null);
    setSending(true);
    const r = await sendTide(session, to, amt, memo);
    setSending(false);
    if (!r.ok) {
      if (r.error === "session") return signOut();
      return setError(r.error);
    }
    toast.success(t.sent(r.data.amount, r.data.to));
    setAmount("");
    setMemo("");
    void refresh();
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="flex items-center justify-between gap-2 px-4 py-3">
        <Link to="/world" className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
          {ta.brand}
        </Link>
        <Link to="/profile" className="text-sm text-muted-foreground hover:text-foreground">
          {ta.profile}
        </Link>
      </header>
      <main className="mx-auto grid max-w-4xl gap-4 px-4 pb-16 md:grid-cols-2">
        {/* balance */}
        <section className="rounded-2xl border border-cyan-400/30 bg-gradient-to-br from-cyan-500/15 via-card/80 to-card/80 p-5 md:col-span-2">
          <div className="flex items-center gap-2 text-sm text-cyan-200">
            <Coins className="h-4 w-4" />
            {t.walletTitle}
          </div>
          <div className="mt-2 flex flex-wrap items-end gap-x-3 gap-y-1">
            <span className="font-display text-4xl font-bold tabular-nums md:text-5xl">{wallet ? wallet.balance.toLocaleString("en") : "…"}</span>
            <span className="pb-1 text-lg font-semibold text-cyan-300">{t.ticker}</span>
          </div>
          {wallet?.welcomed && (
            <p className="mt-3 flex items-start gap-2 rounded-md bg-amber-400/10 p-2.5 text-sm text-amber-200">
              <Sparkles className="mt-0.5 h-4 w-4 shrink-0" />
              {t.welcome(wallet.balance)}
            </p>
          )}
          {!!wallet?.locked && <p className="mt-2 text-xs text-muted-foreground">{t.locked(wallet.locked)}</p>}
          <p className="mt-2 text-xs text-muted-foreground">{t.walletIntro}</p>
        </section>

        <BuyTide />

        {/* land and income */}
        <section className="space-y-3 rounded-2xl border border-border bg-card/80 p-5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-display text-lg font-bold">{t.myLand}</h2>
            <span className="text-sm text-muted-foreground">{wallet?.plots.length ?? 0}</span>
          </div>
          {wallet && wallet.plots.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t.noLand}</p>
          ) : (
            <ul className="max-h-64 space-y-1.5 overflow-auto">
              {wallet?.plots.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2 rounded-md bg-muted/40 px-2.5 py-2 text-sm">
                  <Link to={`/world?plot=${p.id}`} className="flex min-w-0 items-center gap-1.5 hover:text-primary">
                    <MapPin className="h-3.5 w-3.5 shrink-0 text-amber-300" />
                    <span className="truncate font-medium">{p.address}</span>
                    <span className="hidden truncate text-xs text-muted-foreground sm:inline">· {p.district}</span>
                  </Link>
                  <span className="shrink-0 text-xs text-emerald-400">{t.perDay(dailyIncome(p.pricePaid, rules.income_bp_per_day))}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-center justify-between gap-2 rounded-md border border-amber-400/30 bg-amber-400/5 px-3 py-2">
            <div>
              <div className="text-xs text-muted-foreground">{t.pending}</div>
              <div className="font-semibold tabular-nums text-amber-200">{t.tide(pending)}</div>
            </div>
            <button
              onClick={collect}
              disabled={claiming || pending < 1}
              className="flex h-9 items-center gap-1.5 rounded-md bg-amber-400 px-3 text-sm font-semibold text-black hover:bg-amber-300 disabled:opacity-40"
            >
              {claiming && <Loader2 className="h-4 w-4 animate-spin" />}
              {claiming ? t.collecting : t.collect}
            </button>
          </div>
          <p className="text-xs text-muted-foreground">{t.incomeRule(pct, rules.income_cap_days)}</p>
          <Link to="/world" className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline">
            <Globe2 className="h-4 w-4" />
            {ta.openWorld}
          </Link>
        </section>

        {/* send */}
        <section className="rounded-2xl border border-border bg-card/80 p-5">
          <h2 className="mb-3 font-display text-lg font-bold">{t.sendTitle}</h2>
          <form onSubmit={send} className="space-y-3" noValidate>
            <label className="block space-y-1">
              <span className="text-sm font-medium">{t.sendTo}</span>
              <input
                value={to}
                onChange={(e) => setTo(e.target.value)}
                maxLength={24}
                placeholder={t.sendToPlaceholder}
                className="h-10 w-full rounded-md border border-input bg-background/60 px-3 text-base outline-none focus:border-primary"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-sm font-medium">{t.sendAmount}</span>
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))}
                inputMode="numeric"
                placeholder="100"
                className="h-10 w-full rounded-md border border-input bg-background/60 px-3 text-base tabular-nums outline-none focus:border-primary"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-sm font-medium">{t.sendMemo}</span>
              <input
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                maxLength={80}
                className="h-10 w-full rounded-md border border-input bg-background/60 px-3 text-base outline-none focus:border-primary"
              />
            </label>
            {error ? (
              <p role="alert" className="text-sm text-destructive">{t.errors[error]}</p>
            ) : (
              fee > 0 && <p className="text-xs text-muted-foreground">{t.feeNote(fee)}</p>
            )}
            <button
              type="submit"
              disabled={sending}
              className="flex h-10 w-full items-center justify-center gap-2 rounded-md bg-primary text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {sending ? t.sending : t.send}
            </button>
          </form>
        </section>

        {/* history */}
        <section className="rounded-2xl border border-border bg-card/80 p-5 md:col-span-2">
          <h2 className="mb-3 font-display text-lg font-bold">{t.history}</h2>
          {wallet && wallet.history.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t.noHistory}</p>
          ) : (
            <ul className="divide-y divide-border">
              {wallet?.history.map((h) => (
                <li key={h.id} className="flex items-center gap-3 py-2 text-sm">
                  <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${h.amount > 0 ? "bg-emerald-500/15 text-emerald-400" : "bg-rose-500/15 text-rose-300"}`}>
                    {h.amount > 0 ? <ArrowDownLeft className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">
                      {t.kinds[h.kind] ?? h.kind}
                      {h.counterparty && <span className="font-normal text-muted-foreground"> · {h.counterparty}</span>}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {when(h.at)}
                      {h.memo && !["welcome", "income", "grant"].includes(h.kind) ? ` · ${h.memo}` : ""}
                    </div>
                  </div>
                  <span className={`shrink-0 font-semibold tabular-nums ${h.amount > 0 ? "text-emerald-400" : "text-rose-300"}`}>
                    {h.amount > 0 ? "+" : "−"}
                    {Math.abs(h.amount).toLocaleString("en")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
};

export default Wallet;
