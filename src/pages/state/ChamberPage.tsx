import { Link, Navigate, useParams } from "react-router-dom";
import { Cpu, Plus, UserRound } from "lucide-react";
import { useAccount } from "@/game/account/AccountContext";
import { CHAMBERS, fetchProposals, fetchState, isChamber, type Proposal, type StateInfo } from "@/game/state/api";
import { ErrorLine, Loading, ProposalCard, Shell, chamberIcon, useLoad, useStateT } from "@/game/state/ui";

/** One chamber: who sits there and what is before it now. Opened from the plaza on the map. */
const ChamberPage = () => {
  const { chamber } = useParams();
  const { t } = useStateT();
  const { session } = useAccount();
  const petitions = chamber === "petitions";
  const valid = petitions || isChamber(chamber);
  const state = useLoad(fetchState, []);
  const list = useLoad(() => fetchProposals(session, "all"), [session]);
  if (!valid) return <Navigate to="/state" replace />;

  const bodies: readonly string[] = petitions ? [] : CHAMBERS[chamber as keyof typeof CHAMBERS];
  const mine = (p: Proposal) => (petitions ? p.status === "signatures" : p.stages.some((s, i) => bodies.includes(s.body) && (p.status !== "voting" || i <= p.stage)));
  const all = (list.data?.proposals ?? []).filter(mine);
  const openNow = all.filter((p) => (petitions ? true : p.status === "voting" && p.stageBody && bodies.includes(p.stageBody)));
  const recent = all.filter((p) => !openNow.includes(p) && p.status !== "voting" && p.status !== "signatures").slice(0, 10);
  const update = (p: Proposal) =>
    list.setData((d) => (d ? { proposals: d.proposals.map((x) => (x.id === p.id ? p : x)) } : d));

  const key = (petitions ? "assembly" : chamber) as keyof typeof chamberIcon;
  const title = petitions ? t.statuses.signatures : t.chambers[chamber as keyof typeof t.chambers];
  return (
    <Shell title={title} icon={chamberIcon[key]} back={{ to: "/state", label: t.backToState }} accent={chamber === "council" ? "text-amber-300" : "text-primary"}>
      {!petitions && <p className="mb-5 max-w-2xl text-sm text-muted-foreground">{t.chamberAbout[chamber as keyof typeof t.chamberAbout]}</p>}
      {state.data && !petitions && <Members chamber={chamber!} s={state.data} />}

      <div className="mb-3 mt-6 flex items-center justify-between">
        <h2 className="font-display text-lg font-bold">{t.openItems(openNow.length)}</h2>
        {chamber !== "elections" && (
          <Link to="/state/new" className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground"><Plus className="h-4 w-4" />{t.newProposal}</Link>
        )}
      </div>
      {list.error && <ErrorLine error={list.error} retry={list.reload} />}
      {!list.data && !list.error && <Loading />}
      {list.data && openNow.length === 0 && <p className="text-sm text-muted-foreground">{t.noOpen}</p>}
      <div className="space-y-3">{openNow.map((p) => <ProposalCard key={p.id} p={p} onChange={update} />)}</div>

      {recent.length > 0 && (
        <>
          <h2 className="mb-3 mt-8 font-display text-lg font-bold">{t.recent}</h2>
          <div className="space-y-3">{recent.map((p) => <ProposalCard key={p.id} p={p} onChange={update} />)}</div>
        </>
      )}
    </Shell>
  );
};

function Members({ chamber, s }: { chamber: string; s: StateInfo }) {
  const { t, date } = useStateT();
  if (chamber === "council") {
    const seats = Array.from({ length: s.council.seats }, (_, i) => s.council.members.find((m) => m.seat === i + 1) ?? null);
    return (
      <>
        <p className="mb-3 text-sm text-amber-200">{t.seats(s.council.filled, s.council.seats)} · {t.councilNeed(s.council.need, s.council.filled)}</p>
        <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {seats.map((m, i) => (
            <li key={i} className={`rounded-xl border p-3 ${m ? "border-amber-400/50 bg-amber-400/5" : "border-dashed border-border text-muted-foreground"}`}>
              <div className="mb-1 flex items-center justify-between text-xs text-amber-300">
                <span>{t.seat(i + 1)}</span>
                {m && <span className="inline-flex items-center gap-1">{m.kind === "ai" ? <Cpu className="h-3.5 w-3.5" /> : <UserRound className="h-3.5 w-3.5" />}{m.kind === "ai" ? t.aiMember : m.termEnds ? t.until(date(m.termEnds)) : t.permanent}</span>}
              </div>
              <div className="font-display font-bold">{m ? m.name : t.openSeat}</div>
              {m && <div className="text-xs text-amber-200">{m.title}</div>}
            </li>
          ))}
        </ol>
      </>
    );
  }
  if (chamber === "assembly") {
    const a = s.assembly;
    return (
      <div className="space-y-2 rounded-xl border border-border bg-card/40 p-4 text-sm">
        {a.founding && (
          <p className="font-semibold text-primary">{t.foundingAssembly}: {t.foundingNote(a.foundingUntil)} {t.residents(s.residents)}.</p>
        )}
        <p>{t.seats(a.seated, a.total)}</p>
        <ul className="text-xs text-muted-foreground">
          <li>{t.districtSeatsLine(a.districtSeatsOpen, a.districtSeats)}</li>
          <li>{t.lotLine(a.lotDrawn, a.lotSeats)}</li>
          <li>{t.guildLine(a.guildSeats)}</li>
        </ul>
        {a.members.length > 0 && (
          <ul className="mt-2 grid gap-1 sm:grid-cols-2">
            {a.members.map((m, i) => <li key={i}>{m.name} <span className="text-xs text-muted-foreground">· {m.district ?? "lot"}</span></li>)}
          </ul>
        )}
        <Link to="/state/districts" className="inline-block text-primary hover:underline">{t.districtsList} →</Link>
      </div>
    );
  }
  if (chamber === "directorate") {
    return (
      <ul className="grid gap-2 sm:grid-cols-2">
        {s.directorate.map((d) => (
          <li key={d.post} className="rounded-xl border border-border bg-card/40 p-3">
            <div className="text-xs text-muted-foreground">{d.title}</div>
            <div className="font-display font-bold">{d.holder ?? t.vacant}</div>
            {d.termEnds && d.holder && <div className="text-xs text-muted-foreground">{t.until(date(d.termEnds))}</div>}
          </li>
        ))}
      </ul>
    );
  }
  if (chamber === "mayors") {
    return (
      <p className="text-sm text-muted-foreground">
        {s.mayors} / {s.districts} · <Link to="/state/districts" className="text-primary hover:underline">{t.districtsList} →</Link>
      </p>
    );
  }
  return null;
}

export default ChamberPage;
