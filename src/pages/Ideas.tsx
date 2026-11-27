import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Bot, Brain, Crown, Heart, Lightbulb, Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { useLanguage } from "@/i18n/LanguageContext";
import { useAccount } from "@/game/account/AccountContext";
import { Shell } from "@/game/state/ui";
import { Panel, btnMain, btnSoft, input } from "@/game/bank/ui";
import {
  IDEA_STATUSES, IDEA_TOPICS, decideIdea, fetchIdeas, submitIdea, supportIdea, withdrawIdea,
  type Idea, type IdeaError, type IdeaFilter, type IdeaStatus, type IdeaTopic, type IdeasBoard,
} from "@/game/ideas/api";
import { ideaStrings, type IdeaStrings } from "@/game/ideas/strings";

const errOf = (r: unknown) => (r as { error: IdeaError }).error;
const FILTERS: IdeaFilter[] = ["open", "in_dev", "accepted", "done", "rejected", "all", "mine"];
const statusTone: Record<IdeaStatus, string> = {
  open: "border-cyan-300/40 text-cyan-200",
  accepted: "border-emerald-400/50 text-emerald-300",
  in_dev: "border-amber-400/60 text-amber-300",
  done: "border-emerald-400/70 text-emerald-200",
  rejected: "border-border text-muted-foreground",
};

/** /ideas: residents tell NICS AI how the world should grow; the Council of First Light decides. */
const Ideas = () => {
  const { language } = useLanguage();
  const t = ideaStrings(language);
  const { session, signOut } = useAccount();
  const [filter, setFilter] = useState<IdeaFilter>("open");
  const [board, setBoard] = useState<IdeasBoard | null>(null);
  const [error, setError] = useState<IdeaError | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [topic, setTopic] = useState<IdeaTopic | "auto">("auto");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<Idea | null>(null);

  const fail = useCallback((e: IdeaError) => (e === "session" ? signOut() : toast.error(t.errors[e])), [signOut, t]);
  const load = useCallback(async () => {
    const r = await fetchIdeas(session, filter);
    if (r.ok) {
      setBoard(r.data);
      setError(null);
    } else if (errOf(r) === "session" && session) signOut();
    else setError(errOf(r));
  }, [session, filter, signOut]);
  useEffect(() => {
    void load();
  }, [load]);

  const replace = (i: Idea) => setBoard((b) => (b ? { ...b, ideas: b.ideas.map((x) => (x.id === i.id ? i : x)) } : b));

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!session || busy) return;
    setBusy(true);
    const r = await submitIdea(session, title.trim(), body.trim(), topic, language);
    setBusy(false);
    if (!r.ok) return fail(errOf(r));
    setSent(r.data.idea);
    setTitle("");
    setBody("");
    setTopic("auto");
    toast.success(t.received);
    void load();
  };

  const left = board?.leftToday ?? 0;
  const known = board ? board.counts.all : 0;

  return (
    <Shell title={t.title} icon={Lightbulb} back={{ to: "/world", label: t.backToWorld }} accent="text-cyan-300">
      <p className="mb-5 max-w-2xl text-sm text-muted-foreground">{t.intro}</p>
      <div className="space-y-6">
        <Panel title={t.formTitle} icon={Send}>
          {!session ? (
            <Link to="/login?next=/ideas" className={btnMain}>{t.signIn}</Link>
          ) : (
            <form onSubmit={onSubmit} className="space-y-3">
              <label className="block space-y-1 text-sm">
                <span className="font-medium">{t.ideaTitle}</span>
                <input className={input} value={title} maxLength={80} placeholder={t.ideaTitlePh} onChange={(e) => setTitle(e.target.value)} />
              </label>
              <label className="block space-y-1 text-sm">
                <span className="font-medium">{t.ideaBody}</span>
                <textarea
                  className="min-h-[110px] w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                  value={body}
                  maxLength={1500}
                  placeholder={t.ideaBodyPh}
                  onChange={(e) => setBody(e.target.value)}
                />
                <span className="block text-right text-[11px] text-muted-foreground">{body.length} / 1500</span>
              </label>
              <label className="block space-y-1 text-sm">
                <span className="font-medium">{t.topic}</span>
                <select className={input} value={topic} onChange={(e) => setTopic(e.target.value as IdeaTopic | "auto")}>
                  <option value="auto">{t.auto}</option>
                  {IDEA_TOPICS.map((k) => <option key={k} value={k}>{t.topics[k]}</option>)}
                </select>
              </label>
              <p className="text-[11px] text-muted-foreground">{t.dataNote}</p>
              <div className="flex flex-wrap items-center gap-3">
                <button type="submit" className={btnMain} disabled={busy || left <= 0 || title.trim().length < 5 || body.trim().length < 20}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  {t.send}
                </button>
                {board && <span className="text-xs text-muted-foreground">{left > 0 ? t.leftToday(left, board.perDay) : t.noMore}</span>}
              </div>
            </form>
          )}
          {sent && (
            <div className="flex gap-2 rounded-xl border border-cyan-300/30 bg-cyan-400/10 p-3 text-sm">
              <Bot className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300" />
              <p>
                {t.received} {t.nicsRead(t.topics[sent.category])} {sent.similar.length ? t.nicsSimilar(sent.similar) : t.nicsNew}
              </p>
            </div>
          )}
        </Panel>

        {board && known > 0 && (
          <Panel title={t.learned} icon={Brain}>
            <p className="text-xs text-muted-foreground">{t.learnedNote(board.counts.all, board.counts.residents)}</p>
            <div className="flex flex-wrap gap-2">
              {board.topics.map((x) => (
                <span key={x.topic} className="rounded-full border border-cyan-300/40 bg-cyan-400/10 px-2.5 py-1 text-xs">
                  {t.topics[x.topic] ?? x.topic} · {t.n(x.ideas)}
                </span>
              ))}
            </div>
            {board.words.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {t.sharedWords}: {board.words.map((w) => `${w.word} (${w.ideas})`).join(", ")}
              </p>
            )}
          </Panel>
        )}

        <Panel title={t.board} icon={Lightbulb}>
          <div className="flex flex-wrap gap-1.5">
            {FILTERS.filter((f) => f !== "mine" || session).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`rounded-full border px-3 py-1 text-xs ${filter === f ? "border-cyan-300 bg-cyan-400/15 text-cyan-100" : "border-border hover:border-cyan-300/60"}`}
              >
                {t.filters[f]}
                {board && f !== "mine" ? ` · ${t.n(board.counts[f])}` : ""}
              </button>
            ))}
          </div>
          {error && <p className="text-sm text-destructive">{t.errors[error]}</p>}
          {!board && !error && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}
          {board && board.ideas.length === 0 && <p className="text-sm text-muted-foreground">{t.empty}</p>}
          <ul className="space-y-3">
            {board?.ideas.map((i) => (
              <IdeaCard key={i.id} i={i} t={t} council={board.council} session={session} onChange={replace} onGone={load} fail={fail} />
            ))}
          </ul>
        </Panel>
      </div>
    </Shell>
  );
};

