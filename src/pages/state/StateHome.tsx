import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { BookOpen, ChevronDown, Coins, Cpu, Landmark, Loader2, MapPin, Plus, ScrollText, UserRound } from "lucide-react";
import { toast } from "sonner";
import { useAccount } from "@/game/account/AccountContext";
import { NicsChatButton } from "@/game/nics/NicsChat";
import { CHAMBERS, fetchCivic, fetchDistricts, fetchLog, fetchProposals, fetchState, setResidence, type Chamber, type CivicStatus, type DistrictInfo } from "@/game/state/api";
import { ErrorLine, Loading, Shell, chamberIcon, chamberOf, useLoad, useStateT } from "@/game/state/ui";

/** The Commonwealth: your citizenship, the chambers, the treasury and the journal. */
const StateHome = () => {
  const { t, date, when } = useStateT();
  const { session, player } = useAccount();
  const state = useLoad(fetchState, []);
  const open = useLoad(() => fetchProposals(session, "open"), [session]);
  const log = useLoad(() => fetchLog(), []);
  const districts = useLoad(fetchDistricts, []);
  const civic = useLoad<CivicStatus | null>(async () => (session ? fetchCivic(session) : { ok: true, data: null }), [session]);

  const counts = useMemo(() => {
    const c: Partial<Record<Chamber, number>> = {};
    for (const p of open.data?.proposals ?? []) {
      const ch = p.status === "signatures" ? null : chamberOf(p.stageBody);
      if (ch) c[ch] = (c[ch] ?? 0) + 1;
    }
    return c;
  }, [open.data]);
  const petitions = (open.data?.proposals ?? []).filter((p) => p.status === "signatures").length;

  const s = state.data;
  return (
    <Shell title={t.commonwealth} icon={Landmark}>
      <p className="mb-3 max-w-2xl text-sm text-muted-foreground">{t.intro}</p>
      <div className="mb-6"><NicsChatButton className="inline-flex h-9 items-center gap-2 rounded-md border border-cyan-300/50 bg-cyan-400/10 px-3 text-sm font-semibold text-cyan-200 hover:border-cyan-200" /></div>

      {/* citizenship */}
      <section className="mb-6 rounded-xl border border-border bg-card/40 p-4">
        <h2 className="mb-2 flex items-center gap-2 font-display text-lg font-bold"><UserRound className="h-5 w-5 text-primary" />{t.yourCitizenship}</h2>
        {!session ? (
          <Link to="/login?next=/state" className="inline-flex h-9 items-center rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground">{t.signInToVote}</Link>
        ) : !civic.data ? (
          civic.error ? <ErrorLine error={civic.error} retry={civic.reload} /> : <Loading />
        ) : (
          <Citizenship civic={civic.data} districts={districts.data?.districts ?? []} onSaved={(c) => { civic.setData(c); void state.reload(); void open.reload(); }} named={!!player?.displayName} />
        )}
      </section>

      {/* chambers */}
      {state.error && <ErrorLine error={state.error} retry={state.reload} />}
      {!s && !state.error && <Loading />}
      {s && (
        <section className="mb-6 grid gap-3 sm:grid-cols-2">
          {(Object.keys(CHAMBERS) as Chamber[]).map((ch) => {
            const Icon = chamberIcon[ch];
            const n = counts[ch] ?? 0;
            const line =
              ch === "council" ? `${t.seats(s.council.filled, s.council.seats)} · ${t.councilNeed(s.council.need, s.council.filled)}`
                : ch === "assembly" ? (s.assembly.founding ? `${t.foundingAssembly} · ${t.residents(s.residents)}` : t.seats(s.assembly.seated, s.assembly.total))
                : ch === "mayors" ? `${s.mayors} / ${s.districts}`
                : ch === "directorate" ? `${s.directorate.filter((d) => d.holder).length} / ${s.directorate.length}`
                : "";
            return (
              <Link key={ch} to={`/state/${ch}`} className={`group rounded-xl border p-4 transition hover:border-primary ${ch === "council" ? "border-amber-400/50 bg-amber-400/5" : "border-border bg-card/40"}`}>
                <div className="mb-1 flex items-center justify-between">
                  <span className={`flex items-center gap-2 font-display font-bold ${ch === "council" ? "text-amber-200" : ""}`}><Icon className="h-5 w-5" />{t.chambers[ch]}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${n ? "bg-emerald-400/20 text-emerald-200" : "bg-muted/60 text-muted-foreground"}`}>{t.openItems(n)}</span>
                </div>
                {line && <div className="text-xs text-muted-foreground">{line}</div>}
              </Link>
            );
          })}
          <Link to="/state/petitions" className="rounded-xl border border-border bg-card/40 p-4 hover:border-primary">
            <div className="mb-1 flex items-center justify-between">
              <span className="flex items-center gap-2 font-display font-bold"><ScrollText className="h-5 w-5" />{t.statuses.signatures}</span>
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${petitions ? "bg-amber-400/20 text-amber-200" : "bg-muted/60 text-muted-foreground"}`}>{t.openItems(petitions)}</span>
            </div>
            <div className="text-xs text-muted-foreground">{t.proposeIntro(s.signaturesNeeded)}</div>
          </Link>
        </section>
      )}

      <div className="mb-6 flex flex-wrap gap-2">
        <Link to="/state/new" className="inline-flex h-10 items-center gap-1.5 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90"><Plus className="h-4 w-4" />{t.newProposal}</Link>
        <Link to="/state/laws" className="inline-flex h-10 items-center gap-1.5 rounded-md border border-border px-4 text-sm hover:border-primary"><BookOpen className="h-4 w-4" />{t.laws}</Link>
        <Link to="/state/districts" className="inline-flex h-10 items-center gap-1.5 rounded-md border border-border px-4 text-sm hover:border-primary"><MapPin className="h-4 w-4" />{t.districtsList}</Link>
        <Link to="/state/journal" className="inline-flex h-10 items-center gap-1.5 rounded-md border border-border px-4 text-sm hover:border-primary"><ScrollText className="h-4 w-4" />{t.journal}</Link>
      </div>

      {s && (
        <section className="mb-6 flex items-center gap-3 rounded-xl border border-cyan-400/40 bg-cyan-400/5 p-4">
          <Coins className="h-6 w-6 text-cyan-300" />
          <div>
            <div className="text-xs text-muted-foreground">{t.treasury}</div>
            <div className="font-display text-2xl font-bold text-cyan-100">{s.treasury.toLocaleString("en")} TIDE</div>
            <div className="text-xs text-muted-foreground">{s.ledgerLive ? t.treasuryNote : t.ledgerOff}</div>
          </div>
        </section>
      )}

      {/* journal */}
      <section className="mb-6">
        <h2 className="mb-2 font-display text-lg font-bold">{t.journal}</h2>
        {log.data ? (
          <ul className="space-y-1.5 text-sm">
            {log.data.entries.slice(0, 8).map((e) => (
              <li key={e.id} className="flex gap-2">
                <span className="w-28 shrink-0 text-xs text-muted-foreground">{when(e.at)}</span>
                {e.proposal ? <Link to={`/state/p/${e.proposal}`} className="hover:text-primary">{e.text}</Link> : <span>{e.text}</span>}
              </li>
            ))}
          </ul>
        ) : <Loading />}
      </section>

      <HowItWorks />
      <p className="mt-6 text-xs text-muted-foreground">{s && `${t.residents(s.residents)} · ${date(new Date().toISOString())}`}</p>
    </Shell>
  );
};

function Citizenship({ civic, districts, onSaved, named }: { civic: CivicStatus; districts: DistrictInfo[]; onSaved: (c: CivicStatus) => void; named: boolean }) {
  const { t, date } = useStateT();
  const { session, signOut } = useAccount();
  const [pick, setPick] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const canMove = !civic.home || !civic.home.canMoveAt || new Date(civic.home.canMoveAt) <= new Date();
  const save = async () => {
    if (!session || !pick) return;
    setSaving(true);
    const r = await setResidence(session, Number(pick));
    setSaving(false);
    if (r.ok) onSaved(r.data);
    else if (r.error === "session") signOut();
    else toast.error(t.errors[r.error]);
  };
  return (
    <div className="space-y-3 text-sm">
      {!named && <p className="text-amber-200"><Link to="/profile" className="underline">{t.nameFirst}</Link></p>}
      {civic.home ? (
        <p>
          <span className="text-muted-foreground">{t.homeDistrict}: </span>
          <span className="font-semibold">{civic.home.name}</span>
          {civic.home.governedBy !== civic.home.name && <span className="text-muted-foreground"> ({t.governedBy(civic.home.governedBy)})</span>}
        </p>
      ) : (
        <p className="text-muted-foreground">{t.noHome}</p>
      )}
      {civic.home && !civic.home.chosen && <p className="text-xs text-muted-foreground">{t.defaultHome}</p>}
      {canMove ? (
        <div className="flex flex-col gap-2 sm:flex-row">
          <select value={pick} onChange={(e) => setPick(e.target.value)} className="h-9 flex-1 rounded-md border border-input bg-background px-2 text-sm">
            <option value="">{t.chooseDistrict}</option>
            {districts.map((d) => (
              <option key={d.id} value={d.id}>{d.name} · {d.land}</option>
            ))}
          </select>
          <button disabled={!pick || saving} onClick={save} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground disabled:opacity-50">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {saving ? t.moving : t.makeHome}
          </button>
        </div>
      ) : (
        civic.home?.canMoveAt && <p className="text-xs text-muted-foreground">{t.canMoveAt(date(civic.home.canMoveAt))}</p>
      )}
      {civic.offices.length > 0 && (
        <div>
          <div className="text-muted-foreground">{t.yourOffices}</div>
          <ul className="list-inside list-disc">
            {civic.offices.map((o, i) => (
              <li key={i}>{o.title}{o.termEnds ? ` · ${t.until(date(o.termEnds))}` : ` · ${t.permanent}`}</li>
            ))}
          </ul>
        </div>
      )}
      {civic.acting.length > 0 && <p className="text-xs text-muted-foreground">{t.acting(civic.acting.map((p) => t.posts[p]).join(", "))}</p>}
      <p className={civic.toVote ? "font-semibold text-emerald-300" : "text-muted-foreground"}>{civic.toVote ? t.toVote(civic.toVote) : t.nothingToVote}</p>
    </div>
  );
}

export function HowItWorks() {
  const { t } = useStateT();
  const [openHow, setOpenHow] = useState(false);
  return (
    <section className="rounded-xl border border-border bg-card/40">
      <button onClick={() => setOpenHow((o) => !o)} className="flex w-full items-center justify-between p-4 text-left font-display font-bold">
        {t.howTitle}
        <ChevronDown className={`h-4 w-4 transition ${openHow ? "rotate-180" : ""}`} />
      </button>
      {openHow && (
        <div className="space-y-4 px-4 pb-4 text-sm">
          <ul className="list-inside list-disc space-y-1 text-muted-foreground">{t.how.map((h) => <li key={h}>{h}</li>)}</ul>
          <div>
            <h3 className="mb-1 font-semibold">{t.path}</h3>
            <ul className="space-y-1 text-muted-foreground">
              {(Object.keys(t.kindHelp) as (keyof typeof t.kindHelp)[]).filter((k) => k !== "election").map((k) => (
                <li key={k}><span className="font-medium text-foreground">{t.kinds[k]}:</span> {t.kindHelp[k]}</li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="mb-1 flex items-center gap-1.5 font-semibold"><Cpu className="h-4 w-4 text-cyan-300" />{t.nicsTitle}</h3>
            <p className="mb-1 text-muted-foreground">{t.nicsIntro}</p>
            <ul className="list-inside list-disc space-y-0.5 text-muted-foreground">{t.nicsRules.map((r) => <li key={r}>{r}</li>)}</ul>
          </div>
        </div>
      )}
    </section>
  );
}

export default StateHome;
