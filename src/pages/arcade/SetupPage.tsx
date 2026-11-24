import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Coins, Gamepad2, KeyRound, Loader2, MapPin, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { useLanguage } from "@/i18n/LanguageContext";
import { useAccount } from "@/game/account/AccountContext";
import { useEconomy } from "@/game/economy/EconomyContext";
import {
  TEMPLATES, cancelRent, closeAttraction, fetchArcadeMap, fetchPlotArcade, offerRent, placeAttraction, topUp, updateAttraction,
  type ArcadeLaws, type CustomQuestion, type Difficulty, type PlotArcade, type QuizTopic, type Template,
} from "@/game/arcade/api";
import { arcadeStrings } from "@/game/arcade/strings";
import { mapLink, placeName, useRegistry } from "@/game/arcade/registry";
import { Shell } from "@/game/state/ui";

const TOPICS: QuizTopic[] = ["mixed", "elements", "science", "commonwealth", "world", "custom"];
const DIFFS: Difficulty[] = ["easy", "normal", "hard"];
const blankQ = (): CustomQuestion => ({ q: "", answer: "", wrong: ["", "", ""] });

const input = "h-9 w-full rounded-md border border-input bg-background/60 px-2.5 text-sm outline-none focus:border-fuchsia-300";
const label = "mb-1 block text-xs font-medium text-muted-foreground";