function IdeaCard({ i, t, council, session, onChange, onGone, fail }: {
  i: Idea; t: IdeaStrings; council: boolean; session: string | null;
  onChange: (i: Idea) => void; onGone: () => void; fail: (e: IdeaError) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(i.councilNote ?? "");
  const run = async <T,>(p: Promise<{ ok: true; data: T } | { ok: false; error: IdeaError }>, done: (d: T) => void) => {
    setBusy(true);
    const r = await p;
    setBusy(false);
    if (r.ok) done(r.data);
    else fail(errOf(r));
  };
  const date = new Date(i.at).toLocaleDateString("en", { year: "numeric", month: "short", day: "numeric" });

  return (
    <li className="rounded-xl border border-border bg-background/40 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="font-semibold">
          <span className="mr-1.5 text-xs text-muted-foreground">#{i.id}</span>
          {i.title}
        </p>
        <span className={`rounded-full border px-2 py-0.5 text-[11px] ${statusTone[i.status]}`}>{t.statuses[i.status]}</span>
      </div>
      <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{i.body}</p>
      <p className="mt-2 text-[11px] text-muted-foreground">
        {t.topics[i.category] ?? i.category} · {i.author ? `${t.by(i.author)} · ` : ""}{date}
        {i.similar.length > 0 && ` · ${t.nicsSimilar(i.similar)}`}
      </p>
      {i.councilNote && (
        <p className="mt-2 flex gap-1.5 rounded-lg border border-amber-400/40 bg-amber-400/10 p-2 text-xs">
          <Crown className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" />
          <span>
            <b>{t.councilNote}:</b> {i.councilNote}
            {i.decidedBy && <span className="text-muted-foreground"> · {t.decidedBy(i.decidedBy)}</span>}
          </span>
        </p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">{t.supports(i.supports)}</span>
        {session && !i.mine && i.status !== "rejected" && (
          <button
            className={`${btnSoft} ${i.supported ? "border-rose-400/60 text-rose-200" : ""}`}
            disabled={busy}
            onClick={() => run(supportIdea(session, i.id), (d) => onChange(d.idea))}
          >
            <Heart className={`h-4 w-4 ${i.supported ? "fill-rose-400 text-rose-400" : ""}`} />
            {i.supported ? t.supported : t.support}
          </button>
        )}
        {session && i.mine && i.status === "open" && (
          <button className={btnSoft} disabled={busy} onClick={() => run(withdrawIdea(session, i.id), () => onGone())}>
            {t.withdraw}
          </button>
        )}
      </div>
      {session && council && (
        <div className="mt-3 space-y-2 rounded-lg border border-amber-400/40 p-2">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-300"><Crown className="h-3.5 w-3.5" />{t.decide}</p>
          <input className={input} value={note} maxLength={400} placeholder={t.notePh} onChange={(e) => setNote(e.target.value)} />
          <div className="flex flex-wrap gap-1.5">
            {IDEA_STATUSES.filter((s) => s !== i.status).map((s) => (
              <button key={s} className={btnSoft} disabled={busy} onClick={() => run(decideIdea(session, i.id, s, note), (d) => onChange(d.idea))}>
                {t.actions[s]}
              </button>
            ))}
          </div>
        </div>
      )}
    </li>
  );
}

export default Ideas;
