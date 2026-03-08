import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react";
import { type Language, type LanguageInfo, languages, translations } from "./translations";

interface LanguageContextType {
  language: Language;
  languageInfo: LanguageInfo;
  t: (key: string) => string;
  setLanguage: (lang: Language) => void;
  languages: LanguageInfo[];
}

const LanguageContext = createContext<LanguageContextType | null>(null);

export const LanguageProvider = ({ children }: { children: ReactNode }) => {
  const [language, setLanguageState] = useState<Language>(() => {
    const saved = localStorage.getItem("aquaterra-lang");
    return (saved as Language) || "en";
  });

  const languageInfo = languages.find((l) => l.code === language) || languages[0];

  const setLanguage = useCallback((lang: Language) => {
    setLanguageState(lang);
    localStorage.setItem("aquaterra-lang", lang);
  }, []);

  const t = useCallback(
    (key: string) => {
      const trans = translations[language];
      return (trans as Record<string, string>)[key] || key;
    },
    [language]
  );

  useEffect(() => {
    document.documentElement.dir = languageInfo.dir;
    document.documentElement.lang = language;
  }, [language, languageInfo]);

  return (
    <LanguageContext.Provider value={{ language, languageInfo, t, setLanguage, languages }}>
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = () => {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error("useLanguage must be used within LanguageProvider");
  return ctx;
};
