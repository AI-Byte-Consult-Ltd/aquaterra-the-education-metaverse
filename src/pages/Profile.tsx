import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, Check, Coins, Crown, Globe2, Loader2, LogOut, UserRound, Users, Landmark } from "lucide-react";
import { useLanguage } from "@/i18n/LanguageContext";
import { useAccount } from "@/game/account/AccountContext";
import { isStaff, safeNext, saveDisplayName, validDisplayName, type AccountError } from "@/game/account/api";
import CouncilBadge from "@/game/account/CouncilBadge";
import { stateStrings } from "@/game/state/strings";
import HomePicker from "@/game/state/HomePicker";
import { accountLocale, accountStrings } from "@/game/account/strings";
import { useEconomy } from "@/game/economy/EconomyContext";
import { economyStrings } from "@/game/economy/strings";

const Profile = () => {
  const { language } = useLanguage();
  const t = accountStrings(language);
  const { player, session, updatePlayer, signOut } = useAccount();
  const te = economyStrings(language);
  const { wallet } = useEconomy();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const welcome = params.get("welcome") === "1";
  const next = safeNext(params.get("next"));

  const [name, setName] = useState(player?.displayName ?? "");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<AccountError | null>(null);
  // sign-up: name first, then the home district
  const [step, setStep] = useState<"name" | "home">("name");

  useEffect(() => {
    setName(player?.displayName ?? "");
  }, [player?.displayName]);

  if (!player || !session) return null;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!validDisplayName(name)) return setError("name");
    setBusy(true);
    setError(null);
    setSaved(false);
    const r = await saveDisplayName(session, name);
    setBusy(false);
    if (!r.ok) {
      if (r.error === "session") {
        signOut();
        return;
      }
      return setError(r.error);
    }
    updatePlayer(r.data.player);
    setSaved(true);
    if (welcome) setStep("home");
  };

  const since = player.createdAt
    ? new Date(player.createdAt).toLocaleDateString(accountLocale(language), { year: "numeric", month: "long", day: "numeric" })
    : "—";

  if (welcome && step === "home") {
    return (
      <div className="flex min-h-screen flex-col bg-background text-foreground">
        <main className="flex flex-1 items-start justify-center px-4 py-8 md:items-center">
          <div className="w-full max-w-md rounded-2xl border border-border bg-card/80 p-6 shadow-2xl backdrop-blur">
            <HomePicker onDone={() => navigate(next, { replace: true })} />
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="flex items-center justify-between gap-2 px-4 py-3">
        <Link to="/world" className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
          {t.brand}
        </Link>
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pb-16 pt-6 md:items-center md:pt-0">
        <div className="w-full max-w-md space-y-6 rounded-2xl border border-border bg-card/80 p-6 shadow-2xl backdrop-blur">
          <div className="flex items-center gap-3">
            <div
              className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full ${player.council ? "bg-amber-400/15 text-amber-300 ring-1 ring-amber-400/60" : "bg-primary/15 text-primary"}`}
            >
              {player.council ? <Crown className="h-6 w-6" /> : <UserRound className="h-6 w-6" />}
            </div>
            <div className="min-w-0 space-y-1">
              <h1 className="font-display text-2xl font-bold">{welcome ? t.chooseName : t.profileTitle}</h1>
              <CouncilBadge player={player} label={t.councilBadge} />
              <p className="text-sm text-muted-foreground">{t.profileIntro}</p>
            </div>
          </div>

          <form onSubmit={save} className="space-y-2" noValidate>
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">{t.displayName}</span>
              <div className="flex gap-2">
                <input
                  value={name}
                  autoFocus={welcome}
                  maxLength={24}
                  onChange={(e) => { setName(e.target.value); setSaved(false); }}
                  placeholder={t.displayNamePlaceholder}
                  className="h-11 min-w-0 flex-1 rounded-md border border-input bg-background/60 px-3 text-base outline-none focus:border-primary"
                />
                <button
                  type="submit"
                  disabled={busy}
                  className="flex h-11 items-center gap-1.5 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : saved ? <Check className="h-4 w-4" /> : null}
                  {busy ? t.saving : saved ? t.saved : t.save}
                </button>
              </div>
            </label>
            {error ? <p role="alert" className="text-sm text-destructive">{t.errors[error]}</p> : <p className="text-xs text-muted-foreground">{t.displayNameHint}</p>}
          </form>

          <Link
            to="/wallet"
            className="flex items-center justify-between gap-3 rounded-xl border border-cyan-400/40 bg-cyan-400/10 px-4 py-3 hover:border-cyan-300"
          >
            <span className="flex items-center gap-2 text-sm text-cyan-200">
              <Coins className="h-4 w-4" />
              {te.walletTitle}
            </span>
            <span className="text-right">
              <span className="block font-display text-xl font-bold tabular-nums">{wallet ? te.tide(wallet.balance) : "…"}</span>
              <span className="block text-xs text-muted-foreground">
                {te.myLand}: {wallet?.plots.length ?? 0} · {te.openWallet} →
              </span>
            </span>
          </Link>

          <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted-foreground">{t.email}</dt>
            <dd className="truncate font-medium">{player.email}</dd>
            <dt className="text-muted-foreground">{t.memberSince}</dt>
            <dd className="font-medium">{since}</dd>
            <dt className="text-muted-foreground">{t.roleLabel}</dt>
            <dd className="font-medium">
              {player.council ? (
                <Link to="/state/council" className="text-amber-300 hover:underline">
                  {t.councilName}, {t.councilMember(player.council.seat, player.council.title)}
                </Link>
              ) : (
                t.roles[player.role ?? "citizen"]
              )}
            </dd>
          </dl>

          <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
            <Link to="/state/council" className="inline-flex items-center gap-1.5 text-amber-300 hover:underline">
              <Crown className="h-4 w-4" />
              {t.viewCouncil}
            </Link>
            <Link to="/state" className="inline-flex items-center gap-1.5 text-primary hover:underline">
              <Landmark className="h-4 w-4" />
              {stateStrings(language).commonwealth}
            </Link>
            {isStaff(player) && (
              <Link to="/admin" className="inline-flex items-center gap-1.5 text-primary hover:underline">
                <Users className="h-4 w-4" />
                {t.adminLink}
              </Link>
            )}
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <Link
              to={welcome ? next : "/world"}
              className="flex h-11 flex-1 items-center justify-center gap-2 rounded-md border border-primary/50 text-sm font-semibold text-primary hover:bg-primary/10"
            >
              <Globe2 className="h-4 w-4" />
              {t.openWorld}
            </Link>
            <button
              onClick={() => { signOut(); navigate("/", { replace: true }); }}
              className="flex h-11 items-center justify-center gap-2 rounded-md border border-border px-4 text-sm text-muted-foreground hover:text-foreground"
            >
              <LogOut className="h-4 w-4" />
              {t.signOut}
            </button>
          </div>
        </div>
      </main>
    </div>
  );
};

export default Profile;
