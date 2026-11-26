import { useEffect, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { useLanguage } from "@/i18n/LanguageContext";
import { useAccount } from "@/game/account/AccountContext";
import { dropHue } from "@/game/travel/drop";
import AvatarPreview from "./AvatarPreview";
import { AVATAR_HUES, AVATAR_STYLES, type Avatar } from "./avatars";
import { avatarOf, saveAvatar, type ResidentsError } from "./api";
import { residentsStrings } from "./strings";
import { useMyAvatar } from "./useMyAvatar";

/**
 * Pick an avatar and a colour. In sign-up (`onDone`) the button says Next and
 * there is a Skip; in the profile it saves in place.
 */
const AvatarPicker = ({ onDone }: { onDone?: () => void }) => {
  const { language } = useLanguage();
  const t = residentsStrings(language);
  const { session, player, signOut } = useAccount();
  const [mine, setMine] = useMyAvatar(session, player?.email);
  const fallback = dropHue(player?.email ?? "guest");
  const [choice, setChoice] = useState<Avatar>(() => avatarOf(mine, fallback));
  const [visible, setVisible] = useState(mine?.visible ?? true);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<ResidentsError | null>(null);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (touched || !mine) return;
    setChoice(avatarOf(mine, fallback));
    setVisible(mine.visible);
  }, [mine, fallback, touched]);

  if (!session) return null;
  const pick = (a: Partial<Avatar>) => {
    setChoice((c) => ({ ...c, ...a }));
    setTouched(true);
    setSaved(false);
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    const r = await saveAvatar(session, choice, visible);
    setBusy(false);
    if (!r.ok) {
      if (r.error === "session") return signOut();
      return setError(r.error);
    }
    setMine(r.data.avatar);
    setSaved(true);
    onDone?.();
  };

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-3">
        <AvatarPreview avatar={choice} size={72} className="shrink-0 rounded-xl bg-slate-900/70 ring-1 ring-border" />
        <div className="min-w-0">
          <h2 className="font-display text-lg font-bold">{onDone ? t.chooseAvatar : t.avatarTitle}</h2>
          <p className="text-sm text-muted-foreground">{t.avatarIntro}</p>
        </div>
      </div>
      <div role="radiogroup" aria-label={t.avatarTitle} className="grid grid-cols-5 gap-1.5">
        {AVATAR_STYLES.map((s) => (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={choice.style === s}
            title={t.styles[s]}
            onClick={() => pick({ style: s })}
            className={`flex flex-col items-center rounded-lg border px-0.5 pb-1 pt-0.5 text-[10px] leading-tight ${choice.style === s ? "border-primary bg-primary/15 text-foreground" : "border-border bg-background/40 text-muted-foreground hover:border-primary/60"}`}
          >
            <AvatarPreview avatar={{ style: s, hue: choice.hue }} size={48} />
            <span className="w-full truncate text-center">{t.styles[s]}</span>
          </button>
        ))}
      </div>
      <div>
        <p className="mb-1.5 text-xs font-medium text-muted-foreground">{t.colour}</p>
        <div role="radiogroup" aria-label={t.colour} className="flex flex-wrap gap-2">
          {AVATAR_HUES.map((h) => (
            <button
              key={h}
              type="button"
              role="radio"
              aria-checked={choice.hue === h}
              aria-label={`${t.colour} ${h}`}
              onClick={() => pick({ hue: h })}
              className={`h-8 w-8 rounded-full ring-offset-2 ring-offset-background ${choice.hue === h ? "ring-2 ring-foreground" : ""}`}
              style={{ background: `radial-gradient(circle at 35% 30%, hsl(${h},100%,85%), hsl(${h},90%,50%) 60%, hsl(${h},90%,32%))` }}
            />
          ))}
        </div>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={visible}
          onChange={(e) => { setVisible(e.target.checked); setTouched(true); setSaved(false); }}
          className="mt-0.5 h-4 w-4 accent-[hsl(var(--primary))]"
        />
        <span>
          {t.visible}
          <span className="block text-xs text-muted-foreground">{t.visibleHint}</span>
        </span>
      </label>
      {error && <p role="alert" className="text-sm text-destructive">{t.errors[error]}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : saved ? <Check className="h-4 w-4" /> : null}
          {busy ? t.saving : saved && !onDone ? t.saved : onDone ? t.next : t.save}
        </button>
        {onDone && (
          <button type="button" onClick={onDone} className="h-11 rounded-md border border-border px-4 text-sm text-muted-foreground hover:text-foreground">
            {t.skip}
          </button>
        )}
      </div>
    </section>
  );
};

export default AvatarPicker;
