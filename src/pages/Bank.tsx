import { useState } from "react";
import { Link } from "react-router-dom";
import { Building2, Coins, HandCoins, Landmark, PiggyBank } from "lucide-react";
import { toast } from "sonner";
import { useAccount } from "@/game/account/AccountContext";
import { Shell } from "@/game/state/ui";
import { borrow, deposit, fetchMe, fetchOverview, repay, withdraw, type Me, type Overview } from "@/game/bank/api";
import BuyTide from "@/game/exchange/BuyTide";
import { AuctionList, Panel, Stat, btnMain, btnSoft, input, useBankAction, useBankLoad, useBankT } from "@/game/bank/ui";

/** /bank: the Bank of First Light. Public numbers for all; deposits and loans for citizens. */
const Bank = () => {
  const { t, date } = useBankT();
  const { session } = useAccount();
  const ov = useBankLoad<Overview>(() => fetchOverview(), []);
  const me = useBankLoad<Me>(() => (session ? fetchMe(session) : null), [session]);
  const { busy, run } = useBankAction();
  const [amount, setAmount] = useState("");
  const [plotId, setPlotId] = useState<number | null>(null);
  const [loanAmt, setLoanAmt] = useState("");
  const [days, setDays] = useState("90");
  const laws = ov.data?.laws ?? {};
  const m = me.data;
  const freePlots = m?.plots.filter((p) => !p.pledged && !p.auction) ?? [];
  const chosen = freePlots.find((p) => p.id === plotId) ?? freePlots[0];
  const amt = Math.trunc(Number(amount));
  const done = (d: { me: Me }) => {
    me.setData(d.me);
    void ov.reload();
  };

  return (
    <Shell title={t.bankTitle} icon={Landmark} back={{ to: "/world", label: t.backToWorld }}>
      <p className="mb-5 max-w-2xl text-sm text-muted-foreground">{t.bankIntro}</p>
      {ov.data && (
        <div className="mb-6 grid gap-3 sm:grid-cols-3">
          <Stat label={t.reserves} v={ov.data.bank.reserves} />
          <Stat label={t.deposits} v={ov.data.bank.deposits} sub={t.savers(ov.data.bank.savers)} />
          <Stat label={t.lent} v={ov.data.bank.lent} sub={t.loansCount(ov.data.bank.loans)} />
        </div>
      )}
      {ov.error && <p className="mb-4 text-sm text-destructive">{t.errors[ov.error]}</p>}

      <div className="grid gap-4 md:grid-cols-2">
        {session && m && (
          <Panel title={t.depositTitle} icon={PiggyBank}>
            <div className="font-display text-2xl font-bold text-cyan-100">{t.tide(m.deposit.principal)}</div>
            <p className="text-xs text-muted-foreground">{t.depositRule(laws.deposit_rate_pct ?? 4)}</p>
            <p className="text-xs text-muted-foreground">{t.interestPaid(m.deposit.interestPaid)}</p>
            <div className="flex gap-2">
              <input className={input} inputMode="numeric" placeholder={t.amount} value={amount} onChange={(e) => setAmount(e.target.value)} />
              <button className={btnMain} disabled={!!busy} onClick={() => void run("dep", () => deposit(session, amt), (d) => { toast.success(t.deposited(amt)); setAmount(""); done(d); })}>
                {t.doDeposit}
              </button>
              <button className={btnSoft} disabled={!!busy} onClick={() => void run("wd", () => withdraw(session, amt), (d) => { toast.success(t.withdrawn(amt)); setAmount(""); done(d); })}>
                {t.doWithdraw}
              </button>
            </div>
          </Panel>
        )}

        {session && m && (
          <Panel title={t.loansTitle} icon={HandCoins}>
            {m.loans.length === 0 && <p className="text-sm text-muted-foreground">{t.noLoans}</p>}
            {m.loans.map((l) => (
              <div key={l.id} className="space-y-1 rounded-lg border border-border p-3 text-sm">
                <div className="flex justify-between gap-2">
                  <span className="font-semibold">#{l.id} {t.loanKinds[l.kind]}</span>
                  <span className="text-xs text-muted-foreground">{t.loanStatus[l.status]}</span>
                </div>
                <div>{t.loanLine(l.outstanding, l.principal)}</div>
                <div className="text-xs text-muted-foreground">{t.loanTerms(l.ratePct, l.repayPct, date(l.dueAt))}</div>
                {l.plot && <div className="text-xs text-muted-foreground">{t.pledge(l.plot)}</div>}
                {l.status === "open" && (
                  <div className="flex gap-2 pt-1">
                    <button className={btnSoft} disabled={!!busy || amt < 1} onClick={() => void run(`r${l.id}`, () => repay(session, l.id, amt), (d) => { toast.success(t.repaid(Math.min(amt, l.outstanding))); done(d); })}>
                      {t.repaySome} {amt > 0 ? t.tide(Math.min(amt, l.outstanding)) : ""}
                    </button>
                    <button className={btnMain} disabled={!!busy || m.free < l.outstanding} onClick={() => void run(`a${l.id}`, () => repay(session, l.id), (d) => { toast.success(t.repaid(l.outstanding)); done(d); })}>
                      {t.repayAll}
                    </button>
                  </div>
                )}
              </div>
            ))}
            <div className="space-y-2 border-t border-border pt-3">
              <h3 className="font-semibold">{t.borrowTitle}</h3>
              <p className="text-xs text-muted-foreground">{t.borrowRule(laws.loan_ltv_pct ?? 50, laws.loan_rate_pct ?? 8, laws.loan_repay_pct ?? 20, laws.loan_max_days ?? 180)}</p>
              {freePlots.length === 0 ? (
                <p className="text-xs text-muted-foreground">{t.noFreePlots}</p>
              ) : (
                <form
                  className="grid grid-cols-[1fr_6.5rem_auto] gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const v = Math.trunc(Number(loanAmt));
                    if (!chosen) return;
                    void run("borrow", () => borrow(session, chosen.id, v, Math.trunc(Number(days))), (d) => { toast.success(t.borrowed(v)); setLoanAmt(""); done(d); });
                  }}
                >
                  <select className={`${input} col-span-3`} value={chosen?.id} onChange={(e) => setPlotId(Number(e.target.value))} aria-label={t.plot}>
                    {freePlots.map((p) => (
                      <option key={p.id} value={p.id}>{p.address} ({t.maxLoan(p.maxLoan)})</option>
                    ))}
                  </select>
                  <input className={input} inputMode="numeric" placeholder={t.amount} value={loanAmt} onChange={(e) => setLoanAmt(e.target.value)} />
                  <label className="flex items-center gap-1 text-xs text-muted-foreground"><input className={input} inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} />{t.days.toLowerCase()}</label>
                  <button className={btnMain} disabled={busy === "borrow"}>{t.borrow}</button>
                </form>
              )}
              <p className="text-xs text-muted-foreground">{t.mortgageNote(laws.mortgage_pct ?? 80)}</p>
            </div>
          </Panel>
        )}

        {!session && (
          <Panel title={t.depositTitle} icon={Coins}>
            <Link to="/login" className={btnMain}>{t.signIn}</Link>
          </Panel>
        )}

        {session && (
          <div className="md:col-span-2">
            <BuyTide />
          </div>
        )}

        {ov.data?.founderLoan && (
          <Panel title={t.founderLoanTitle} icon={Building2} className="md:col-span-2">
            <p className="text-sm">{t.founderLoanText(ov.data.founderLoan.borrower, ov.data.founderLoan.principal, ov.data.founderLoan.outstanding)}</p>
            <div className="h-2 overflow-hidden rounded bg-muted">
              <div className="h-full bg-amber-400" style={{ width: `${Math.min(100, (100 * ov.data.founderLoan.repaid) / ov.data.founderLoan.principal)}%` }} />
            </div>
            <p className="text-xs text-muted-foreground">{t.loanTerms(0, ov.data.founderLoan.repayPct, date(ov.data.founderLoan.dueAt))}{ov.data.founderLoan.plot ? ` · ${t.pledge(ov.data.founderLoan.plot)}` : ""}</p>
          </Panel>
        )}

        {ov.data && (
          <Panel title={t.auctionsTitle} icon={Landmark} className="md:col-span-2">
            <AuctionList auctions={ov.data.auctions} laws={laws} myBids={m?.myBids ?? []} onBid={() => { void ov.reload(); void me.reload(); }} />
            <Link to="/state/charter" className="text-sm text-primary hover:underline">{t.charterLink}</Link>
          </Panel>
        )}
      </div>
    </Shell>
  );
};

export default Bank;
