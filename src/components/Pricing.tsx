import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/i18n/LanguageContext";

const Pricing = () => {
  const { t } = useLanguage();

  const plans = [
    {
      name: t("pr_explorer"),
      price: t("pr_free"),
      period: "",
      description: t("pr_explorer_desc"),
      features: [t("pr_f1"), t("pr_f2"), t("pr_f3"), t("pr_f4"), t("pr_f5")],
      cta: t("pr_explorer_cta"),
      variant: "heroOutline" as const,
      popular: false,
    },
    {
      name: t("pr_learner"),
      price: "$19",
      period: t("pr_month"),
      description: t("pr_learner_desc"),
      features: [t("pr_f6"), t("pr_f7"), t("pr_f8"), t("pr_f9"), t("pr_f10"), t("pr_f11")],
      cta: t("pr_learner_cta"),
      variant: "hero" as const,
      popular: true,
    },
    {
      name: t("pr_institution"),
      price: t("pr_custom"),
      period: "",
      description: t("pr_institution_desc"),
      features: [t("pr_f12"), t("pr_f13"), t("pr_f14"), t("pr_f15"), t("pr_f16"), t("pr_f17"), t("pr_f18")],
      cta: t("pr_institution_cta"),
      variant: "heroOutline" as const,
      popular: false,
    },
  ];

  return (
    <section id="pricing" className="py-24 lg:py-32 relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-b from-muted/30 via-background to-background" />
      <div className="container relative z-10">
        <div className="text-center mb-16 animate-fade-up">
          <span className="text-primary font-display text-sm uppercase tracking-widest mb-4 block">{t("pr_label")}</span>
          <h2 className="font-display text-4xl md:text-5xl lg:text-6xl font-bold mb-6">
            {t("pr_title1")} <span className="gradient-text">{t("pr_title2")}</span>
          </h2>
          <p className="text-muted-foreground text-lg max-w-2xl mx-auto">{t("pr_subtitle")}</p>
        </div>

        <div className="grid md:grid-cols-3 gap-8 max-w-6xl mx-auto">
          {plans.map((plan, index) => (
            <div
              key={index}
              className={`relative glass rounded-3xl p-8 transition-all duration-500 hover:scale-105 animate-fade-up ${plan.popular ? "border-2 border-primary glow-primary" : ""}`}
              style={{ animationDelay: `${index * 0.15}s` }}
            >
              {plan.popular && (
                <div className="absolute -top-4 left-1/2 -translate-x-1/2 px-4 py-1 bg-primary text-primary-foreground text-sm font-display font-semibold rounded-full">
                  {t("pr_popular")}
                </div>
              )}
              <div className="text-center mb-8">
                <h3 className="font-display text-2xl font-semibold text-foreground mb-2">{plan.name}</h3>
                <p className="text-muted-foreground text-sm mb-4">{plan.description}</p>
                <div className="flex items-baseline justify-center gap-1">
                  <span className="font-display text-5xl font-bold text-foreground">{plan.price}</span>
                  {plan.period && <span className="text-muted-foreground">{plan.period}</span>}
                </div>
              </div>
              <ul className="space-y-4 mb-8">
                {plan.features.map((feature, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <div className="w-5 h-5 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Check className="w-3 h-3 text-primary" />
                    </div>
                    <span className="text-muted-foreground text-sm">{feature}</span>
                  </li>
                ))}
              </ul>
              <Button variant={plan.variant} size="lg" className="w-full">{plan.cta}</Button>
            </div>
          ))}
        </div>

        <div className="mt-12 text-center animate-fade-up">
          <p className="text-muted-foreground text-sm mb-4">{t("pr_payment")}</p>
          <div className="flex items-center justify-center gap-8">
            <div className="glass px-6 py-3 rounded-xl">
              <span className="font-display font-semibold text-foreground">Stripe</span>
            </div>
            <div className="glass px-6 py-3 rounded-xl">
              <span className="font-display font-semibold text-foreground">Revolut</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default Pricing;
