import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Cpu, Loader2, Send, ThumbsDown, ThumbsUp } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useAccount } from "@/game/account/AccountContext";
import { useLanguage } from "@/i18n/LanguageContext";
import { checkModelAnswer, pickPhrase, readyAnswer } from "./answer";
import { phraseBank } from "./phrases";
import { askModel, fetchConsent, fetchStatus, forgetDialogs, logDialog, rateDialog, setConsent } from "./api";
import { gatherFacts } from "./facts";
import { nicsLanguage, nicsStrings } from "./strings";
import { MENU, PERSONAL, classify, type Topic } from "./topics";

interface Line {
  key: number;
  who: "resident" | "nics";
  text: string;
  source?: "phrase" | "model";
  logId?: number;
  rated?: 1 | -1;
}

const MAX_QUESTION = 300;

/** The conversation with NICS AI: prepared answers from live records now, NICS Language when its queue is on. */
export const NicsChat = ({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) => {
  const { language } = useLanguage();
  const lang = nicsLanguage(language);
  const t = nicsStrings(language);
  const { session, player } = useAccount();
  const [lines, setLines] = useState<Line[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [consent, setConsentState] = useState<boolean | null | undefined>(undefined);
  const [queue, setQueue] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const seq = useRef(0);
  const endRef = useRef<HTMLDivElement>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!open) return;
    let live = true;
    if (session) {
      fetchConsent(session).then((r) => {
        if (!live || !r.ok) return;
        setConsentState(r.data.consent);
        setQueue(r.data.queue);
      });
    } else {
      setConsentState(undefined);
      fetchStatus().then((r) => live && r.ok && setQueue(r.data.queue));
    }
    return () => {
      live = false;
      abort.current?.abort();
    };
  }, [open, session]);

  useEffect(() => endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" }), [lines, busy]);

  const ask = useCallback(
    async (topic: Topic, question: string) => {
      if (busy) return;
      setBusy(true);
      setNote(null);
      const k = ++seq.current;
      setLines((l) => [...l, { key: k * 2, who: "resident", text: question }]);
      const seed = Date.now();
      let answer: string;
      let source: "phrase" | "model" = "phrase";
      let facts = null as Awaited<ReturnType<typeof gatherFacts>>;
      if (PERSONAL.has(topic) && !session) {
        answer = pickPhrase(phraseBank(lang).signIn, {}, seed)!;
      } else {
        facts = await gatherFacts(topic, { session, name: player?.displayName ?? null, locale: lang });
        answer = readyAnswer(lang, topic, facts, seed);
        if (facts && queue && session) {
          abort.current = new AbortController();
          const raw = await askModel(session, { lang, qtype: topic, question, facts }, abort.current.signal);
          const checked = raw === null ? null : checkModelAnswer(raw, topic, facts);
          if (checked) {
            answer = checked;
            source = "model";
          }
        }
      }
      setLines((l) => [...l, { key: k * 2 + 1, who: "nics", text: answer, source }]);
      setBusy(false);
      if (session && consent && facts) {
        const r = await logDialog(session, { lang, qtype: topic, question, facts, answer, source });
        if (r.ok && r.data.logged && r.data.id) {
          const id = r.data.id;
          setLines((l) => l.map((x) => (x.key === k * 2 + 1 ? { ...x, logId: id } : x)));
        }
      }
    },
    [busy, consent, lang, player?.displayName, queue, session],
  );

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const q = text.trim().slice(0, MAX_QUESTION);
    if (!q) return;
    setText("");
    void ask(classify(q), q);
  };

  const rate = async (line: Line, rating: 1 | -1) => {
    if (!session || !line.logId) return;
    const r = await rateDialog(session, line.logId, rating);
    if (r.ok) {
      setLines((l) => l.map((x) => (x.key === line.key ? { ...x, rated: rating } : x)));
      setNote(t.thanks);
    } else setNote(t.error);
  };

  const choose = async (yes: boolean) => {
    if (!session) return;
    const r = yes ? await setConsent(session, true) : await forgetDialogs(session);
    if (!r.ok) return setNote(t.error);
    setConsentState(yes);
    setLines((l) => l.map((x) => ({ ...x, logId: yes ? x.logId : undefined })));
    if (!yes && "deleted" in r.data && r.data.deleted > 0) setNote(t.deleted(r.data.deleted));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(640px,92dvh)] w-[calc(100vw-1rem)] max-w-lg flex-col gap-0 overflow-hidden p-0">
        <header className="flex items-center gap-3 border-b border-border bg-cyan-500/5 px-4 py-3 pr-10">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-cyan-300/50 bg-cyan-400/10 shadow-[0_0_18px_rgba(34,211,238,0.35)]">
            <Cpu className="h-5 w-5 text-cyan-300" />
          </span>
          <div className="min-w-0">
            <DialogTitle className="font-display text-lg font-bold leading-tight">{t.title}</DialogTitle>
            <DialogDescription className="truncate text-xs">{t.subtitle}</DialogDescription>
          </div>
        </header>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3" aria-live="polite">
          {lines.length === 0 && <Bubble who="nics">{t.intro}</Bubble>}
          {lines.map((l) => (
            <div key={l.key}>
              <Bubble who={l.who}>{l.text}</Bubble>
              {l.who === "nics" && (
                <div className="mt-1 flex items-center gap-2 pl-1 text-[11px] text-muted-foreground">
                  <span>{l.source === "model" ? t.sourceModel : t.sourcePhrase}</span>
                  {l.logId && (
                    <>
                      <button onClick={() => rate(l, 1)} aria-label={t.helpful} title={t.helpful} className={`hover:text-emerald-300 ${l.rated === 1 ? "text-emerald-300" : ""}`}>
                        <ThumbsUp className="h-3.5 w-3.5" />
                      </button>
                      <button onClick={() => rate(l, -1)} aria-label={t.notHelpful} title={t.notHelpful} className={`hover:text-rose-300 ${l.rated === -1 ? "text-rose-300" : ""}`}>
                        <ThumbsDown className="h-3.5 w-3.5" />
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
          {busy && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {t.thinking}
            </div>
          )}
          <div ref={endRef} />
        </div>

        {session && consent === null && (
          <div className="border-t border-border bg-cyan-500/5 px-4 py-3 text-xs">
            <p className="mb-1 font-semibold text-foreground">{t.consentTitle}</p>
            <p className="mb-2 text-muted-foreground">
              {t.consentText}{" "}
              <Link to="/terms#nics-ai" className="text-primary hover:underline">{t.terms}</Link>
            </p>
            <div className="flex gap-2">
              <button onClick={() => choose(true)} className="h-8 rounded-md bg-cyan-400 px-3 font-semibold text-black hover:bg-cyan-300">{t.consentYes}</button>
              <button onClick={() => setConsentState(false)} className="h-8 rounded-md border border-border px-3 hover:border-primary">{t.consentNo}</button>
            </div>
          </div>
        )}

        <div className="border-t border-border px-3 pb-3 pt-2">
          <div className="mb-2 flex gap-1.5 overflow-x-auto pb-1">
            {MENU.map((topic) => (
              <button
                key={topic}
                disabled={busy}
                onClick={() => ask(topic, t.topicQuestion[topic])}
                className="shrink-0 rounded-full border border-border bg-background/60 px-2.5 py-1 text-xs hover:border-cyan-300 hover:text-cyan-200 disabled:opacity-50"
              >
                {t.topics[topic]}
              </button>
            ))}
          </div>
          <form onSubmit={onSubmit} className="flex gap-2">
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={MAX_QUESTION}
              placeholder={t.placeholder}
              aria-label={t.placeholder}
              className="h-10 min-w-0 flex-1 rounded-md border border-input bg-background/60 px-3 text-sm outline-none focus:border-cyan-300"
            />
            <button type="submit" disabled={busy || !text.trim()} aria-label={t.send} className="flex h-10 w-10 items-center justify-center rounded-md bg-cyan-400 text-black hover:bg-cyan-300 disabled:opacity-50">
              <Send className="h-4 w-4" />
            </button>
          </form>
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
            {!session ? (
              <>
                <span>{t.signedOut}</span>
                <Link to="/login" className="text-primary hover:underline">{t.signIn}</Link>
              </>
            ) : consent === true ? (
              <>
                <span>{t.learningOn}</span>
                <button onClick={() => choose(false)} className="text-primary hover:underline">{t.turnOff}</button>
              </>
            ) : consent === false ? (
              <>
                <span>{t.learningOff}</span>
                <button onClick={() => choose(true)} className="text-primary hover:underline">{t.turnOn}</button>
              </>
            ) : null}
            <Link to="/terms#nics-ai" className="ml-auto hover:text-foreground hover:underline">{t.terms}</Link>
          </div>
          {note && <p className="mt-1 text-[11px] text-cyan-200">{note}</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
};

const Bubble = ({ who, children }: { who: "resident" | "nics"; children: ReactNode }) => (
  <div className={`flex ${who === "resident" ? "justify-end" : "justify-start"}`}>
    <p
      className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm ${
        who === "resident" ? "rounded-br-sm bg-primary text-primary-foreground" : "rounded-bl-sm border border-cyan-300/30 bg-cyan-400/10 text-foreground"
      }`}
    >
      {children}
    </p>
  </div>
);

/** A button that opens the conversation. */
export const NicsChatButton = ({ className, label, children }: { className?: string; label?: string; children?: ReactNode }) => {
  const { language } = useLanguage();
  const t = nicsStrings(language);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)} className={className} aria-label={label ?? t.open} title={label ?? t.open}>
        {children ?? (
          <>
            <Cpu className="h-4 w-4" />
            {label ?? t.open}
          </>
        )}
      </button>
      <NicsChat open={open} onOpenChange={setOpen} />
    </>
  );
};
