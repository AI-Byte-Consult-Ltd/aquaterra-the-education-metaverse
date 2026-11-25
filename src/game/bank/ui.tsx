import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Bell, Gavel, Landmark, Loader2, Receipt } from "lucide-react";
import { toast } from "sonner";
import { useLanguage } from "@/i18n/LanguageContext";
import { useAccount } from "@/game/account/AccountContext";
import { useEconomy } from "@/game/economy/EconomyContext";
import { stateLocale } from "@/game/state/strings";
import {
  bid, dealDuty, fetchAdmin, fetchMe, fetchOverview, fine, minBid, payDebts, readNotices,
  type AdminView, type Auction, type BankError, type Laws, type Me, type Overview, type Result,
} from "./api";
import { bankStrings } from "./strings";

export const useBankT = () => {
  const { language } = useLanguage();
  const loc = stateLocale(language);
  const when = (iso: string | null | undefined) =>
    iso ? new Date(iso).toLocaleString(loc, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
  const date = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString(loc, { year: "numeric", month: "short", day: "numeric" }) : "");
  return { t: bankStrings(language), when, date };
};

/** Loads from the bank API and keeps the result; set() takes a fresher copy from an action. */
export function useBankLoad<T>(load: () => Promise<Result<T>> | null, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<BankError | null>(null);
  const reload = useCallback(async () => {
    const p = load();
    if (!p) return;
    const r = await p;
    if (r.ok) {
      setData(r.data);
      setError(null);
    } else setError(r.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { data, error, reload, setData };
}

/** Runs a bank action, shows errors, signs out on an ended session. */
export function useBankAction() {
  const { t } = useBankT();
  const { signOut } = useAccount();
  const { refresh } = useEconomy();
  const [busy, setBusy] = useState<string | null>(null);
  const run = async <T,>(key: string, call: () => Promise<Result<T>>, ok?: (d: T) => void) => {
    setBusy(key);
    const r = await call();
    setBusy(null);
    if (!r.ok) {
      if (r.error === "session") signOut();
      else toast.error(t.errors[r.error]);
      return null;
    }
    ok?.(r.data);
    void refresh();
    return r.data;
  };
  return { busy, run };
}

export const Panel = ({ title, icon: Icon, children, className = "" }: { title: string; icon?: typeof Landmark; children: React.ReactNode; className?: string }) => (
  <section className={`space-y-3 rounded-2xl border border-border bg-card/80 p-5 ${className}`}>
    <h2 className="flex items-center gap-2 font-display text-lg font-bold">
      {Icon && <Icon className="h-5 w-5 text-amber-300" />}
      {title}
    </h2>
    {children}
  </section>
);

const Spin = () => <Loader2 className="h-4 w-4 animate-spin" />;
const btn = "inline-flex h-9 items-center justify-center gap-1.5 rounded-md px-3 text-sm font-semibold disabled:opacity-50";
export const btnMain = `${btn} bg-amber-400 text-black hover:bg-amber-300`;
export const btnSoft = `${btn} border border-border hover:bg-muted`;
export const inputBase = "h-9 rounded-md border border-border bg-background px-2 text-sm";
export const input = `${inputBase} w-full`;

/** Wallet card: office and salary, land tax this week, debts, messages from the state. */
export function TaxesCard() {
  const { t, when } = useBankT();
  const { session } = useAccount();
  const me = useBankLoad<Me>(() => (session ? fetchMe(session) : null), [session]);
  const { busy, run } = useBankAction();
  if (!session) return null;
  const m = me.data;
  const week = m?.plots.reduce((s, p) => s + p.weeklyTax, 0) ?? 0;
  const unread = m?.notices.filter((x) => !x.read).length ?? 0;
  return (
    <Panel title={t.taxesTitle} icon={Receipt} className="md:col-span-2">
      {!m ? (
        me.error ? <p className="text-sm text-destructive">{t.errors[me.error]}</p> : <Spin />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2 text-sm">
            {m.office && <p className="text-amber-200">{t.myOffice(t.offices[m.office.office], m.office.salary)}</p>}
            <p>{t.weeklyTax(week)}</p>
            {m.plots.length > 0 && (
              <ul className="space-y-0.5 text-xs text-muted-foreground">
                {m.plots.map((p) => (
                  <li key={p.id}>
                    {p.address}: {p.taxFree ? t.taxFree : t.tide(p.weeklyTax)}
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-muted-foreground">{m.votedThisMonth ? t.voted : t.notVoted}</p>
            {m.debts.length === 0 ? (
              <p className="text-emerald-400">{t.noDebts}</p>
            ) : (
              <div className="space-y-1.5 rounded-lg border border-rose-400/40 bg-rose-500/5 p-3">
                <div className="font-semibold text-rose-200">{t.debtsTitle}</div>
                {m.debts.map((d) => (
                  <div key={d.id} className="text-xs">
                    {t.debtKinds[d.kind]}, {d.reason}: <b>{t.debtLine(d.amount - d.paid)}</b>
                    {d.penalized && ` · ${t.penalty}`}
                    {d.status === "auction" && ` · ${t.debtAuction}`}
                  </div>
                ))}
                <button disabled={busy === "pay"} className={btnMain} onClick={() => void run("pay", () => payDebts(session), (d) => {
                  toast.success(t.paidDebts(d.paid));
                  me.setData(d.me);
                })}>
                  {busy === "pay" && <Spin />}
                  {t.payNow}
                </button>
              </div>
            )}
            <div className="flex flex-wrap gap-3 pt-1 text-sm">
              <Link to="/state/charter" className="text-primary hover:underline">{t.charterLink}</Link>
              <Link to="/bank" className="text-primary hover:underline">{t.bankLink}</Link>
            </div>
          </div>
          <div>
            <div className="mb-1 flex items-center gap-2 text-sm font-semibold">
              <Bell className="h-4 w-4 text-amber-300" />
              {t.noticesTitle}
              {unread > 0 && (
                <button className="ml-auto text-xs font-normal text-primary hover:underline" onClick={() => void run("read", () => readNotices(session), (d) => me.setData(d.me))}>
                  {t.markRead}
                </button>
              )}
            </div>
            {m.notices.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t.noNotices}</p>
            ) : (
              <ul className="max-h-64 space-y-1.5 overflow-y-auto text-xs">
                {m.notices.map((x) => (
                  <li key={x.id} className={x.read ? "text-muted-foreground" : "text-foreground"}>
                    <span className="text-muted-foreground">{when(x.at)} · </span>
                    {x.text}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </Panel>
  );
}

/** Open land auctions, with a bid box for signed-in citizens. */
export function AuctionList({ auctions, laws, myBids, onBid }: { auctions: Auction[]; laws: Laws; myBids: number[]; onBid?: () => void }) {
  const { t, when } = useBankT();
  const { session } = useAccount();
  const { busy, run } = useBankAction();
  const [amounts, setAmounts] = useState<Record<number, string>>({});
  if (auctions.length === 0) return <p className="text-sm text-muted-foreground">{t.noAuctions}</p>;
  return (
    <ul className="space-y-3">
      {auctions.map((a) => {
        const low = minBid(a);
        const v = Math.trunc(Number(amounts[a.id] ?? low));
        return (
          <li key={a.id} className="rounded-lg border border-border p-3 text-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-semibold">{a.address}</span>
              <span className="text-xs text-muted-foreground">{a.district} · {t.auctionReason[a.reason]} · {t.auctionEnds(when(a.endsAt))}</span>
            </div>
            <div className="mt-1 text-xs">{t.auctionLine(a.bestBid, a.bids)}{myBids.includes(a.id) && <span className="ml-2 text-emerald-400">{t.yourBidLeads}</span>}</div>
            {session && (
              <form
                className="mt-2 flex flex-wrap items-center gap-2"
                onSubmit={(e: FormEvent) => {
                  e.preventDefault();
                  void run(`bid${a.id}`, () => bid(session, a.id, v), () => {
                    toast.success(t.bidPlaced);
                    onBid?.();
                  });
                }}
              >
                <input className={`${inputBase} w-32`} inputMode="numeric" value={amounts[a.id] ?? String(low)} onChange={(e) => setAmounts({ ...amounts, [a.id]: e.target.value })} />
                <button className={btnMain} disabled={busy === `bid${a.id}`}>
                  {busy === `bid${a.id}` ? <Spin /> : <Gavel className="h-4 w-4" />}
                  {t.doBid}
                </button>
                <span className="text-xs text-muted-foreground">{t.bidFrom(low, dealDuty(v || low, laws.deal_duty_pct ?? 2))}</span>
              </form>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** /admin: rates in force, paid offices, debts and loans, fines. */
export function AdminTreasury() {
  const { t, date } = useBankT();
  const { session } = useAccount();
  const ov = useBankLoad<Overview>(() => fetchOverview(), []);
  const ad = useBankLoad<AdminView>(() => (session ? fetchAdmin(session) : null), [session]);
  const { busy, run } = useBankAction();
  const [to, setTo] = useState("");
  const [amt, setAmt] = useState("");
  const [why, setWhy] = useState("");
  if (!session) return null;
  return (
    <div className="space-y-6">
      <div>
        <h2 className="flex items-center gap-2 font-display text-xl font-bold"><Landmark className="h-5 w-5 text-amber-300" />{t.adminTitle}</h2>
        <p className="text-sm text-muted-foreground">{t.adminIntro}</p>
      </div>
      {ov.data && (
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat label={t.flows.incomeTax} v={ov.data.income30.incomeTax} />
          <Stat label={t.flows.landTax} v={ov.data.income30.landTax} />
          <Stat label={t.flows.salaries} v={ov.data.income30.salaries} />
          <Stat label={t.reserves} v={ov.data.bank.reserves} />
          <Stat label={t.deposits} v={ov.data.bank.deposits} />
          <Stat label={t.lent} v={ov.data.bank.lent} />
        </div>
      )}
      {ov.data && (
        <div>
          <h3 className="mb-2 font-semibold">{t.lawsTitle}</h3>
          <div className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            {Object.entries(ov.data.laws).map(([k, v]) => (
              <div key={k} className="flex justify-between border-b border-border/50 py-1">
                <span className="text-muted-foreground">{t.lawLabels[k] ?? k}</span>
                <span className="font-medium">{Number(v).toLocaleString("en")}</span>
              </div>
            ))}
          </div>
          <Link to="/state/new" className="mt-2 inline-block text-sm text-primary hover:underline">{t.proposeChange}</Link>
        </div>
      )}
      {ad.error && <p className="text-sm text-destructive">{t.errors[ad.error]}</p>}
      {ad.data && (
        <div className="grid gap-6 md:grid-cols-3">
          <div>
            <h3 className="mb-2 font-semibold">{t.officialsTitle}</h3>
            {ad.data.officials.length === 0 ? <p className="text-sm text-muted-foreground">{t.none}</p> : (
              <ul className="space-y-1 text-sm">{ad.data.officials.map((o) => <li key={o.citizen + o.office}>{o.citizen}: {t.offices[o.office as keyof typeof t.offices] ?? o.office}, {t.tide(o.salary)}</li>)}</ul>
            )}
          </div>
          <div>
            <h3 className="mb-2 font-semibold">{t.openDebts}</h3>
            {ad.data.debts.length === 0 ? <p className="text-sm text-muted-foreground">{t.none}</p> : (
              <ul className="space-y-1 text-sm">{ad.data.debts.map((d) => <li key={d.id}>{d.citizen}: {t.debtKinds[d.kind]} {t.tide(d.amount - d.paid)} ({date(d.createdAt)})</li>)}</ul>
            )}
          </div>
          <div>
            <h3 className="mb-2 font-semibold">{t.openLoans}</h3>
            {ad.data.loans.length === 0 ? <p className="text-sm text-muted-foreground">{t.none}</p> : (
              <ul className="space-y-1 text-sm">{ad.data.loans.map((l) => <li key={l.id}>#{l.id} {l.borrower}: {t.loanLine(l.outstanding, l.principal)}</li>)}</ul>
            )}
          </div>
        </div>
      )}
      <form
        className="max-w-md space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          const v = Math.trunc(Number(amt));
          void run("fine", () => fine(session, to, v, why), (d) => {
            toast.success(t.fined(v, d.paid));
            setTo(""); setAmt(""); setWhy("");
            void ad.reload();
          });
        }}
      >
        <h3 className="font-semibold">{t.fineTitle}</h3>
        <input className={input} placeholder={t.fineTo} value={to} onChange={(e) => setTo(e.target.value)} />
        <input className={input} placeholder={t.amount} inputMode="numeric" value={amt} onChange={(e) => setAmt(e.target.value)} />
        <input className={input} placeholder={t.fineReason} value={why} onChange={(e) => setWhy(e.target.value)} maxLength={120} />
        <button className={btnMain} disabled={busy === "fine"}>{busy === "fine" && <Spin />}{t.doFine}</button>
      </form>
    </div>
  );
}

export const Stat = ({ label, v, sub }: { label: string; v: number; sub?: string }) => (
  <div className="rounded-xl border border-border bg-card/60 p-3">
    <div className="text-xs text-muted-foreground">{label}</div>
    <div className="font-display text-lg font-bold text-cyan-100">{v.toLocaleString("en")} TIDE</div>
    {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
  </div>
);


