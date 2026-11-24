import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Coins, Cpu, Gamepad2, Loader2, MapPin, RotateCcw, Trophy, XCircle } from "lucide-react";
import { useLanguage } from "@/i18n/LanguageContext";
import { useAccount } from "@/game/account/AccountContext";
import { useEconomy } from "@/game/economy/EconomyContext";
import { fetchPlotArcade, finishRun, startRun, type ArcadeError, type PlotArcade, type Run, type RunResult } from "@/game/arcade/api";
import { GAMES, type Play } from "@/game/arcade/games";
import { arcadeStrings } from "@/game/arcade/strings";
import { mapLink, placeName, useRegistry } from "@/game/arcade/registry";
import { Shell } from "@/game/state/ui";

type Phase = { k: "intro" } | { k: "starting" } | { k: "playing"; run: Run } | { k: "checking"; run: Run } | { k: "result"; run: Run; res: RunResult };

/** /arcade/play/:plotId — the attraction on a plot: rules, ticket, the game, the result. */
const PlayPage = () => {
  const { plotId } = useParams();
  const id = Number(plotId);
  const { language } = useLanguage();
  const t = arcadeStrings(language);
  const { session, signOut } = useAccount();
  const economy = useEconomy();
  const reg = useRegistry();
  const [info, setInfo] = useState<PlotArcade | null>(null);
  const [error, setError] = useState<ArcadeError | null>(null);
  const [phase, setPhase] = useState<Phase>({ k: "intro" });

  const load = useCallback(async () => {
    const r = await fetchPlotArcade(session, id);
    if (r.ok) setInfo(r.data);
    else setError(r.error);
  }, [session, id]);
  useEffect(() => {
    void load();
  }, [load]);

  const fail = (e: ArcadeError | string) => {
    if (e === "session") signOut();
    setError((e as ArcadeError) ?? "network");
    setPhase({ k: "intro" });
  };

  const start = async () => {
    if (!session || !info?.attraction) return;
    setError(null);
    setPhase({ k: "starting" });
    const r = await startRun(session, info.attraction.id);
    if (!r.ok) return fail(r.error);
    void economy.refresh();
    setPhase({ k: "playing", run: r.data });
  };

  // games keep the first callback they get, so it reads the live run and helpers through refs
  const runRef = useRef<Run | null>(null);
  runRef.current = phase.k === "playing" ? phase.run : runRef.current;
  const helpers = useRef({ economy, load });
  helpers.current = { economy, load };
  const onFinish = useCallback(
    async (play: Play) => {
      const run = runRef.current;
      if (!session || !run) return;
      setPhase({ k: "checking", run });
      const r = await finishRun(session, run.run, play);
      if (!r.ok) return fail(r.error);
      setPhase({ k: "result", run, res: r.data });
      void helpers.current.economy.refresh();
      void helpers.current.load();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [session],
  );

  const a = info?.attraction;
  const place = reg?.get(id);
  const Game = phase.k === "playing" || phase.k === "checking" ? GAMES[phase.run.template] : null;

  return (
    <Shell title={a?.title ?? t.arcadeTitle} icon={Gamepad2} accent="text-fuchsia-300" back={{ to: mapLink(place?.address), label: t.back }}>
      {place && (
        <p className="-mt-3 mb-4 flex items-center gap-1.5 text-sm text-muted-foreground">
          <MapPin className="h-4 w-4" />
          {placeName(place)}
          <Link to="/arcade" className="ml-auto text-fuchsia-200 hover:underline">{t.backToArcade} →</Link>
        </p>
      )}
      {error && <p className="mb-4 rounded-md border border-rose-400/40 bg-rose-500/10 p-3 text-sm text-rose-200">{t.errors[error]}</p>}
      {!info && !error && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}
      {info && !a && <p className="text-sm text-muted-foreground">{t.noAttraction}</p>}

      {a && phase.k === "intro" && (
        <section className="space-y-4 rounded-xl border border-fuchsia-400/30 bg-card/40 p-5">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            {a.ai && <Cpu className="h-4 w-4 text-cyan-300" />}
            {t.templates[a.template]} · {t.difficulties[a.difficulty]} · {a.ai ? t.byAi : t.by(a.operator)}
          </div>
          <p className="text-sm">{t.templateAbout[a.template]}</p>
          <p className="text-sm text-muted-foreground">{t.rulesLine(a.template, a.rules)}. {t.controls[a.template]}</p>
          {a.template === "quiz" && a.topic && <p className="text-sm text-muted-foreground">{t.topic}: {t.topics[a.topic]}</p>}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label={t.ticket} value={a.entryFee > 0 ? t.tide(a.entryFee) : t.free} />
            <Stat label={t.prize} value={a.prize > 0 && a.pool > 0 ? t.tide(Math.min(a.prize, a.pool)) : "—"} accent />
            <Stat label={t.attractionHere} value={t.played(a.plays, a.wins)} />
            {info.me && <Stat label={t.today} value={t.prizeCapLeft(info.me.prizeLeftToday)} />}
          </div>
          {info.me?.role === "owner" || info.me?.role === "tenant" ? (
            <p className="text-sm text-amber-200">{t.practice}</p>
          ) : info.me && !info.me.here ? (
            <p className="text-sm text-amber-200">{t.goThere}</p>
          ) : info.me ? (
            <p className="text-sm text-muted-foreground">
              {t.attemptsLeft(info.me.attemptsLeft ?? 0)}
              {info.me.prizeHereToday ? ` · ${t.prizeTaken}` : ""}
            </p>
          ) : null}
          <button
            onClick={() => void start()}
            disabled={!session || (info.me?.attemptsLeft === 0 && !info.me.role) || (!!info.me && !info.me.here && !info.me.role)}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-fuchsia-400 to-cyan-300 text-base font-bold text-black shadow-[0_0_24px_rgba(255,92,210,0.35)] hover:brightness-110 disabled:opacity-40 sm:w-64"
          >
            <Gamepad2 className="h-5 w-5" />
            {a.entryFee > 0 && !info.me?.role ? t.playFor(t.tide(a.entryFee)) : t.go}
          </button>
          {!session && <Link to={`/login?next=/arcade/play/${id}`} className="text-sm text-primary hover:underline">Sign in</Link>}
        </section>
      )}

      {phase.k === "starting" && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t.starting}
        </p>
      )}

      {Game && (phase.k === "playing" || phase.k === "checking") && session && (
        <section className="relative">
          <p className="mb-3 text-center text-xs text-muted-foreground">{phase.run.practice ? t.practice : phase.run.fee > 0 ? t.paid(phase.run.fee) : ""}</p>
          <Game run={phase.run} session={session} t={t} onFinish={onFinish} onError={(e) => fail(e)} />
          {phase.k === "checking" && (
            <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-background/70 backdrop-blur-sm">
              <p className="flex items-center gap-2 text-sm">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t.checking}
              </p>
            </div>
          )}
        </section>
      )}

      {phase.k === "result" && a && <Result t={t} run={phase.run} res={phase.res} again={() => setPhase({ k: "intro" })} />}
    </Shell>
  );
};

