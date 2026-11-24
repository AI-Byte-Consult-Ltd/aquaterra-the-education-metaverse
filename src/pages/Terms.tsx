import { useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { ArrowLeft, ScrollText } from "lucide-react";
import { useLanguage } from "@/i18n/LanguageContext";
import { termsStrings } from "@/game/account/terms";

/** Terms of play. Section ids are stable so the game can link to them. */
const Terms = () => {
  const { language } = useLanguage();
  const t = termsStrings(language);
  const { hash } = useLocation();
  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView();
  }, [hash]);
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-2xl px-4 py-6">
        <Link to="/" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
          {t.back}
        </Link>
        <h1 className="mb-1 flex items-center gap-2 font-display text-2xl font-bold">
          <ScrollText className="h-6 w-6 text-primary" />
          {t.title}
        </h1>
        <p className="mb-6 text-xs text-muted-foreground">{t.updated}</p>
        {t.sections.map((s) => (
          <section key={s.id} id={s.id} className="mb-6 scroll-mt-4">
            <h2 className="mb-2 font-display text-lg font-bold">{s.title}</h2>
            {s.body.map((p) => (
              <p key={p} className="mb-2 text-sm text-muted-foreground">{p}</p>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
};

export default Terms;
