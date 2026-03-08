import { Sparkles, Target, Users, Zap, BarChart3, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/i18n/LanguageContext";

const NicsAI = () => {
  const { t } = useLanguage();

  const features = [
    { icon: Sparkles, title: t("nics_f1_title"), description: t("nics_f1_desc") },
    { icon: Target, title: t("nics_f2_title"), description: t("nics_f2_desc") },
    { icon: Users, title: t("nics_f3_title"), description: t("nics_f3_desc") },
    { icon: Zap, title: t("nics_f4_title"), description: t("nics_f4_desc") },
    { icon: BarChart3, title: t("nics_f5_title"), description: t("nics_f5_desc") },
    { icon: Shield, title: t("nics_f6_title"), description: t("nics_f6_desc") },
  ];

  return (
    <section id="nics-ai" className="py-24 lg:py-32 relative overflow-hidden">
      <div className="absolute inset-0 gradient-bg opacity-50" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] rounded-full bg-primary/5 blur-3xl" />
      <div className="container relative z-10">
        <div className="grid lg:grid-cols-2 gap-16 items-center">
          <div className="animate-fade-up">
            <span className="text-primary font-display text-sm uppercase tracking-widest mb-4 block">{t("nics_label")}</span>
            <h2 className="font-display text-4xl md:text-5xl lg:text-6xl font-bold mb-6">
              {t("nics_title")} <span className="gradient-text text-glow">{t("nics_titleHighlight")}</span>
            </h2>
            <p className="text-muted-foreground text-lg mb-8 leading-relaxed">{t("nics_desc1")}</p>
            <p className="text-muted-foreground text-lg mb-8 leading-relaxed">{t("nics_desc2")}</p>
            <Button variant="hero" size="lg">{t("nics_cta")}</Button>
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            {features.map((feature, index) => (
              <div key={index} className="glass rounded-2xl p-6 transition-all duration-300 hover:scale-105 hover:border-primary/40 animate-fade-up" style={{ animationDelay: `${index * 0.1}s` }}>
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-4">
                  <feature.icon className="w-6 h-6 text-primary" />
                </div>
                <h3 className="font-display font-semibold text-foreground mb-2">{feature.title}</h3>
                <p className="text-muted-foreground text-sm">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};

export default NicsAI;
