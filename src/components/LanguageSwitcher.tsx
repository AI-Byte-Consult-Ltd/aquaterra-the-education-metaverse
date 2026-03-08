import { Globe, ChevronDown } from "lucide-react";
import { useLanguage } from "@/i18n/LanguageContext";
import { useState, useRef, useEffect } from "react";

const LanguageSwitcher = () => {
  const [isOpen, setIsOpen] = useState(false);
  const { language, setLanguage, languages } = useLanguage();
  const selectedLang = languages.find((l) => l.code === language) || languages[0];
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setIsOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 glass px-3 py-2 rounded-lg hover:bg-muted/80 transition-colors"
      >
        <Globe className="w-4 h-4 text-primary" />
        <span className="text-sm">{selectedLang.flag}</span>
        <span className="text-sm text-muted-foreground hidden sm:inline">{selectedLang.code.toUpperCase()}</span>
        <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`} />
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-48 glass rounded-xl overflow-hidden z-50 animate-scale-in">
          {languages.map((lang) => (
            <button
              key={lang.code}
              onClick={() => {
                setLanguage(lang.code);
                setIsOpen(false);
              }}
              className={`w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/50 transition-colors ${
                language === lang.code ? "bg-primary/10 text-primary" : "text-foreground"
              }`}
            >
              <span className="text-lg">{lang.flag}</span>
              <span className="text-sm font-medium">{lang.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default LanguageSwitcher;
