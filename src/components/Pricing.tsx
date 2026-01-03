import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";

const plans = [
  {
    name: "Explorer",
    price: "Free",
    period: "",
    description: "Perfect for curious learners ready to discover the metaverse.",
    features: [
      "Access to public learning zones",
      "Basic NICS AI assistance",
      "Community forums",
      "3 courses per month",
      "Digital badge collection",
    ],
    cta: "Start Free",
    variant: "heroOutline" as const,
    popular: false,
  },
  {
    name: "Learner",
    price: "$19",
    period: "/month",
    description: "For dedicated students seeking comprehensive learning paths.",
    features: [
      "Unlimited course access",
      "Advanced NICS AI mentorship",
      "Private study rooms",
      "Priority support",
      "Verified certificates",
      "Progress analytics",
    ],
    cta: "Subscribe Now",
    variant: "hero" as const,
    popular: true,
  },
  {
    name: "Institution",
    price: "Custom",
    period: "",
    description: "Tailored solutions for schools, universities, and enterprises.",
    features: [
      "Custom virtual campus",
      "Admin dashboard",
      "Student management",
      "Branded certificates",
      "API access",
      "Dedicated support",
      "Custom AI training",
    ],
    cta: "Contact Sales",
    variant: "heroOutline" as const,
    popular: false,
  },
];

const Pricing = () => {
  return (
    <section id="pricing" className="py-24 lg:py-32 relative overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0 bg-gradient-to-b from-muted/30 via-background to-background" />
      
      <div className="container relative z-10">
        <div className="text-center mb-16 animate-fade-up">
          <span className="text-primary font-display text-sm uppercase tracking-widest mb-4 block">
            Pricing
          </span>
          <h2 className="font-display text-4xl md:text-5xl lg:text-6xl font-bold mb-6">
            Choose Your <span className="gradient-text">Access</span>
          </h2>
          <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
            Flexible plans for individuals and institutions. Start free, upgrade when you're ready.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-8 max-w-6xl mx-auto">
          {plans.map((plan, index) => (
            <div
              key={plan.name}
              className={`relative glass rounded-3xl p-8 transition-all duration-500 hover:scale-105 animate-fade-up ${
                plan.popular ? "border-2 border-primary glow-primary" : ""
              }`}
              style={{ animationDelay: `${index * 0.15}s` }}
            >
              {plan.popular && (
                <div className="absolute -top-4 left-1/2 -translate-x-1/2 px-4 py-1 bg-primary text-primary-foreground text-sm font-display font-semibold rounded-full">
                  Most Popular
                </div>
              )}
              
              <div className="text-center mb-8">
                <h3 className="font-display text-2xl font-semibold text-foreground mb-2">
                  {plan.name}
                </h3>
                <p className="text-muted-foreground text-sm mb-4">
                  {plan.description}
                </p>
                <div className="flex items-baseline justify-center gap-1">
                  <span className="font-display text-5xl font-bold text-foreground">
                    {plan.price}
                  </span>
                  {plan.period && (
                    <span className="text-muted-foreground">{plan.period}</span>
                  )}
                </div>
              </div>

              <ul className="space-y-4 mb-8">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-3">
                    <div className="w-5 h-5 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Check className="w-3 h-3 text-primary" />
                    </div>
                    <span className="text-muted-foreground text-sm">{feature}</span>
                  </li>
                ))}
              </ul>

              <Button variant={plan.variant} size="lg" className="w-full">
                {plan.cta}
              </Button>
            </div>
          ))}
        </div>

        {/* Payment methods */}
        <div className="mt-12 text-center animate-fade-up">
          <p className="text-muted-foreground text-sm mb-4">Secure payments powered by</p>
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
