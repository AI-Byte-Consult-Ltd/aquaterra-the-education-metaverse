import { useParams } from "react-router-dom";
import { Cpu, ScrollText } from "lucide-react";
import { useAccount } from "@/game/account/AccountContext";
import { fetchProposal } from "@/game/state/api";
import { ErrorLine, Loading, Path, Shell, StatusPill, VoteBox, useLoad, useStateT } from "@/game/state/ui";

/** One proposal or election: its path, the vote, the roll call and the result. */
const ProposalPage = () => {
  const { id } = useParams();
  const { t, date, when } = useStateT();
  const { session } = useAccount();
  const pid = Number(id);
  const load = useLoad(() => fetchProposal(session, pid), [session, pid]);
  const p = load.data?.proposal;
  const pay = p?.payload ?? {};
  return (
    <Shell title={p ? p.title : t.loading} icon={ScrollText} back={{ to: "/state", label: t.backToState }} accent="text-primary">
      {load.error && <ErrorLine error={load.error} retry={load.reload} />}
      {!p && !load.error && <Loading />}
      {p && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <StatusPill p={p} t={t} />
            <span>{t.kinds[p.kind]} · #{p.id}</span>
            {p.author && <span>· {t.proposedBy(p.author)} {t.startedAt(date(p.createdAt))}</span>}
          </div>
          {p.body && <p className="whitespace-pre-line text-sm">{p.body}</p>}
          <Details kind={p.kind} pay={pay} />
          <div>
            <h2 className="mb-1 text-sm font-semibold">{t.path}</h2>
            <Path p={p} t={t} />
          </div>

          {(p.status === "voting" || p.status === "signatures") && (
            <section className="rounded-xl border border-cyan-400/40 bg-cyan-400/5 p-4">
              <h2 className="mb-2 font-display font-bold">{p.status === "signatures" ? t.statuses.signatures : p.stageBody ? t.bodies[p.stageBody] : ""}</h2>
              <VoteBox p={p} onChange={(np) => load.setData({ proposal: np })} />
            </section>
          )}

          {p.kind === "election" && (p.candidateList?.length ?? 0) > 0 && (p.status !== "voting" || p.stageBody === "nomination") && (
            <section>
              <h2 className="mb-2 font-display font-bold">{t.candidates}</h2>
              <ul className="space-y-1.5">
                {p.candidateList!.map((c) => (
                  <li key={c.n} className="flex items-center justify-between rounded-lg border border-border p-2 text-sm">
                    <span><span className="font-medium">{c.name}</span>{c.statement && <span className="text-muted-foreground"> · {c.statement}</span>}</span>
                    {c.votes != null && <span className="text-muted-foreground">{t.votesN(c.votes)}</span>}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {p.kind === "election" && p.status === "voting" && p.stageBody === "nomination" && (p.candidateList?.length ?? 0) === 0 && (
            <p className="text-sm text-muted-foreground">{t.noCandidates}</p>
          )}

          {p.results.length > 0 && (
            <section>
              <h2 className="mb-2 font-display font-bold">{t.recent}</h2>
              <ul className="space-y-1.5 text-sm">
                {p.results.map((r, i) => (
                  <li key={i} className="rounded-lg border border-border p-2">
                    <span className="font-medium">{t.bodies[r.body]}</span>{" "}
                    <span className="text-muted-foreground">· {when(r.at)} · </span>
                    {r.skipped ? t.stageSkipped : r.winners ? r.winners.join(", ") || "—" : (
                      <>
                        {t.tallyLine(r.yes ?? 0, r.no ?? 0, r.abstain ?? 0, r.electorate ?? 0)} ·{" "}
                        <span className={r.passed ? "text-emerald-300" : "text-rose-300"}>{r.rule === "advisory" ? t.rules.advisory : r.passed ? t.statuses.passed : t.statuses.rejected}</span>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {p.outcome && (
            <p className="rounded-lg bg-muted/50 p-3 text-sm"><span className="font-semibold">{t.outcome}: </span>{p.outcome}</p>
          )}

          {(p.rollCall?.length ?? 0) > 0 && (
            <section>
              <h2 className="mb-1 font-display font-bold">{t.rollCall}</h2>
              <p className="mb-2 text-xs text-muted-foreground">{t.rollCallNote}</p>
              <ul className="space-y-1 text-sm">
                {p.rollCall!.map((v, i) => (
                  <li key={i} className={v.ai ? "rounded-md bg-cyan-400/10 p-2" : ""}>
                    <span className="text-xs text-muted-foreground">{t.bodies[p.stages[v.stage].body]} · </span>
                    {v.ai && <Cpu className="mr-1 inline h-3.5 w-3.5 text-cyan-300" />}
                    <span className="font-medium">{v.name}</span>:{" "}
                    <span className={v.choice === "yes" ? "text-emerald-300" : v.choice === "no" ? "text-rose-300" : "text-muted-foreground"}>
                      {v.choice === "yes" ? t.yes : v.choice === "no" ? t.no : t.abstain}
                    </span>
                    {v.reason && <span className="text-muted-foreground"> · {v.reason}</span>}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </Shell>
  );
};

function Details({ kind, pay }: { kind: string; pay: Record<string, unknown> }) {
  const { t } = useStateT();
  const rows: [string, string][] = [];
  const v = (k: string) => (pay[k] == null || pay[k] === "" ? null : String(pay[k]));
  if (kind === "set_param") rows.push([String(pay.label ?? pay.key), `${v("current")} → ${v("value")}`]);
  if (kind === "budget") rows.push([t.amountLabel, Number(pay.amount).toLocaleString("en")]);
  if (v("districtName")) rows.push([t.districtLabel, v("districtName")!]);
  if (v("intoName")) rows.push([t.intoLabel, v("intoName")!]);
  if (v("address")) rows.push([t.addressLabel, v("address")!]);
  if (v("floors")) rows.push([t.floorsLabel, v("floors")!]);
  if (kind === "new_district") {
    rows.push([t.districtNameLabel, v("name") ?? ""]);
    if (v("land")) rows.push([t.landLabel, v("land")!]);
    if (v("climate")) rows.push([t.climateLabel, v("climate")!]);
  } else if (kind === "district_merge" && v("name")) rows.push([t.newNameLabel, v("name")!]);
  if (kind === "appoint_director") rows.push([t.posts[pay.post as keyof typeof t.posts] ?? "", v("name") ?? ""]);
  if (kind === "dismiss") rows.push([String(pay.office), v("name") ?? ""]);
  if (!rows.length) return null;
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-lg border border-border p-3 text-sm">
      {rows.map(([a, b]) => (
        <div key={a} className="contents">
          <dt className="text-muted-foreground">{a}</dt>
          <dd className="font-medium">{b}</dd>
        </div>
      ))}
    </dl>
  );
}

export default ProposalPage;