/** /arcade/setup/:plotId — open, change or close the attraction on a plot, and rent the plot out. */
const SetupPage = () => {
  const { plotId } = useParams();
  const id = Number(plotId);
  const nav = useNavigate();
  const { language } = useLanguage();
  const t = arcadeStrings(language);
  const { session } = useAccount();
  const economy = useEconomy();
  const reg = useRegistry();
  const place = reg?.get(id);
  const [info, setInfo] = useState<PlotArcade | null>(null);
  const [laws, setLaws] = useState<ArcadeLaws | null>(null);
  const [busy, setBusy] = useState(false);

  // form
  const [tpl, setTpl] = useState<Template>("quiz");
  const [title, setTitle] = useState("");
  const [diff, setDiff] = useState<Difficulty>("normal");
  const [topic, setTopic] = useState<QuizTopic>("mixed");
  const [qs, setQs] = useState<CustomQuestion[]>([blankQ(), blankQ(), blankQ()]);
  const [fee, setFee] = useState(10);
  const [prize, setPrize] = useState(50);
  const [deposit, setDeposit] = useState(250);
  const [more, setMore] = useState(100);
  const [rentPrice, setRentPrice] = useState(50);
  const [rentDays, setRentDays] = useState(7);

  const load = useCallback(async () => {
    if (!session) return;
    const [r, m] = await Promise.all([fetchPlotArcade(session, id), fetchArcadeMap()]);
    if (r.ok) {
      setInfo(r.data);
      const a = r.data.attraction;
      if (a && !a.ai) {
        setTpl(a.template);
        setTitle(a.title);
        setDiff(a.difficulty);
        setFee(a.entryFee);
        setPrize(a.prize);
      }
      if (r.data.rentOffer) {
        setRentPrice(r.data.rentOffer.pricePerDay);
        setRentDays(r.data.rentOffer.maxDays);
      }
    }
    if (m.ok) setLaws(m.data.laws);
  }, [session, id]);
  useEffect(() => {
    void load();
  }, [load]);

  if (!info) return <Shell title={t.setupTitle} icon={Gamepad2} accent="text-fuchsia-300" back={{ to: "/arcade", label: t.backToArcade }}><Loader2 className="h-5 w-5 animate-spin" /></Shell>;

  const role = info.me?.role;
  const mine = info.attraction && !info.attraction.ai && (role === "owner" || role === "tenant") ? info.attraction : null;
  const canOperate = role === "owner" || role === "tenant";
  const free = info.me?.free ?? 0;
  const done = async (ok: boolean, msg: string) => {
    if (ok) toast.success(msg);
    await economy.refresh();
    await load();
  };

  const submit = async () => {
    if (!session) return;
    setBusy(true);
    const r = await placeAttraction(session, {
      plotId: id, template: tpl, title: title || t.templates[tpl], difficulty: diff, entryFee: fee, prize, deposit,
      ...(tpl === "quiz" ? { topic, questions: topic === "custom" ? qs : undefined } : {}),
    });
    setBusy(false);
    if (!r.ok) return toast.error(t.errors[r.error]);
    await done(true, t.placed);
    nav(mapLink(place?.address));
  };

  return (
    <Shell title={mine ? t.editTitle : t.setupTitle} icon={Gamepad2} accent="text-fuchsia-300" back={{ to: mapLink(place?.address), label: t.back }}>
      {place && (
        <p className="-mt-3 mb-5 flex items-center gap-1.5 text-sm text-muted-foreground">
          <MapPin className="h-4 w-4" />
          {t.onPlot(placeName(place))}
        </p>
      )}
      {!canOperate && <p className="mb-5 rounded-md bg-muted/60 p-3 text-sm text-muted-foreground">{t.notYours}</p>}

      {canOperate && mine && (
        <section className="mb-6 space-y-4 rounded-xl border border-fuchsia-400/30 bg-card/40 p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-display text-lg font-bold">{mine.title}</h2>
            <span className="text-sm text-muted-foreground">{t.templates[mine.template]} · {t.played(mine.plays, mine.wins)}</span>
          </div>
          <p className="text-sm text-cyan-200">{t.poolLeft(mine.pool)}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={label} htmlFor="title">{t.name}</label>
              <input id="title" className={input} value={title} maxLength={40} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <DiffPicker t={t} value={diff} onChange={setDiff} />
            <NumField id="fee" label={t.ticketPrice} value={fee} max={1000} onChange={setFee} />
            <NumField id="prize" label={t.prizePerWin} value={prize} max={10000} onChange={setPrize} />
          </div>
          <button
            disabled={busy}
            onClick={async () => {
              if (!session) return;
              setBusy(true);
              const r = await updateAttraction(session, mine.id, { title, difficulty: diff, entryFee: fee, prize });
              setBusy(false);
              if (!r.ok) toast.error(t.errors[r.error]);
              else await done(true, t.saved);
            }}
            className="h-9 rounded-md bg-fuchsia-400 px-4 text-sm font-semibold text-black hover:bg-fuchsia-300 disabled:opacity-50"
          >
            {busy ? t.saving : t.save}
          </button>
          <div className="flex flex-wrap items-end gap-2 border-t border-border pt-4">
            <div className="w-40">
              <NumField id="more" label={t.topUp} value={more} max={1000000} onChange={setMore} />
            </div>
            <button
              disabled={busy || more < 1 || more > free}
              onClick={async () => {
                if (!session) return;
                setBusy(true);
                const r = await topUp(session, mine.id, more);
                setBusy(false);
                if (!r.ok) toast.error(t.errors[r.error]);
                else await done(true, t.poolLeft(r.data.attraction.pool));
              }}
              className="flex h-9 items-center gap-1.5 rounded-md border border-cyan-300/60 px-3 text-sm font-semibold text-cyan-100 hover:bg-cyan-400/10 disabled:opacity-50"
            >
              <Coins className="h-4 w-4" />
              {t.topUp}
            </button>
            <button
              disabled={busy}
              onClick={async () => {
                if (!session) return;
                setBusy(true);
                const r = await closeAttraction(session, mine.id);
                setBusy(false);
                if (!r.ok) toast.error(t.errors[r.error]);
                else await done(true, t.closed(r.data.refund));
              }}
              className="ml-auto flex h-9 items-center gap-1.5 rounded-md border border-rose-400/50 px-3 text-sm text-rose-200 hover:bg-rose-500/10"
            >
              <X className="h-4 w-4" />
              {t.close}
            </button>
          </div>
          <p className="text-xs text-muted-foreground">{t.freeToSpend(free)}</p>
        </section>
      )}

      {canOperate && !mine && (
        <section className="mb-6 space-y-5 rounded-xl border border-fuchsia-400/30 bg-card/40 p-4">
          <div>
            <span className={label}>{t.game}</span>
            <div className="grid gap-2 sm:grid-cols-5">
              {TEMPLATES.map((k) => (
                <button
                  key={k}
                  onClick={() => setTpl(k)}
                  aria-pressed={tpl === k}
                  className={`rounded-lg border p-2.5 text-left transition ${tpl === k ? "border-fuchsia-300 bg-fuchsia-400/15" : "border-border hover:border-fuchsia-300/60"}`}
                >
                  <div className="text-sm font-semibold">{t.templates[k]}</div>
                  <div className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{t.templateAbout[k]}</div>
                </button>
              ))}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={label} htmlFor="title">{t.name}</label>
              <input id="title" className={input} value={title} placeholder={t.templates[tpl]} maxLength={40} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <DiffPicker t={t} value={diff} onChange={setDiff} />
          </div>
          {tpl === "quiz" && (
            <div className="space-y-3">
              <div>
                <label className={label} htmlFor="topic">{t.topic}</label>
                <select id="topic" className={input} value={topic} onChange={(e) => setTopic(e.target.value as QuizTopic)}>
                  {TOPICS.map((k) => (
                    <option key={k} value={k}>{t.topics[k]}</option>
                  ))}
                </select>
              </div>
              {topic === "custom" && (
                <div className="space-y-3">
                  <p className="text-xs text-muted-foreground">{t.writeQuestions}</p>
                  {qs.map((q, i) => (
                    <div key={i} className="space-y-1.5 rounded-lg border border-border p-2.5">
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        {t.question(i + 1)}
                        {qs.length > 3 && (
                          <button onClick={() => setQs(qs.filter((_, k) => k !== i))} className="flex items-center gap-1 hover:text-rose-300">
                            <Trash2 className="h-3.5 w-3.5" />
                            {t.removeQuestion}
                          </button>
                        )}
                      </div>
                      <input aria-label={t.question(i + 1)} className={input} maxLength={140} value={q.q} onChange={(e) => setQs(qs.map((x, k) => (k === i ? { ...x, q: e.target.value } : x)))} />
                      <div className="grid gap-1.5 sm:grid-cols-4">
                        <input aria-label={t.answer} placeholder={t.answer} className={`${input} border-emerald-400/50`} maxLength={60} value={q.answer} onChange={(e) => setQs(qs.map((x, k) => (k === i ? { ...x, answer: e.target.value } : x)))} />
                        {q.wrong.map((w, j) => (
                          <input key={j} aria-label={t.wrongs} placeholder={t.wrongs} className={input} maxLength={60} value={w}
                            onChange={(e) => setQs(qs.map((x, k) => (k === i ? { ...x, wrong: x.wrong.map((y, m) => (m === j ? e.target.value : y)) as CustomQuestion["wrong"] } : x)))} />
                        ))}
                      </div>
                    </div>
                  ))}
                  {qs.length < 10 && (
                    <button onClick={() => setQs([...qs, blankQ()])} className="flex items-center gap-1.5 text-sm text-fuchsia-200 hover:underline">
                      <Plus className="h-4 w-4" />
                      {t.addQuestion}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-3">
            <NumField id="fee" label={t.ticketPrice} value={fee} max={1000} onChange={setFee} />
            <NumField id="prize" label={t.prizePerWin} value={prize} max={10000} onChange={setPrize} />
            <NumField id="deposit" label={t.deposit} value={deposit} max={1000000} onChange={setDeposit} />
          </div>
          {laws && <p className="text-xs text-muted-foreground">{t.economyNote(laws.entryTaxPct, laws.prizeTaxPct)}</p>}
          <p className={`text-xs ${deposit > free ? "text-rose-300" : "text-muted-foreground"}`}>{t.freeToSpend(free)}</p>
          <button
            disabled={busy || deposit > free}
            onClick={() => void submit()}
            className="flex h-11 items-center gap-2 rounded-lg bg-gradient-to-r from-fuchsia-400 to-cyan-300 px-5 text-sm font-bold text-black hover:brightness-110 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Gamepad2 className="h-4 w-4" />}
            {t.open_}
          </button>
        </section>
      )}

      {role === "owner" && !info.rental && (
        <section id="rent" className="space-y-3 rounded-xl border border-amber-300/30 bg-card/40 p-4">
          <h2 className="flex items-center gap-2 font-display text-lg font-bold">
            <KeyRound className="h-5 w-5 text-amber-300" />
            {t.offerTitle}
          </h2>
          <p className="text-sm text-muted-foreground">{t.offerNote}</p>
          {info.rentOffer && <p className="text-sm text-amber-200">{t.forRent(info.rentOffer.pricePerDay, info.rentOffer.maxDays)}</p>}
          <div className="flex flex-wrap items-end gap-2">
            <div className="w-32"><NumField id="rp" label={t.pricePerDay} value={rentPrice} max={100000} onChange={setRentPrice} /></div>
            <div className="w-28"><NumField id="rd" label={t.maxDays} value={rentDays} max={30} onChange={setRentDays} /></div>
            <button
              disabled={busy || rentPrice < 1 || rentDays < 1}
              onClick={async () => {
                if (!session) return;
                const r = await offerRent(session, id, rentPrice, rentDays);
                if (!r.ok) toast.error(t.errors[r.error]);
                else await done(true, t.offered);
              }}
              className="h-9 rounded-md bg-amber-300 px-4 text-sm font-semibold text-black hover:bg-amber-200 disabled:opacity-50"
            >
              {t.offer}
            </button>
            {info.rentOffer && (
              <button
                onClick={async () => {
                  if (!session) return;
                  const r = await cancelRent(session, id);
                  if (!r.ok) toast.error(t.errors[r.error]);
                  else await done(true, t.saved);
                }}
                className="h-9 rounded-md border border-border px-3 text-sm hover:border-rose-300"
              >
                {t.withdrawOffer}
              </button>
            )}
          </div>
          {laws && <p className="text-xs text-muted-foreground">{t.rentTotal(rentPrice * rentDays, Math.round((rentPrice * rentDays * laws.rentTaxPct) / 100))}</p>}
        </section>
      )}
      <p className="mt-6 text-sm"><Link to="/arcade" className="text-fuchsia-200 hover:underline">{t.backToArcade} →</Link></p>
    </Shell>
  );
};

function DiffPicker({ t, value, onChange }: { t: ReturnType<typeof arcadeStrings>; value: Difficulty; onChange: (d: Difficulty) => void }) {
  return (
    <div>
      <span className={label}>{t.difficulty}</span>
      <div className="flex gap-1.5">
        {DIFFS.map((d) => (
          <button key={d} onClick={() => onChange(d)} aria-pressed={value === d}
            className={`h-9 flex-1 rounded-md border text-sm ${value === d ? "border-fuchsia-300 bg-fuchsia-400/15 font-semibold" : "border-border hover:border-fuchsia-300/60"}`}>
            {t.difficulties[d]}
          </button>
        ))}
      </div>
    </div>
  );
}

function NumField({ id, label: l, value, max, onChange }: { id: string; label: string; value: number; max: number; onChange: (n: number) => void }) {
  return (
    <div>
      <label className={label} htmlFor={id}>{l}</label>
      <input id={id} type="number" min={0} max={max} className={input} value={value}
        onChange={(e) => onChange(Math.max(0, Math.min(max, Math.floor(Number(e.target.value) || 0))))} />
    </div>
  );
}

export default SetupPage;
