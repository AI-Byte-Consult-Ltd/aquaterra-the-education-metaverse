import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, Loader2, Mail } from "lucide-react";
import { useLanguage } from "@/i18n/LanguageContext";
import { useAccount } from "@/game/account/AccountContext";
import { requestCode, safeNext, validEmail, verifyCode, type AccountError } from "@/game/account/api";
import { accountStrings } from "@/game/account/strings";
import { termsStrings } from "@/game/account/terms";

const Login = () => {
  const { language } = useLanguage();
  const t = accountStrings(language);
  const { status, signIn } = useAccount();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"));

  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AccountError | null>(null);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (status === "signed-in") navigate(next, { replace: true });
  }, [status, next, navigate]);

  useEffect(() => {
    if (step === "code") codeRef.current?.focus();
  }, [step]);

  const send = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!validEmail(email)) return setError("email");
    setBusy(true);
    setError(null);
    const r = await requestCode(email);
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setCode("");
    setStep("code");
  };

  const verify = async (e: FormEvent) => {
    e.preventDefault();
    const digits = code.replace(/\D/g, "");
    if (digits.length !== 6) return setError("code");
    setBusy(true);
    setError(null);
    const r = await verifyCode(email, digits);
    setBusy(false);
    if (!r.ok) return setError(r.error);
    signIn({ session: r.data.session, player: r.data.player });
    // First visit: ask for a citizen name, then go on to the world.
    navigate(r.data.player.displayName ? next : `/profile?welcome=1&next=${encodeURIComponent(next)}`, { replace: true });
  };

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="flex items-center gap-2 px-4 py-3">
        <Link to="/" className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
          {t.back}
        </Link>
      </header>
      <main className="flex flex-1 items-center justify-center px-4 pb-16">
        <div className="w-full max-w-sm rounded-2xl border border-border bg-card/80 p-6 shadow-2xl backdrop-blur">
          <div className="mb-5 flex items-center gap-2">
            <img src="/favicon.svg" alt="" className="h-9 w-9" />
            <span className="font-display text-lg font-bold">{t.brand}</span>
          </div>

          {step === "email" ? (
            <form onSubmit={send} className="space-y-4" noValidate>
              <div className="space-y-1.5">
                <h1 className="font-display text-2xl font-bold">{t.loginTitle}</h1>
                <p className="text-sm text-muted-foreground">{t.loginIntro}</p>
              </div>
              <label className="block space-y-1.5">
                <span className="text-sm font-medium">{t.emailLabel}</span>
                <input
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  autoFocus
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t.emailPlaceholder}
                  className="h-11 w-full rounded-md border border-input bg-background/60 px-3 text-base outline-none focus:border-primary"
                />
              </label>
              {error && <p role="alert" className="text-sm text-destructive">{t.errors[error]}</p>}
              <button
                type="submit"
                disabled={busy}
                className="flex h-11 w-full items-center justify-center gap-2 rounded-md bg-primary text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                {busy ? t.sending : t.sendCode}
              </button>
              <p className="text-xs text-muted-foreground">{t.newHere}</p>
              <p className="text-xs text-muted-foreground">
                <Link to="/terms" className="hover:text-foreground hover:underline">{termsStrings(language).title}</Link>
              </p>
            </form>
          ) : (
            <form onSubmit={verify} className="space-y-4" noValidate>
              <div className="space-y-1.5">
                <h1 className="font-display text-2xl font-bold">{t.codeTitle}</h1>
                <p className="text-sm text-muted-foreground">{t.codeIntro(email.trim().toLowerCase())}</p>
              </div>
              <label className="block space-y-1.5">
                <span className="text-sm font-medium">{t.codeLabel}</span>
                <input
                  ref={codeRef}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={code}
                  onChange={(e) => { setCode(e.target.value.replace(/\D/g, "").slice(0, 6)); setError(null); }}
                  placeholder="000000"
                  className="h-12 w-full rounded-md border border-input bg-background/60 px-3 text-center font-mono text-2xl tracking-[0.5em] outline-none focus:border-primary"
                />
              </label>
              {error && <p role="alert" className="text-sm text-destructive">{t.errors[error]}</p>}
              <button
                type="submit"
                disabled={busy}
                className="flex h-11 w-full items-center justify-center gap-2 rounded-md bg-primary text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
              >
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                {busy ? t.verifying : t.verify}
              </button>
              <div className="flex flex-wrap justify-between gap-2 text-sm">
                <button type="button" onClick={() => { setStep("email"); setError(null); }} className="text-muted-foreground hover:text-foreground">
                  {t.otherEmail}
                </button>
                <button type="button" disabled={busy} onClick={() => send()} className="text-primary hover:underline disabled:opacity-60">
                  {t.resend}
                </button>
              </div>
              <p className="text-xs text-muted-foreground">{t.checkSpam}</p>
            </form>
          )}
        </div>
      </main>
    </div>
  );
};

export default Login;
