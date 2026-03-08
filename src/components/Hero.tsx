import { Button } from "@/components/ui/button";
import heroBg from "@/assets/hero-bg.jpg";
import { useLanguage } from "@/i18n/LanguageContext";

const Hero = () => {
  const { t } = useLanguage();

  return (
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden">
      <div className="absolute inset-0 bg-cover bg-center bg-no-repeat" style={{ backgroundImage: `url(${heroBg})` }} />
      <div className="absolute inset-0 bg-gradient-to-b from-background/80 via-background/40 to-background" />
      <div className="absolute inset-0 bg-gradient-to-r from-background/60 via-transparent to-background/60" />
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/20 rounded-full blur-3xl animate-pulse-glow" />
      <div className="absolute bottom-1/4 right-1/4 w-72 h-72 bg-secondary/20 rounded-full blur-3xl animate-pulse-glow" style={{ animationDelay: "1.5s" }} />

      <div className="container relative z-10 pt-32 pb-20 lg:pt-40 lg:pb-32">
        <div className="max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 glass px-4 py-2 rounded-full mb-8 animate-fade-up">
            <span className="w-2 h-2 bg-primary rounded-full animate-pulse" />
            <span className="text-sm text-muted-foreground">{t("hero_badge")}</span>
          </div>

          <h1 className="font-display text-5xl md:text-6xl lg:text-7xl xl:text-8xl font-bold mb-6 leading-tight animate-fade-up">
            {t("hero_welcome")}{" "}
            <span className="gradient-text text-glow block md:inline">{t("hero_brand")}</span>
          </h1>

          <p className="text-xl md:text-2xl text-muted-foreground max-w-2xl mx-auto mb-10 leading-relaxed animate-fade-up-delayed">
            {t("hero_sub1")}{" "}
            <span className="text-primary font-semibold">NICS AI</span>.{" "}
            {t("hero_sub2")}
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center animate-fade-up" style={{ animationDelay: "0.4s" }}>
            <Button variant="glow" size="xl">{t("hero_cta1")}</Button>
            <Button variant="heroOutline" size="xl">{t("hero_cta2")}</Button>
          </div>

          <div className="grid grid-cols-3 gap-8 max-w-xl mx-auto mt-16 animate-fade-up" style={{ animationDelay: "0.6s" }}>
            <div className="text-center">
              <div className="font-display text-3xl md:text-4xl font-bold text-foreground mb-1">{t("hero_stat1_value")}</div>
              <div className="text-muted-foreground text-sm">{t("hero_stat1_label")}</div>
            </div>
            <div className="text-center">
              <div className="font-display text-3xl md:text-4xl font-bold text-foreground mb-1">{t("hero_stat2_value")}</div>
              <div className="text-muted-foreground text-sm">{t("hero_stat2_label")}</div>
            </div>
            <div className="text-center">
              <div className="font-display text-3xl md:text-4xl font-bold text-foreground mb-1">{t("hero_stat3_value")}</div>
              <div className="text-muted-foreground text-sm">{t("hero_stat3_label")}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 animate-float">
        <div className="w-6 h-10 border-2 border-muted-foreground/30 rounded-full flex justify-center pt-2">
          <div className="w-1 h-2 bg-primary rounded-full animate-pulse" />
        </div>
      </div>
    </section>
  );
};

export default Hero;
