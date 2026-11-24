import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Cpu, Crown, Loader2, UserRound, Users } from "lucide-react";
import { useLanguage } from "@/i18n/LanguageContext";
import { fetchCouncil, type AccountError, type CouncilInfo } from "@/game/account/api";
import { accountLocale, accountStrings } from "@/game/account/strings";

/** Public page: the eleven seats of the Council of First Light. */
const Council = () => {
  const { language } = useLanguage();
  const t = accountStrings(language);
  const [info, setInfo] = useState<CouncilInfo | null>(null);
  const [error, setError] = useState<AccountError | null>(null);

  const load = () => {
    setError(null);
    fetchCouncil().then((r) => (r.ok ? setInfo(r.data) : setError(r.error)));
  };
  useEffect(load, []);

  const date = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString(accountLocale(language), { year: "numeric", month: "short", day: "numeric" }) : "";

  const seats = info
    ? Array.from({ length: info.seatsTotal }, (_, i) => info.members.find((m) => m.seat === i + 1) ?? null)
    : [];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="flex items-center gap-2 px-4 py-3">
        <Link to="/world" className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
          {t.brand}
        </Link>
      </header>
      <main className="mx-auto max-w-4xl px-4 pb-16">
        <div className="mb-6 space-y-2">
          <div className="flex items-center gap-2 text-amber-300">
            <Crown className="h-6 w-6" />
            <h1 className="font-display text-2xl font-bold text-foreground md:text-3xl">{t.councilTitle}</h1>
          </div>
          <p className="max-w-2xl text-sm text-muted-foreground">{t.councilIntro}</p>
          {info && (
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Users className="h-4 w-4" />
              {t.citizensCount(info.citizens)}
            </p>
          )}
        </div>

        {!info && !error && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t.loading}
          </p>
        )}
        {error && (
          <p className="text-sm text-destructive">
            {t.errors[error]}{" "}
            <button onClick={load} className="text-primary hover:underline">{t.retry}</button>
          </p>
        )}

        <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {seats.map((m, i) =>
            m ? (
              <li key={i} className="rounded-xl border border-amber-400/50 bg-amber-400/5 p-4">
                <div className="mb-2 flex items-center justify-between text-xs text-amber-300">
                  <span>{t.seat(m.seat)}</span>
                  <span className="inline-flex items-center gap-1">
                    {m.kind === "ai" ? <Cpu className="h-3.5 w-3.5" /> : <UserRound className="h-3.5 w-3.5" />}
                    {m.kind === "ai" ? t.aiMember : t.humanMember}
                  </span>
                </div>
                <div className="font-display text-lg font-bold">{m.name}</div>
                <div className="text-sm text-amber-200">{m.title}</div>
                {m.joinedAt && <div className="mt-2 text-xs text-muted-foreground">{t.since} {date(m.joinedAt)}</div>}
              </li>
            ) : (
              <li key={i} className="rounded-xl border border-dashed border-border p-4 text-muted-foreground">
                <div className="mb-2 text-xs">{t.seat(i + 1)}</div>
                <div className="font-medium">{t.openSeat}</div>
                <div className="text-xs">{t.openSeatNote}</div>
              </li>
            ),
          )}
        </ol>
      </main>
    </div>
  );
};

export default Council;
