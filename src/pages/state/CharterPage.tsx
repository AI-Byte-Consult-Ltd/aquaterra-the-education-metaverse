import { Link } from "react-router-dom";
import { Coins, Gavel, Landmark, Receipt, ScrollText, Scale, ShieldCheck } from "lucide-react";
import { useAccount } from "@/game/account/AccountContext";
import { Loading, Shell } from "@/game/state/ui";
import { fetchMe, fetchOverview, type Me, type Overview } from "@/game/bank/api";
import { AuctionList, Panel, useBankLoad, useBankT } from "@/game/bank/ui";

/** /state/charter: rights and duties of citizens, taxes, salaries and the treasury, from the laws in force. */
export const CharterPage = () => {
  const { t } = useBankT();
  const { session } = useAccount();
  const ov = useBankLoad<Overview>(() => fetchOverview(), []);
  const me = useBankLoad<Me>(() => (session ? fetchMe(session) : null), [session]);
  const L = ov.data?.laws;
  const v = (k: keyof NonNullable<typeof L>, d: number) => Number(L?.[k] ?? d);

  return (
    <Shell title={t.charterTitle} icon={ScrollText} back={{ to: "/state", label: t.backToState }}>
      <p className="mb-5 max-w-2xl text-sm text-muted-foreground">{t.charterIntro}</p>
      {!ov.data && !ov.error && <Loading />}
      {ov.error && <p className="text-sm text-destructive">{t.errors[ov.error]}</p>}
      {ov.data && (
        <div className="grid gap-4 md:grid-cols-2">
          <Panel title={t.rightsTitle} icon={ShieldCheck}>
            <ul className="list-disc space-y-1 pl-5 text-sm">{t.rights.map((r) => <li key={r}>{r}</li>)}</ul>
          </Panel>
          <Panel title={t.dutiesTitle} icon={Scale}>
            <ul className="list-disc space-y-1 pl-5 text-sm">{t.duties(v("civic_bonus", 25)).map((r) => <li key={r}>{r}</li>)}</ul>
            {me.data && <p className={`text-xs ${me.data.votedThisMonth ? "text-emerald-400" : "text-muted-foreground"}`}>{me.data.votedThisMonth ? t.voted : t.notVoted}</p>}
          </Panel>
          <Panel title={t.paymentsTitle} icon={Receipt} className="md:col-span-2">
            <ul className="list-disc space-y-1.5 pl-5 text-sm">
              <li>{t.pays.income(v("income_tax_pct", 10))}</li>
              <li>{t.pays.prizes(v("arcade_prize_tax_pct", 10), v("rent_tax_pct", 10))}</li>
              <li>{t.pays.land(v("land_tax_week_bp", 20), v("land_tax_free_plots", 1))}</li>
              <li>{t.pays.debt(v("debt_grace_days", 14), v("debt_penalty_pct", 5), v("debt_auction_days", 30))}</li>
              <li>{t.pays.duty(v("deal_duty_pct", 2))}</li>
              <li>{t.pays.sales(v("sales_tax_pct", 3))}</li>
              <li>{t.pays.travel(v("travel_tax_pct", 10))}</li>
              <li>{t.pays.fines(v("fine_max", 1000))}</li>
            </ul>
            <Link to="/state/new" className="text-sm text-primary hover:underline">{t.proposeChange}</Link>
          </Panel>
          <Panel title={t.salariesTitle} icon={Coins}>
            <table className="w-full text-sm">
              <tbody>
                {t.salaryRows({ c: v("salary_council", 50), d: v("salary_directorate", 40), a: v("salary_assembly", 20), m: v("salary_mayor", 20), ai: v("salary_nics_ai", 50) }).map(([k, x]) => (
                  <tr key={k} className="border-b border-border/50"><td className="py-1 text-muted-foreground">{k}</td><td className="py-1 text-right font-medium">{x}</td></tr>
                ))}
              </tbody>
            </table>
            <p className="text-xs text-muted-foreground">{t.salaryNote}</p>
          </Panel>
          <Panel title={t.treasuryTitle} icon={Landmark}>
            <p className="font-display text-xl font-bold text-cyan-100">{t.treasuryNow(ov.data.treasury)}</p>
            <table className="w-full text-sm">
              <tbody>
                {(Object.keys(t.flows) as (keyof typeof t.flows)[]).map((k) => (
                  <tr key={k} className="border-b border-border/50"><td className="py-1 text-muted-foreground">{t.flows[k]}</td><td className="py-1 text-right font-medium">{t.tide(ov.data!.income30[k])}</td></tr>
                ))}
              </tbody>
            </table>
            <p className="text-xs text-muted-foreground">{t.nicsFund(ov.data.nicsFund)}</p>
            <Link to="/state/journal" className="text-sm text-primary hover:underline">{t.journal}</Link>
          </Panel>
          <Panel title={t.auctionsTitle} icon={Gavel} className="md:col-span-2">
            <AuctionList auctions={ov.data.auctions} laws={ov.data.laws} myBids={me.data?.myBids ?? []} onBid={() => { void ov.reload(); void me.reload(); }} />
            <Link to="/bank" className="text-sm text-primary hover:underline">{t.bankLink}</Link>
          </Panel>
        </div>
      )}
    </Shell>
  );
};
