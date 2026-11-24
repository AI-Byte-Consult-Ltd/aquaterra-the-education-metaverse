import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { ArrowLeft, Building, Check, Cpu, Crown, Landmark, Loader2, Map, MinusCircle, Scale, Users, Vote, X } from "lucide-react";
import { toast } from "sonner";
import { useLanguage } from "@/i18n/LanguageContext";
import { useAccount } from "@/game/account/AccountContext";
import { sign, stand, vote, withdraw, type Body, type Chamber, type GovError, type Proposal, type Result } from "./api";
import { stateLocale, stateStrings, type StateStrings } from "./strings";

export const useStateT = () => {
  const { language } = useLanguage();
  const t = stateStrings(language);
  const loc = stateLocale(language);
  const date = (iso: string | null | undefined) =>
    iso ? new Date(iso).toLocaleDateString(loc, { year: "numeric", month: "short", day: "numeric" }) : "";
  const when = (iso: string | null | undefined) =>
    iso ? new Date(iso).toLocaleString(loc, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
  return { t, date, when };
};

/** Loads something from the server and keeps it fresh. */
export function useLoad<T>(load: () => Promise<Result<T>>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<GovError | null>(null);
  const reload = useCallback(async () => {
    const r = await load();
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

export const chamberIcon: Record<Chamber, typeof Crown> = {
  council: Crown,
  assembly: Landmark,
  mayors: Users,
  directorate: Building,
  districts: Map,
  referendums: Scale,
  elections: Vote,
};

/** Which chamber hosts a stage. */
export const chamberOf = (b: Body | null): Chamber | null =>
  b === "council" ? "council" : b === "assembly" ? "assembly" : b === "mayors" ? "mayors" : b === "district" ? "districts" : b === "referendum" ? "referendums" : b === "nomination" || b === "ballot" ? "elections" : null;

export function Shell({ children, back, title, icon: Icon, accent = "text-amber-300" }: { children: ReactNode; back?: { to: string; label: string }; title: string; icon?: typeof Crown; accent?: string }) {
  const { t } = useStateT();
  const b = back ?? { to: "/world", label: t.backToWorld };
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="flex items-center gap-2 px-4 py-3">
        <Link to={b.to} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
          {b.label}
        </Link>
      </header>
      <main className="mx-auto max-w-4xl px-4 pb-16">
        <div className={`mb-5 flex items-center gap-2 ${accent}`}>
          {Icon && <Icon className="h-6 w-6 shrink-0" />}
          <h1 className="font-display text-2xl font-bold text-foreground md:text-3xl">{title}</h1>
        </div>
        {children}
      </main>
    </div>
  );
}

export const Loading = () => {
  const { t } = useStateT();
  return (
    <p className="flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" />
      {t.loading}
    </p>
  );
};

export const ErrorLine = ({ error, retry }: { error: GovError; retry?: () => void }) => {
  const { t } = useStateT();
  return (
    <p className="text-sm text-destructive">
      {t.errors[error]}{" "}
      {retry && (
        <button onClick={retry} className="text-primary hover:underline">
          {t.retry}
        </button>
      )}
    </p>
  );
};

export function StatusPill({ p, t }: { p: Proposal; t: StateStrings }) {
  const label = p.kind === "election" && p.status === "passed" ? t.electedStatus : p.status === "voting" && p.stageBody ? t.bodies[p.stageBody] : t.statuses[p.status];
  const tone =
    p.status === "passed" ? "border-emerald-400/60 text-emerald-300" : p.status === "rejected" || p.status === "expired" ? "border-rose-400/50 text-rose-300"
      : p.status === "voting" ? "border-cyan-400/60 text-cyan-200" : p.status === "signatures" ? "border-amber-400/60 text-amber-200" : "border-border text-muted-foreground";
  return <span className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${tone}`}>{label}</span>;
}

/** The chain of bodies a proposal goes through, with where it stands now. */
export function Path({ p, t }: { p: Proposal; t: StateStrings }) {
  return (
    <ol className="flex flex-wrap items-center gap-1 text-[11px]">
      {p.stages.map((s, i) => {
        const r = p.results.filter((x) => x.body === s.body)[0];
        const now = p.status === "voting" && i === p.stage;
        const done = i < p.stage || (p.status !== "voting" && p.status !== "signatures" && !!r);
        const failed = done && r && r.passed === false;
        return (
          <li key={i} className="flex items-center gap-1">
            {i > 0 && <span className="text-muted-foreground">→</span>}
            <span
              className={`rounded px-1.5 py-0.5 ${now ? "bg-cyan-400/20 font-semibold text-cyan-100" : failed ? "bg-rose-400/15 text-rose-200" : done ? "bg-emerald-400/15 text-emerald-200" : "bg-muted/50 text-muted-foreground"}`}
            >
              {t.bodies[s.body]}
              {s.rule && s.rule !== "majority" && s.rule !== "council" ? ` · ${t.rules[s.rule]}` : ""}
              {r?.skipped ? ` (${t.stageSkipped})` : ""}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function TallyBar({ y, n, a, e }: { y: number; n: number; a: number; e: number }) {
  const total = Math.max(e, y + n + a, 1);
  return (
    <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted/60">
      <div className="bg-emerald-400" style={{ width: `${(100 * y) / total}%` }} />
      <div className="bg-rose-400" style={{ width: `${(100 * n) / total}%` }} />
      <div className="bg-slate-400" style={{ width: `${(100 * a) / total}%` }} />
    </div>
  );
}

/** Voting, signing and standing for one proposal. The server decides who may do what. */
export function VoteBox({ p, onChange, compact = false }: { p: Proposal; onChange: (p: Proposal) => void; compact?: boolean }) {
  const { t, when } = useStateT();
  const { session, signOut } = useAccount();
  const location = useLocation();
  const [busy, setBusy] = useState<string | null>(null);
  const [statement, setStatement] = useState("");

  const act = async (key: string, run: () => Promise<Result<{ proposal: Proposal }>>) => {
    setBusy(key);
    const r = await run();
    setBusy(null);
    if (r.ok) onChange(r.data.proposal);
    else if (r.error === "session") signOut();
    else toast.error(t.errors[r.error]);
  };

  const login = (
    <Link to={`/login?next=${encodeURIComponent(location.pathname)}`} className="inline-flex h-9 items-center rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
      {t.signInToVote}
    </Link>
  );

  if (p.status === "signatures") {
    return (
      <div className="space-y-2">
        {p.signatures && (
          <>
            <TallyBar y={p.signatures.count} n={0} a={0} e={p.signatures.needed} />
            <p className="text-xs text-muted-foreground">{t.signaturesLine(p.signatures.count, p.signatures.needed)} · {t.closes(when(p.stageEnds))}</p>
          </>
        )}
        {!session ? login : p.me?.signed ? (
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-1 text-sm text-emerald-300"><Check className="h-4 w-4" />{t.signed}</span>
            {p.me.isAuthor && (
              <button disabled={!!busy} onClick={() => act("w", () => withdraw(session, p.id))} className="text-sm text-muted-foreground hover:text-foreground">
                {t.withdraw}
              </button>
            )}
          </div>
        ) : (
          <button disabled={!!busy || !p.me?.canSign} onClick={() => act("s", () => sign(session, p.id))} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-amber-400 px-3 text-sm font-semibold text-black hover:bg-amber-300 disabled:opacity-50">
            {busy === "s" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            {t.sign}
          </button>
        )}
      </div>
    );
  }
  if (p.status !== "voting") return null;

  if (p.stageBody === "nomination") {
    return (
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">{t.closes(when(p.stageEnds))} · {p.candidates ?? 0} {t.candidates.toLowerCase()}</p>
        {!session ? login : p.me?.stood ? (
          <span className="inline-flex items-center gap-1 text-sm text-emerald-300"><Check className="h-4 w-4" />{t.standing}</span>
        ) : (
          <div className="flex flex-col gap-2 sm:flex-row">
            {!compact && (
              <input value={statement} maxLength={280} onChange={(e) => setStatement(e.target.value)} placeholder={t.statement}
                className="h-9 flex-1 rounded-md border border-input bg-background/60 px-2 text-sm outline-none focus:border-primary" />
            )}
            <button disabled={!!busy} onClick={() => act("st", () => stand(session, p.id, statement))} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
              {busy === "st" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Vote className="h-4 w-4" />}
              {t.stand}
            </button>
          </div>
        )}
      </div>
    );
  }

  if (p.stageBody === "ballot") {
    const list = p.candidateList ?? [];
    return (
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">{t.closes(when(p.stageEnds))} · {t.secretBallot}</p>
        {compact && <p className="text-xs text-muted-foreground">{p.candidates ?? 0} {t.candidates.toLowerCase()}</p>}
        {!session ? login : !p.me?.canVote ? (
          <p className="text-xs text-muted-foreground">{t.notYourVote}</p>
        ) : (
          !compact && (
            <ul className="space-y-1.5">
              {list.map((c) => (
                <li key={c.n} className={`flex items-center justify-between gap-2 rounded-lg border p-2 ${p.me?.vote === String(c.n) ? "border-emerald-400/70 bg-emerald-400/10" : "border-border"}`}>
                  <div className="min-w-0">
                    <div className="font-medium">{c.name}</div>
                    {c.statement && <div className="truncate text-xs text-muted-foreground">{c.statement}</div>}
                  </div>
                  <button disabled={!!busy} onClick={() => act(`c${c.n}`, () => vote(session, p.id, String(c.n)))} className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md bg-emerald-500 px-3 text-sm font-semibold text-black hover:bg-emerald-400 disabled:opacity-50">
                    {busy === `c${c.n}` ? <Loader2 className="h-4 w-4 animate-spin" /> : p.me?.vote === String(c.n) ? <Check className="h-4 w-4" /> : null}
                    {t.voteFor}
                  </button>
                </li>
              ))}
            </ul>
          )
        )}
      </div>
    );
  }

  const tl = p.tally;
  const mine = p.me?.vote;
  return (
    <div className="space-y-2">
      {tl && (
        <>
          <TallyBar y={tl.yes} n={tl.no} a={tl.abstain} e={tl.electorate} />
          <p className="text-xs text-muted-foreground">
            {t.tallyLine(tl.yes, tl.no, tl.abstain, tl.electorate)} · {tl.need != null ? t.needLine(tl.need) : t.quorumLine(tl.quorum)} ·{" "}
            <span className={tl.passing ? "text-emerald-300" : "text-amber-200"}>{tl.passing ? t.passingNow : t.failingNow}</span>
          </p>
          <p className="text-xs text-muted-foreground">{t.closes(when(p.stageEnds))}</p>
        </>
      )}
      {!session ? login : !p.me?.canVote ? (
        <p className="text-xs text-muted-foreground">{t.notYourVote}</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {([
              ["yes", t.yes, Check, "bg-emerald-500 hover:bg-emerald-400 text-black", "ring-emerald-300"],
              ["no", t.no, X, "bg-rose-500 hover:bg-rose-400 text-black", "ring-rose-300"],
              ["abstain", t.abstain, MinusCircle, "bg-slate-500 hover:bg-slate-400 text-black", "ring-slate-300"],
            ] as const).map(([c, label, Icon, cls, ring]) => (
              <button key={c} disabled={!!busy} onClick={() => act(c, () => vote(session, p.id, c))}
                className={`inline-flex h-10 min-w-[88px] items-center justify-center gap-1.5 rounded-md px-3 text-sm font-semibold disabled:opacity-50 ${cls} ${mine === c ? `ring-2 ring-offset-2 ring-offset-background ${ring}` : mine ? "opacity-60" : ""}`}>
                {busy === c ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
                {label}
              </button>
            ))}
          </div>
          {mine && <p className="text-xs text-muted-foreground">{t.yourVote(mine === "yes" ? t.yes : mine === "no" ? t.no : t.abstain)}</p>}
        </>
      )}
    </div>
  );
}

/** One proposal in a list, with its vote box. */
export function ProposalCard({ p, onChange }: { p: Proposal; onChange: (p: Proposal) => void }) {
  const { t, date } = useStateT();
  const nics = p.rollCall?.find((v) => v.ai && v.stage === p.stage);
  return (
    <article className="space-y-3 rounded-xl border border-border bg-card/40 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs text-muted-foreground">{t.kinds[p.kind]} · #{p.id}</div>
          <Link to={`/state/p/${p.id}`} className="font-display text-lg font-bold hover:text-primary">{p.title}</Link>
          {p.author && <div className="text-xs text-muted-foreground">{t.proposedBy(p.author)} {t.startedAt(date(p.createdAt))}</div>}
        </div>
        <StatusPill p={p} t={t} />
      </div>
      {p.body && <p className="line-clamp-3 whitespace-pre-line text-sm text-muted-foreground">{p.body}</p>}
      <Path p={p} t={t} />
      {nics && (
        <p className="flex items-start gap-1.5 rounded-md bg-cyan-400/10 p-2 text-xs text-cyan-100">
          <Cpu className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>NICS AI: {nics.choice.toUpperCase()}. {nics.reason}</span>
        </p>
      )}
      {p.kind === "election" && p.stageBody === "nomination" && (p.candidateList?.length ?? 0) > 0 && (
        <ul className="space-y-0.5 text-sm">
          {p.candidateList!.map((c) => (
            <li key={c.n}><span className="font-medium">{c.name}</span>{c.statement && <span className="text-muted-foreground"> · {c.statement}</span>}</li>
          ))}
        </ul>
      )}
      <VoteBox p={p} onChange={onChange} />
      {p.outcome && p.status !== "voting" && <p className="text-sm"><span className="text-muted-foreground">{t.outcome}: </span>{p.outcome}</p>}
    </article>
  );
}
