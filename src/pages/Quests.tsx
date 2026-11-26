import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Brain, CheckCircle2, Circle, Coins, Loader2, ScrollText, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useLanguage } from "@/i18n/LanguageContext";
import { useAccount } from "@/game/account/AccountContext";
import { useEconomy } from "@/game/economy/EconomyContext";
import { Shell } from "@/game/state/ui";
import { Panel, Stat, btnMain, btnSoft } from "@/game/bank/ui";
import { answerQuest, claimQuest, fetchQuestJournal, fetchQuests, type Quest, type QuestDay, type QuestsError, type QuestsView } from "@/game/quests/api";
import { questsStrings } from "@/game/quests/strings";

const goTo = (q: Quest) =>
  q.id === "play" ? `/world?plot=${q.plotId}` : q.id === "civic" || q.id === "ask" ? "/state" : "/world";

/** /quests: today's quests written by NICS AI, rewards from its fund, and its journal. */
const Quests = () => {
  const { language } = useLanguage();
  const t = questsStrings(language);
  const { session, signOut } = useAccount();
  const { refresh } = useEconomy();
  const [view, setView] = useState<QuestsView | null>(null);
  const [days, setDays] = useState<QuestDay[]>([]);
  const [error, setError] = useState<QuestsError | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetchQuests(session);
    if (r.ok) {
      setView(r.data);
      setError(null);
    } else if (r.error === "session") signOut();
    else setError(r.error);
    const j = await fetchQuestJournal();
    if (j.ok) setDays(j.data.days);
  }, [session, signOut]);
  useEffect(() => {
    void load();
  }, [load]);

  const claim = async (q: Quest) => {
    if (!session) return;
    setBusy(q.id);
    const r = await claimQuest(session, q.id);
    setBusy(null);
    if (!r.ok) {
      if (r.error === "session") signOut();
      else toast.error(t.errors[r.error]);
      return;
    }
    setView(r.data);
    if (r.data.fundEmpty || !r.data.reward) toast(t.fundEmpty);
    else toast.success(t.paid(r.data.reward, r.data.tax ?? 0));
    void refresh();
  };

  const answer = async (i: number) => {
    if (!session) return;
    setBusy("ask");
    const r = await answerQuest(session, i);
    setBusy(null);
    if (!r.ok) {
      if (r.error === "session") signOut();
      else toast.error(t.errors[r.error]);
      return;
    }
    setView(r.data);
    if (r.data.correct) toast.success(t.rightAnswer);
    else toast(t.wrongAnswer);
  };

  const card = (q: Quest) => {
    const { title, how } = t.quest(q);
    return (
      <li key={q.id} className="space-y-2 rounded-xl border border-border bg-background/40 p-4">
        <div className="flex items-start gap-3">
          {q.done ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" /> : <Circle className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />}
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{title}</p>
            <p className="text-sm text-muted-foreground">{how}</p>
          </div>
          <span className={`shrink-0 text-sm font-bold ${q.reward > 0 ? "text-amber-300" : "text-muted-foreground"}`}>{t.reward(q.reward)}</span>
        </div>
        {q.id === "ask" && session && (
          <div className="grid grid-cols-1 gap-2 pl-8 sm:grid-cols-2">
            {q.options.map((o, i) => {
              const tried = q.answered !== undefined;
              const tone = !tried ? "" : i === q.answer ? "border-emerald-400 text-emerald-300" : i === q.answered ? "border-red-400 text-red-300" : "opacity-60";
              return (
                <button key={o} type="button" disabled={tried || busy === "ask"} onClick={() => void answer(i)} className={`${btnSoft} justify-start ${tone}`}>
                  {o}
                </button>
              );
            })}
          </div>
        )}
        {session && (
          <div className="flex flex-wrap gap-2 pl-8">
            {q.claimed ? (
              <span className="text-sm text-emerald-300">{t.claimed}</span>
            ) : q.done ? (
              <button type="button" className={btnMain} disabled={busy === q.id} onClick={() => void claim(q)}>
                {busy === q.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Coins className="h-4 w-4" />}
                {t.claim}
              </button>
            ) : q.id !== "ask" ? (
              <Link to={goTo(q)} className={btnSoft}>{t.go}</Link>
            ) : null}
          </div>
        )}
      </li>
    );
  };

  return (
    <Shell title={t.title} icon={Sparkles} back={{ to: "/world", label: t.backToWorld }}>
      <p className="mb-5 max-w-2xl text-sm text-muted-foreground">{t.intro}</p>
      {!session && (
        <p className="mb-4 text-sm">
          <Link to="/login" className="text-primary underline">{t.signIn}</Link>
        </p>
      )}
      {error && <p className="mb-4 text-sm text-destructive">{t.errors[error]}</p>}
      {!view && !error && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}
      {view && (
        <div className="space-y-6">
          <Panel title={t.resets(view.resetsAt)} icon={Sparkles}>
            <ul className="space-y-3">{view.quests.map(card)}</ul>
            <p className="text-xs text-muted-foreground">{t.tax(view.taxPct)}</p>
          </Panel>
          <Panel title={t.fund} icon={Coins}>
            <p className="text-sm text-muted-foreground">{t.fundNote}</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Stat label={t.fund} v={view.fund} />
              <Stat label={t.potLeft} v={view.potLeft} />
              <div className="rounded-xl border border-border bg-card/60 p-3">
                <div className="text-xs text-muted-foreground">{t.people}</div>
                <div className="font-display text-lg font-bold text-cyan-100">{view.claimedToday.toLocaleString("en")}</div>
              </div>
            </div>
          </Panel>
          <Panel title={t.why} icon={Brain}>
            <p className="text-sm text-muted-foreground">{view.note}</p>
          </Panel>
          {days.length > 1 && (
            <Panel title={t.journal} icon={ScrollText}>
              <ul className="space-y-2 text-sm">
                {days.slice(1).map((d) => (
                  <li key={d.day}>
                    <span className="font-semibold">{d.day}</span>: {t.journalLine(d.pot, d.paid, d.people)}. <span className="text-muted-foreground">{d.note}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
      )}
    </Shell>
  );
};

export default Quests;
