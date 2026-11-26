import { useEffect, useRef, useState } from "react";
import { Brain, Cpu, Database, Loader2, Sprout } from "lucide-react";
import { useLanguage } from "@/i18n/LanguageContext";
import { Shell } from "@/game/state/ui";
import { Panel, btnMain, btnSoft } from "@/game/bank/ui";
import { fetchMindStatus, type MindRelease, type MindStatus } from "@/game/mind/api";
import { mindStrings } from "@/game/mind/strings";
import { EXAM, sampleFacts } from "@/game/mind/prompt";
import type { Topic } from "@/game/nics/topics";

const Num = ({ label, v }: { label: string; v: number }) => (
  <div className="rounded-xl border border-border bg-card/60 p-3">
    <div className="text-xs text-muted-foreground">{label}</div>
    <div className="font-display text-lg font-bold text-cyan-100">{v.toLocaleString("en")}</div>
  </div>
);

/** Try the live release in a Web Worker: download, check sha256, answer on the device. */
function TryLive({ r, t }: { r: MindRelease; t: ReturnType<typeof mindStrings> }) {
  const worker = useRef<Worker | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "thinking" | "error">("idle");
  const [bytes, setBytes] = useState(0);
  const [pick, setPick] = useState(0);
  const [answer, setAnswer] = useState<string | null | undefined>(undefined);
  useEffect(() => () => worker.current?.terminate(), []);

  const load = () => {
    const w = new Worker(new URL("../game/mind/worker.ts", import.meta.url), { type: "module" });
    worker.current = w;
    w.onmessage = (e) => {
      const m = e.data;
      if (m.type === "progress") setBytes(m.bytes);
      else if (m.type === "ready") setState("ready");
      else if (m.type === "answer") {
        setAnswer(m.text);
        setState("ready");
      } else if (m.type === "error") setState("error");
    };
    setState("loading");
    w.postMessage({ type: "load", baseUrl: r.baseUrl });
  };
  const ask = () => {
    const [topic, question] = EXAM[pick] as [Topic, string];
    setState("thinking");
    setAnswer(undefined);
    worker.current?.postMessage({ type: "ask", id: Date.now(), topic, question, facts: sampleFacts(topic) });
  };

  return (
    <Panel title={t.tryTitle} icon={Cpu}>
      <p className="text-sm text-muted-foreground">{t.tryNote(r.weightsBytes)}</p>
      {state === "idle" && <button type="button" className={btnMain} onClick={load}><Brain className="h-4 w-4" />{t.load}</button>}
      {state === "loading" && <p className="flex items-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin" />{t.loading(bytes, r.weightsBytes)}</p>}
      {state === "error" && <p className="text-sm text-red-300">{t.loadError}</p>}
      {(state === "ready" || state === "thinking") && (
        <div className="space-y-3">
          <p className="text-sm text-emerald-300">{t.ready}</p>
          <p className="text-xs text-muted-foreground">{t.sample}</p>
          <div className="flex flex-wrap gap-2">
            <select className="h-9 rounded-md border border-border bg-background px-2 text-sm" value={pick} onChange={(e) => setPick(Number(e.target.value))}>
              {EXAM.map(([topic, q], i) => <option key={i} value={i}>{q} ({topic})</option>)}
            </select>
            <button type="button" className={btnSoft} disabled={state === "thinking"} onClick={ask}>
              {state === "thinking" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{state === "thinking" ? t.thinking : t.ask}
            </button>
          </div>
          {answer !== undefined && (answer ? <p className="rounded-lg border border-cyan-400/40 bg-cyan-400/10 p-3 text-sm">{answer}</p> : <p className="text-sm text-amber-200">{t.failedCheck}</p>)}
        </div>
      )}
    </Panel>
  );
}

/** /mind: which version of NICS Language lives in the city, and what the city gives back to it. */
const Mind = () => {
  const { language } = useLanguage();
  const t = mindStrings(language);
  const [s, setS] = useState<MindStatus | null | undefined>(undefined);
  useEffect(() => {
    void fetchMindStatus().then(setS);
  }, []);

  return (
    <Shell title={t.title} icon={Brain} accent="text-cyan-300" back={{ to: "/world", label: t.backToWorld }}>
      <p className="mb-5 max-w-2xl text-sm text-muted-foreground">{t.intro}</p>
      {s === undefined && <Loader2 className="h-5 w-5 animate-spin" />}
      {s === null && <p className="text-sm text-amber-200">{t.offline}</p>}
      {s && (
        <div className="space-y-5">
          <Panel title={t.liveTitle} icon={Brain}>
            {s.live ? (
              <div className="space-y-1 text-sm">
                <p className="font-display text-xl font-bold text-cyan-100">{s.live.modelId} · {t.version(s.live.version)}</p>
                <p className="text-muted-foreground">{t.params(s.live.params)} · {t.step(s.live.step)} · {s.live.exam ? t.exam(s.live.exam.passed, s.live.exam.total) : t.examNone}</p>
              </div>
            ) : (
              <p className="text-sm">{t.noLive}</p>
            )}
            <p className="text-xs text-muted-foreground">{t.examRule(s.examMin)}</p>
          </Panel>
          {s.live && <TryLive r={s.live} t={t} />}
          <Panel title={t.releasesTitle} icon={Sprout}>
            {s.releases.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t.noReleases}</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {s.releases.map((r) => (
                  <li key={r.version} className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg border border-border px-3 py-2">
                    <span className="font-semibold">{t.version(r.version)} <span className="text-muted-foreground">· {t.params(r.params)} · {t.step(r.step)}</span></span>
                    <span className={r.status === "live" ? "text-emerald-300" : "text-muted-foreground"}>{t.status[r.status]}{r.exam ? ` · ${t.exam(r.exam.passed, r.exam.total)}` : ""}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel title={t.dataTitle} icon={Database}>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <Num label={t.consenting} v={s.data.consenting} />
              <Num label={t.lines} v={s.data.lines} />
              <Num label={t.week} v={s.data.week} />
              <Num label={t.sent} v={s.data.sent} />
              <Num label={t.dropped} v={s.data.dropped} />
            </div>
            <p className="text-xs text-muted-foreground">{t.lastFetch(s.data.lastFetch)}</p>
            <p className="text-xs text-muted-foreground">{t.dataNote}</p>
          </Panel>
        </div>
      )}
      <div className="mt-5">
        <Panel title={t.growTitle} icon={Sprout}>
          <ol className="list-decimal space-y-1 pl-5 text-sm">
            {t.grow.map((g) => <li key={g}>{g}</li>)}
          </ol>
        </Panel>
      </div>
    </Shell>
  );
};

export default Mind;
