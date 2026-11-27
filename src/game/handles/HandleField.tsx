import { useEffect, useRef, useState, type FormEvent } from "react";
import { AtSign, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useLanguage } from "@/i18n/LanguageContext";
import { accountLocale } from "@/game/account/strings";
import { checkHandle, fetchMyHandle, normalizeHandle, setHandle, validHandle, type HandleError, type MyHandle } from "./api";
import { handleStrings } from "./strings";

interface Props {
  session: string;
  /** sign-up step: big title and a "Keep and continue" button */
  onDone?: () => void;
  onSessionEnd?: () => void;
}

/** Shows and changes the resident's unique @handle. */
const HandleField = ({ session, onDone, onSessionEnd }: Props) => {
  const { language } = useLanguage();
  const t = handleStrings(language);
  const [mine, setMine] = useState<MyHandle | null>(null);
  const [value, setValue] = useState("");
  const [state, setState] = useState<"idle" | "checking" | "free" | HandleError>("idle");
  const [busy, setBusy] = useState(false);
  const cb = useRef({ onDone, onSessionEnd });
  cb.current = { onDone, onSessionEnd };

  useEffect(() => {
    let live = true;
    void fetchMyHandle(session).then((r) => {
      if (!live) return;
      if (r.ok) {
        setMine(r.data);
        setValue(r.data.handle);
      } else if (r.error === "session") cb.current.onSessionEnd?.();
      else cb.current.onDone?.(); // sign-up never gets stuck on this step
    });
    return () => {
      live = false;
    };
  }, [session]);

  const h = normalizeHandle(value);
  const same = !!mine && h === mine.handle;
  const locked = !!mine?.next && new Date(mine.next) > new Date();

  useEffect(() => {
    if (!mine || same) return setState("idle");
    if (!validHandle(h)) return setState(h.length >= 3 ? "format" : "idle");
    setState("checking");
    const id = setTimeout(() => {
      void checkHandle(session, h).then((r) => setState(r.ok ? "free" : r.error));
    }, 350);
    return () => clearTimeout(id);
  }, [h, same, mine, session]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (same) return onDone?.();
    if (!validHandle(h)) return setState("format");
    setBusy(true);
    const r = await setHandle(session, h);
    setBusy(false);
    if (!r.ok) {
      if (r.error === "session") return onSessionEnd?.();
      return setState(r.error);
    }
    setMine(r.data);
    setValue(r.data.handle);
    toast.success(t.changed(r.data.handle));
    onDone?.();
  };

  const date = (iso: string) => new Date(iso).toLocaleDateString(accountLocale(language), { month: "long", day: "numeric" });
  const message =
    state === "checking" ? <span className="text-muted-foreground">{t.checking}</span>
    : state === "free" ? <span className="text-emerald-400">{t.free(h)}</span>
    : state !== "idle" ? <span role="alert" className="text-destructive">{t.errors[state]}</span>
    : locked && mine?.next ? <span className="text-muted-foreground">{t.nextChange(date(mine.next))}</span>
    : mine?.auto ? <span className="text-muted-foreground">{onDone ? t.suggested : t.autoNote}</span>
    : <span className="text-muted-foreground">{t.hint}</span>;

  return (
    <form onSubmit={save} className="space-y-2" noValidate>
      {onDone ? (
        <div className="space-y-1">
          <h1 className="font-display text-2xl font-bold">{t.pickTitle}</h1>
          <p className="text-sm text-muted-foreground">{t.pickIntro}</p>
        </div>
      ) : null}
      <label className="block space-y-1.5">
        {!onDone && <span className="text-sm font-medium">{t.label}</span>}
        <div className="flex gap-2">
          <div className="relative min-w-0 flex-1">
            <AtSign className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={value}
              disabled={!mine || (locked && !onDone)}
              autoFocus={!!onDone}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              maxLength={21}
              onChange={(e) => setValue(e.target.value.replace(/[^A-Za-z0-9_@]/g, "").toLowerCase())}
              placeholder={mine ? mine.handle : "…"}
              className="h-11 w-full rounded-md border border-input bg-background/60 pl-9 pr-3 text-base outline-none focus:border-primary disabled:opacity-60"
            />
          </div>
          {!onDone && (
            <button
              type="submit"
              disabled={busy || !mine || same || state === "checking" || (state !== "free" && state !== "idle")}
              className="flex h-11 items-center gap-1.5 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : same && mine ? <Check className="h-4 w-4" /> : null}
              {same && mine ? t.saved : t.save}
            </button>
          )}
        </div>
      </label>
      <p className="text-xs">{message}</p>
      {onDone && (
        <button
          type="submit"
          disabled={busy || !mine || state === "checking" || (state !== "free" && state !== "idle")}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-md bg-primary text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          {same ? t.keep : t.save}
        </button>
      )}
    </form>
  );
};

export default HandleField;
