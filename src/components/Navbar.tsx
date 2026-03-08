import { useState, useEffect } from "react";
import { Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import { useLanguage } from "@/i18n/LanguageContext";

const Navbar = () => {
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const { t } = useLanguage();

  const navLinks = [
    { name: t("nav_howItWorks"), href: "#how-it-works" },
    { name: t("nav_nicsAi"), href: "#nics-ai" },
    { name: t("nav_useCases"), href: "#use-cases" },
    { name: t("nav_pricing"), href: "#pricing" },
  ];

  useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > 50);
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <header
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        isScrolled ? "glass py-3" : "py-6"
      }`}
    >
      <div className="container flex items-center justify-between">
        <a href="#" className="flex items-center gap-2">
          <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center">
            <span className="font-display font-bold text-primary-foreground text-lg">A</span>
          </div>
          <span className="font-display font-bold text-xl text-foreground">Aquaterra</span>
        </a>

        <nav className="hidden lg:flex items-center gap-8">
          {navLinks.map((link) => (
            <a key={link.href} href={link.href} className="text-muted-foreground hover:text-foreground transition-colors text-sm font-medium">
              {link.name}
            </a>
          ))}
        </nav>

        <div className="hidden lg:flex items-center gap-4">
          <LanguageSwitcher />
          <Button variant="ghost" size="sm">{t("nav_logIn")}</Button>
          <Button variant="hero" size="sm">{t("nav_startLearning")}</Button>
        </div>

        <button onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)} className="lg:hidden p-2 text-foreground">
          {isMobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </button>
      </div>

      {isMobileMenuOpen && (
        <div className="lg:hidden glass mt-2 mx-4 rounded-2xl p-6 animate-scale-in">
          <nav className="flex flex-col gap-4 mb-6">
            {navLinks.map((link) => (
              <a key={link.href} href={link.href} onClick={() => setIsMobileMenuOpen(false)} className="text-foreground hover:text-primary transition-colors font-medium py-2">
                {link.name}
              </a>
            ))}
          </nav>
          <div className="flex flex-col gap-3">
            <Button variant="ghost" className="w-full">{t("nav_logIn")}</Button>
            <Button variant="hero" className="w-full">{t("nav_startLearning")}</Button>
          </div>
          <div className="mt-6 pt-6 border-t border-border">
            <LanguageSwitcher />
          </div>
        </div>
      )}
    </header>
  );
};

export default Navbar;
