import { useState } from "react";
import { Link } from "react-router-dom";
import { BookOpen, Check, Coins, Loader2, MapPin, ScrollText } from "lucide-react";
import { toast } from "sonner";
import { useAccount } from "@/game/account/AccountContext";
import { announce, disburse, fetchCivic, fetchDistricts, fetchLaws, fetchLog, fetchState, markBuilt, type CivicStatus, type GovError, type LogEntry } from "@/game/state/api";
import { ErrorLine, Loading, Shell, useLoad, useStateT } from "@/game/state/ui";

const back = (label: string) => ({ to: "/state", label });

/** Statute book, budget lines, approved works, numbers of the state; Directorate tools for those who hold the posts. */
export const LawsPage = () => {
  const { t, date, when } = useStateT();
  const { session, signOut } = useAccount();
  const laws = useLoad(fetchLaws, []);
  const state = useLoad(fetchState, []);
  const civic = useLoad<CivicStatus | null>(async () => (session ? fetchCivic(session) : { ok: true, data: null }), [session]);
  const canPay = civic.data?.acting.includes("treasury") || civic.data?.offices.some((o) => o.post === "treasury");
  const canBuild = civic.data?.acting.includes("works") || civic.data?.offices.some((o) => o.post === "works");
  const canNotice = civic.data?.acting.includes("civic") || civic.data?.acting.includes("president") || civic.data?.offices.some((o) => o.post === "civic" || o.post === "president");
  const [notice, setNotice] = useState("");
  const fail = (e: GovError) => (e === "session" ? signOut() : toast.error(t.errors[e]));

  return (
    <Shell title={t.laws} icon={BookOpen} back={back(t.backToState)} accent="text-primary">
      {laws.error && <ErrorLine error={laws.error} retry={laws.reload} />}
      {!laws.data && !laws.error && <Loading />}
      {laws.data && (
        <div className="space-y-8">
          <section className="flex items-center gap-3 rounded-xl border border-cyan-400/40 bg-cyan-400/5 p-4">
            <Coins className="h-6 w-6 text-cyan-300" />
            <div>
              <div className="text-xs text-muted-foreground">{t.treasury}</div>
              <div className="font-display text-2xl font-bold text-cyan-100">{laws.data.treasury.toLocaleString("en")} TIDE</div>
              <div className="text-xs text-muted-foreground">{t.treasuryNote}</div>
            </div>
          </section>

          <section>
            <h2 className="mb-2 font-display text-lg font-bold">{t.statuteBook}</h2>
            {laws.data.laws.length === 0 ? <p className="text-sm text-muted-foreground">{t.noLaws}</p> : (
              <ul className="space-y-2">
                {laws.data.laws.map((l) => (
                  <li key={l.id} className="rounded-lg border border-border p-3 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <Link to={`/state/p/${l.proposal}`} className="font-semibold hover:text-primary">{l.title}</Link>
                      <span className={`text-xs ${l.inForce ? "text-emerald-300" : "text-muted-foreground"}`}>{l.inForce ? t.inForce : t.ended} · {date(l.enactedAt)}</span>
                    </div>
                    <div className="text-xs text-muted-foreground">{t.kinds[l.kind]}</div>
                    {l.body && <p className="mt-1 line-clamp-3 whitespace-pre-line text-muted-foreground">{l.body}</p>}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h2 className="mb-2 font-display text-lg font-bold">{t.budgetLines}</h2>
            {laws.data.budget.length === 0 ? <p className="text-sm text-muted-foreground">{t.noBudget}</p> : (
              <ul className="space-y-2">
                {laws.data.budget.map((b) => (
                  <li key={b.id} className="space-y-2 rounded-lg border border-border p-3 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <Link to={`/state/p/${b.proposal}`} className="font-semibold hover:text-primary">#{b.id} {b.purpose}</Link>
                      <span className="text-xs text-cyan-200">{t.allocated(b.allocated, b.spent)}</span>
                    </div>
                    {canPay && session && b.allocated > b.spent && <PayForm line={b.id} onDone={laws.reload} />}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h2 className="mb-2 font-display text-lg font-bold">{t.works}</h2>
            {laws.data.projects.length === 0 ? <p className="text-sm text-muted-foreground">{t.noWorks}</p> : (
              <ul className="space-y-2">
                {laws.data.projects.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3 text-sm">
                    <div>
                      <Link to={`/state/p/${p.proposal}`} className="font-semibold hover:text-primary">{p.title}</Link>
                      <div className="text-xs text-muted-foreground">{t.kinds[p.kind]}{p.district ? ` · ${p.district}` : ""}{p.address ? ` · ${p.address}` : ""}{p.floors ? ` · ${p.floors} ${t.floorsLabel.toLowerCase()}` : ""}</div>
                    </div>
                    {p.status === "built" ? <span className="text-xs text-emerald-300">{t.built} · {date(p.builtAt)}</span> : canBuild && session ? (
                      <button onClick={async () => { const r = await markBuilt(session, p.id); if (r.ok) void laws.reload(); else fail(r.error); }} className="inline-flex h-8 items-center gap-1 rounded-md border border-border px-2 text-xs hover:border-primary">
                        <Check className="h-3.5 w-3.5" />{t.markBuilt}
                      </button>
                    ) : <span className="text-xs text-amber-200">{t.approved} · {date(p.approvedAt)}</span>}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {canNotice && session && (
            <section className="space-y-2">
              <h2 className="font-display text-lg font-bold">{t.notice}</h2>
              <textarea value={notice} onChange={(e) => setNotice(e.target.value)} maxLength={500} rows={3} placeholder={t.noticePlaceholder} className="w-full rounded-md border border-input bg-background p-2 text-sm" />
              <button onClick={async () => { const r = await announce(session, notice); if (r.ok) { setNotice(""); toast.success(t.publish); } else fail(r.error); }} className="h-9 rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground">{t.publish}</button>
            </section>
          )}

          {state.data && (
            <section>
              <h2 className="mb-1 font-display text-lg font-bold">{t.numbers}</h2>
              <p className="mb-2 text-xs text-muted-foreground">{t.numbersNote}</p>
              <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[1fr_auto]">
                {state.data.params.map((p) => (
                  <div key={p.key} className="contents">
                    <dt className="text-muted-foreground">{p.label}</dt>
                    <dd className="font-semibold tabular-nums">{p.value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}

          {laws.data.taxes.length > 0 && (
            <section>
              <h2 className="mb-2 font-display text-lg font-bold">{t.taxes}</h2>
              <ul className="text-sm">{laws.data.taxes.map((x, i) => <li key={i}>{when(x.at)} · {x.kind} · {x.collected.toLocaleString("en")} TIDE · {x.payers}</li>)}</ul>
            </section>
          )}
        </div>
      )}
    </Shell>
  );
};

function PayForm({ line, onDone }: { line: number; onDone: () => void }) {
  const { t } = useStateT();
  const { session, signOut } = useAccount();
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (!session) return;
        setBusy(true);
        const r = await disburse(session, line, to, Number(amount), memo);
        setBusy(false);
        if (r.ok) { toast.success(t.paid); setTo(""); setAmount(""); setMemo(""); onDone(); }
        else if (r.error === "session") signOut();
        else toast.error(t.errors[r.error]);
      }}
      className="flex flex-col gap-2 sm:flex-row"
    >
      <input value={to} onChange={(e) => setTo(e.target.value)} placeholder={t.payTo} className="h-9 flex-1 rounded-md border border-input bg-background px-2" />
      <input value={amount} onChange={(e) => setAmount(e.target.value)} type="number" min={1} placeholder="TIDE" className="h-9 w-28 rounded-md border border-input bg-background px-2" />
      <input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder={t.payMemo} className="h-9 flex-1 rounded-md border border-input bg-background px-2" />
      <button disabled={busy || !to || !amount} className="inline-flex h-9 items-center justify-center gap-1 rounded-md bg-cyan-400 px-3 font-semibold text-black disabled:opacity-50">
        {busy && <Loader2 className="h-4 w-4 animate-spin" />}{t.pay}
      </button>
    </form>
  );
}

/** Every event of the state, newest first. */
export const JournalPage = () => {
  const { t, when } = useStateT();
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [more, setMore] = useState(true);
  const first = useLoad(async () => {
    const r = await fetchLog();
    if (r.ok) { setEntries(r.data.entries); setMore(r.data.entries.length === 100); }
    return r;
  }, []);
  const older = async () => {
    const r = await fetchLog(entries[entries.length - 1]?.id);
    if (r.ok) { setEntries((e) => [...e, ...r.data.entries]); setMore(r.data.entries.length === 100); }
  };
  return (
    <Shell title={t.journal} icon={ScrollText} back={back(t.backToState)} accent="text-primary">
      {first.error && <ErrorLine error={first.error} retry={first.reload} />}
      {!first.data && !first.error && <Loading />}
      <ul className="space-y-2 text-sm">
        {entries.map((e) => (
          <li key={e.id} className="flex gap-3 border-b border-border/50 pb-2">
            <span className="w-32 shrink-0 text-xs text-muted-foreground">{when(e.at)}</span>
            {e.proposal ? <Link to={`/state/p/${e.proposal}`} className="hover:text-primary">{e.text}</Link> : <span>{e.text}</span>}
          </li>
        ))}
      </ul>
      {more && entries.length > 0 && <button onClick={older} className="mt-4 text-sm text-primary hover:underline">{t.more}</button>}
    </Shell>
  );
};

/** All districts with their residents, Mayor and Assembly seat. */
export const DistrictsPage = () => {
  const { t } = useStateT();
  const d = useLoad(fetchDistricts, []);
  return (
    <Shell title={t.districtsList} icon={MapPin} back={back(t.backToState)} accent="text-primary">
      {d.error && <ErrorLine error={d.error} retry={d.reload} />}
      {!d.data && !d.error && <Loading />}
      {d.data && (
        <>
          <p className="mb-4 text-sm text-muted-foreground">{t.mayorAt(d.data.mayorAt)} · {t.seatAt(d.data.seatAt)}</p>
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead className="bg-muted/40 text-xs text-muted-foreground">
                <tr><th className="px-3 py-2">{t.districtLabel}</th><th className="px-3 py-2">{t.residents(2).replace(/^\d+ /, "")}</th><th className="px-3 py-2">{t.mayor}</th><th className="px-3 py-2">{t.deputy}</th></tr>
              </thead>
              <tbody>
                {d.data.districts.map((x) => {
                  const n = x.totalResidents ?? x.residents;
                  return (
                    <tr key={x.id} className="border-t border-border">
                      <td className="px-3 py-2"><div className="font-medium">{x.adminName && !x.governedBy ? `${x.adminName} (${x.name})` : x.name}</div><div className="text-xs text-muted-foreground">{x.land}{x.governedBy ? ` · ${t.governedBy(x.governedBy)}` : ""}</div></td>
                      <td className="px-3 py-2 tabular-nums">
                        {n}
                        {!x.governedBy && <div className="h-1 w-24 overflow-hidden rounded bg-muted"><div className="h-full bg-primary" style={{ width: `${Math.min(100, (100 * n) / d.data!.seatAt)}%` }} /></div>}
                      </td>
                      <td className="px-3 py-2">{x.mayor ?? <span className="text-muted-foreground">—</span>}</td>
                      <td className="px-3 py-2">{x.seat ? (x.seat.holder ?? <span className="text-amber-200">{t.vacant}</span>) : <span className="text-muted-foreground">—</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Shell>
  );
};
