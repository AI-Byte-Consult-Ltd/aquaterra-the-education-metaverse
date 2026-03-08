import { Globe, BookOpen, Brain, Award } from "lucide-react";
import { useLanguage } from "@/i18n/LanguageContext";

const HowItWorks = () => {
  const { t } = useLanguage();

  const steps = [
    { icon: Globe, title: t("hiw_step1_title"), description: t("hiw_step1_desc") },
    { icon: BookOpen, title: t("hiw_step2_title"), description: t("hiw_step2_desc") },
    { icon: Brain, title: t("hiw_step3_title"), description: t("hiw_step3_desc") },
    { icon: Award, title: t("hiw_step4_title"), description: t("hiw_step4_desc") },
  ];

  return (
    <section id="how-it-works" className="py-24 lg:py-32 relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-b from-background via-muted/20 to-background" />
      <div className="container relative z-10">
        <div className="text-center mb-16 animate-fade-up">
          <span className="text-primary font-display text-sm uppercase tracking-widest mb-4 block">{t("hiw_label")}</span>
          <h2 className="font-display text-4xl md:text-5xl lg:text-6xl font-bold mb-6">
            {t("hiw_title1")} <span className="gradient-text">{t("hiw_title2")}</span>
          </h2>
          <p className="text-muted-foreground text-lg max-w-2xl mx-auto">{t("hiw_subtitle")}</p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 lg:gap-8">
          {steps.map((step, index) => (
            <div key={index} className="group relative animate-fade-up" style={{ animationDelay: `${index * 0.15}s` }}>
              {index < steps.length - 1 && (
                <div className="hidden lg:block absolute top-12 left-[60%] w-full h-px bg-gradient-to-r from-primary/50 to-transparent" />
              )}
              <div className="glass rounded-2xl p-6 lg:p-8 h-full transition-all duration-500 hover:scale-105 hover:glow-primary">
                <div className="absolute -top-3 -left-3 w-8 h-8 rounded-full bg-primary text-primary-foreground font-display font-bold text-sm flex items-center justify-center">
                  {index + 1}
                </div>
                <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-6 group-hover:bg-primary/20 transition-colors">
                  <step.icon className="w-8 h-8 text-primary" />
                </div>
                <h3 className="font-display text-xl font-semibold mb-3 text-foreground">{step.title}</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">{step.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default HowItWorks;
