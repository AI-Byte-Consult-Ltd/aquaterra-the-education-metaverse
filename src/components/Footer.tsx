import { Button } from "@/components/ui/button";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import { useLanguage } from "@/i18n/LanguageContext";

const Footer = () => {
  const { t } = useLanguage();

  const footerLinks = {
    product: {
      title: t("ft_product"),
      links: [
        { name: t("ft_product_1"), href: "#" },
        { name: t("ft_product_2"), href: "#nics-ai" },
        { name: t("ft_product_3"), href: "#" },
        { name: t("ft_product_4"), href: "#" },
      ],
    },
    resources: {
      title: t("ft_resources"),
      links: [
        { name: t("ft_resources_1"), href: "#" },
        { name: t("ft_resources_2"), href: "#" },
        { name: t("ft_resources_3"), href: "#" },
        { name: t("ft_resources_4"), href: "#" },
      ],
    },
    company: {
      title: t("ft_company"),
      links: [
        { name: t("ft_company_1"), href: "#" },
        { name: t("ft_company_2"), href: "#" },
        { name: t("ft_company_3"), href: "#" },
        { name: t("ft_company_4"), href: "#" },
      ],
    },
    legal: {
      title: t("ft_legal"),
      links: [
        { name: t("ft_legal_1"), href: "#" },
        { name: t("ft_legal_2"), href: "#" },
        { name: t("ft_legal_3"), href: "#" },
        { name: t("ft_legal_4"), href: "#" },
      ],
    },
  };

  return (
    <footer className="border-t border-border bg-card/50">
      <div className="container py-16 lg:py-24">
        <div className="glass rounded-3xl p-8 lg:p-16 text-center relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-r from-primary/10 via-transparent to-secondary/10" />
          <div className="relative z-10">
            <h2 className="font-display text-3xl md:text-4xl lg:text-5xl font-bold mb-4">
              {t("ft_cta_title1")} <span className="gradient-text">{t("ft_cta_title2")}</span>?
            </h2>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto mb-8">{t("ft_cta_sub")}</p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Button variant="glow" size="xl">{t("ft_cta1")}</Button>
              <Button variant="heroOutline" size="xl">{t("ft_cta2")}</Button>
            </div>
          </div>
        </div>
      </div>

      <div className="container py-12 lg:py-16">
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-8">
          <div className="col-span-2 md:col-span-4 lg:col-span-1">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center">
                <span className="font-display font-bold text-primary-foreground text-lg">A</span>
              </div>
              <span className="font-display font-bold text-xl text-foreground">AquaTerra World</span>
            </div>
            <p className="text-muted-foreground text-sm mb-6">
              The Education Metaverse powered by NICS AI. Learn, teach, and grow in immersive digital worlds.
            </p>
            <LanguageSwitcher />
          </div>

          {Object.values(footerLinks).map((section) => (
            <div key={section.title}>
              <h4 className="font-display font-semibold text-foreground mb-4">{section.title}</h4>
              <ul className="space-y-3">
                {section.links.map((link) => (
                  <li key={link.name}>
                    <a href={link.href} className="text-muted-foreground text-sm hover:text-primary transition-colors">{link.name}</a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      <div className="border-t border-border">
        <div className="container py-6 flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-muted-foreground text-sm">
            © Platon BG Ltd 2025-2026. All rights reserved.
          </p>
          <div className="flex items-center gap-6">
            <a href="#" className="text-muted-foreground hover:text-primary transition-colors text-sm">Twitter</a>
            <a href="#" className="text-muted-foreground hover:text-primary transition-colors text-sm">Discord</a>
            <a href="#" className="text-muted-foreground hover:text-primary transition-colors text-sm">LinkedIn</a>
            <a href="#" className="text-muted-foreground hover:text-primary transition-colors text-sm">YouTube</a>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;