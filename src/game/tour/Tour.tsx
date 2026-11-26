import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Building2, Coins, Droplet, MapPin, TrainFront, X } from "lucide-react";
import { useLanguage } from "@/i18n/LanguageContext";
import { tourStrings } from "./strings";

const KEY = (email: string) => `aquaterra-tour-done:${email}`;

export const tourDone = (email: string): boolean => {
  try {
    return localStorage.getItem(KEY(email)) === "1";
  } catch {
    return false;
  }
};

const markDone = (email: string) => {
  try {
    localStorage.setItem(KEY(email), "1");
  } catch {
    /* private mode: the tour simply shows again next time */
  }
};

type StepId = "drop" | "plot" | "buy" | "build" | "travel";
const STEPS: { id: StepId; icon: typeof Droplet; tint: string }[] = [
  { id: "drop", icon: Droplet, tint: "text-cyan-300" },
  { id: "plot", icon: MapPin, tint: "text-primary" },
  { id: "buy", icon: Coins, tint: "text-cyan-300" },
  { id: "build", icon: Building2, tint: "text-amber-300" },
  { id: "travel", icon: TrainFront, tint: "text-emerald-300" },
];

/**
 * First-visit tour of the world map: five short cards (drop, plots, buying for
 * Tide, building, travel). Shown once per resident on this device; the Tour
 * button on the map replays it.
 */
const Tour = ({ email, balance, onFindMe, onClose }: { email: string; balance: number | null; onFindMe: () => void; onClose: () => void }) => {
  const { language } = useLanguage();
  const t = tourStrings(language);
  const [i, setI] = useState(0);
  const step = STEPS[i];
  const last = i === STEPS.length - 1;

  const finish = () => {
    markDone(email);
    onClose();
  };

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish();
      else if (e.key === "ArrowRight" && !last) setI(i + 1);
      else if (e.key === "ArrowLeft" && i > 0) setI(i - 1);
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  });

  const Icon = step.icon;
  const s = t.steps[step.id];
  const body = step.id === "buy" ? t.steps.buy.body(balance == null ? null : balance.toLocaleString("en")) : (s.body as string);

  return (
    <div
      role="dialog"
      aria-label={t.label}
      className="absolute inset-x-2 bottom-[max(0.5rem,env(safe-area-inset-bottom))] z-30 rounded-xl border border-cyan-300/40 bg-background/95 p-4 shadow-2xl backdrop-blur animate-in fade-in slide-in-from-bottom-4 md:inset-x-auto md:bottom-6 md:left-1/2 md:w-[26rem] md:-translate-x-1/2"
    >
      <button onClick={finish} aria-label={t.close} className="absolute right-3 top-3 rounded-md p-0.5 text-muted-foreground hover:text-foreground">
        <X className="h-4 w-4" />
      </button>
      <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
        <span className="font-semibold uppercase tracking-wide text-cyan-300">{t.label}</span>
        <span>· {t.stepOf(i + 1, STEPS.length)}</span>
      </div>
      <div className="flex gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border bg-background">
          <Icon className={`h-5 w-5 ${step.tint}`} />
        </div>
        <div className="min-w-0 pr-4">
          <h2 className="font-display text-base font-bold leading-tight">{s.title}</h2>
          <p className="mt-1 text-sm leading-snug text-muted-foreground">{body}</p>
          {step.id === "drop" && (
            <button onClick={onFindMe} className="mt-2 text-sm font-semibold text-cyan-300 hover:text-cyan-200">
              {t.steps.drop.action} →
            </button>
          )}
          {step.id === "buy" && (
            <Link to="/wallet" onClick={() => markDone(email)} className="mt-2 inline-block text-sm font-semibold text-cyan-300 hover:text-cyan-200">
              {t.steps.buy.action} →
            </Link>
          )}
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <div className="flex gap-1" aria-hidden>
          {STEPS.map((x, k) => (
            <span key={x.id} className={`h-1.5 rounded-full transition-all ${k === i ? "w-5 bg-cyan-300" : "w-1.5 bg-muted-foreground/40"}`} />
          ))}
        </div>
        {!last && (
          <button onClick={finish} className="ml-auto text-xs text-muted-foreground hover:text-foreground">
            {t.skip}
          </button>
        )}
        <div className={`flex gap-2 ${last ? "ml-auto" : ""}`}>
          {i > 0 && (
            <button onClick={() => setI(i - 1)} className="h-9 rounded-md border border-border px-3 text-sm hover:border-primary">
              {t.back}
            </button>
          )}
          <button
            onClick={() => (last ? finish() : setI(i + 1))}
            className="h-9 rounded-md bg-cyan-400 px-3 text-sm font-semibold text-black hover:bg-cyan-300"
          >
            {last ? t.done : t.next}
          </button>
        </div>
      </div>
    </div>
  );
};

export default Tour;
