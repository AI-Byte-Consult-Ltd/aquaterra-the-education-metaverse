import { useEffect, useState } from "react";
import { useLanguage } from "@/i18n/LanguageContext";
import { searchResidents, type HandleMatch } from "./api";
import { handleStrings } from "./strings";

interface Props {
  session: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}

/** Recipient field: type @handle or a name, pick a resident from the list. */
const RecipientInput = ({ session, value, onChange, placeholder }: Props) => {
  const { language } = useLanguage();
  const t = handleStrings(language);
  const [matches, setMatches] = useState<HandleMatch[] | null>(null);
  const [open, setOpen] = useState(false);
  const q = value.trim();

  useEffect(() => {
    if (!open || q.replace(/^@/, "").length < 1) return setMatches(null);
    let live = true;
    const id = setTimeout(() => {
      void searchResidents(session, q).then((r) => live && setMatches(r.ok ? r.data.results : null));
    }, 250);
    return () => {
      live = false;
      clearTimeout(id);
    };
  }, [q, open, session]);

  const exact = matches?.length === 1 && `@${matches[0].handle}` === q.toLowerCase();

  return (
    <div className="relative">
      <input
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        maxLength={24}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        placeholder={placeholder ?? t.searchHint}
        role="combobox"
        aria-expanded={open && !!matches}
        aria-autocomplete="list"
        className="h-10 w-full rounded-md border border-input bg-background/60 px-3 text-base outline-none focus:border-primary"
      />
      {open && matches && !exact && (
        <ul role="listbox" className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-md border border-border bg-popover p-1 shadow-xl">
          {matches.length === 0 ? (
            <li className="px-3 py-2 text-sm text-muted-foreground">{t.noMatches}</li>
          ) : (
            matches.map((m) => (
              <li key={m.handle}>
                <button
                  type="button"
                  role="option"
                  aria-selected={false}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => { onChange(`@${m.handle}`); setOpen(false); }}
                  className="flex w-full items-center justify-between gap-3 rounded px-3 py-2 text-left text-sm hover:bg-accent"
                >
                  <span className="font-medium text-cyan-300">@{m.handle}</span>
                  <span className="truncate text-muted-foreground">{m.name}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
};

export default RecipientInput;