const Stat = ({ label, value, accent }: { label: string; value: string; accent?: boolean }) => (
  <div className="rounded-lg border border-border bg-background/50 p-2.5">
    <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
    <div className={`text-sm font-semibold ${accent ? "text-cyan-200" : ""}`}>{value}</div>
  </div>
);

function Result({ t, run, res, again }: { t: ReturnType<typeof arcadeStrings>; run: Run; res: RunResult; again: () => void }) {
  const quiz = run.template === "quiz" ? (run.game as { questions: { q: string; options: string[] }[] }) : null;
  const questReady = res.quests.some((q) => !q.claimed && q.progress >= q.need);
  return (
    <section className={`space-y-4 rounded-xl border p-5 ${res.won ? "border-cyan-300/50 bg-cyan-400/5" : "border-border bg-card/40"}`}>
      <div className="flex items-center gap-3">
        {res.won ? <Trophy className="h-10 w-10 text-amber-300 drop-shadow-[0_0_10px_rgba(255,200,80,0.7)]" /> : <XCircle className="h-10 w-10 text-rose-300" />}
        <div>
          <h2 className="font-display text-2xl font-bold">{res.won ? t.win : t.lose}</h2>
          <p className="text-sm text-muted-foreground">
            {run.template === "maze" && res.won ? t.mazeScore(res.detail.seconds) : run.template === "race" && res.detail.crash !== undefined ? t.crash(res.detail.crash, res.maxScore) : t.score(res.score, res.maxScore)}
          </p>
        </div>
      </div>
      {res.practice ? (
        <p className="text-sm text-amber-200">{t.practice}</p>
      ) : res.prize > 0 ? (
        <p className="flex items-center gap-2 rounded-md bg-cyan-400/10 p-3 text-sm text-cyan-100">
          <Coins className="h-4 w-4" />
          {t.prizeWon(res.prize, res.tax)}
        </p>
      ) : res.won ? (
        <p className="text-sm text-muted-foreground">{t.noPrize} {t.noPrizeWhy}</p>
      ) : null}
      {quiz && res.review && (
        <ol className="space-y-1.5 text-sm">
          {quiz.questions.map((q, i) => (
            <li key={i} className="rounded-md bg-background/50 p-2">
              <span className="text-muted-foreground">{i + 1}. {q.q}</span> <span className="font-semibold text-emerald-300">{q.options[res.review![i]]}</span>
            </li>
          ))}
        </ol>
      )}
      {questReady && (
        <Link to="/arcade" className="block text-sm font-semibold text-amber-200 hover:underline">{t.questReady} →</Link>
      )}
      <div className="flex flex-wrap gap-2">
        <button onClick={again} className="flex h-10 items-center gap-2 rounded-md border border-fuchsia-300/60 px-4 text-sm font-semibold hover:bg-fuchsia-400/10">
          <RotateCcw className="h-4 w-4" />
          {t.playAgain}
        </button>
        <Link to="/arcade" className="flex h-10 items-center rounded-md border border-border px-4 text-sm hover:border-primary">{t.backToArcade}</Link>
      </div>
    </section>
  );
}

export default PlayPage;
