import { Globe, BookOpen, Brain, Award } from "lucide-react";

const steps = [
  {
    icon: Globe,
    title: "Enter the Aquaterra Metaverse",
    description: "Step into a vast digital world designed for immersive learning experiences.",
  },
  {
    icon: BookOpen,
    title: "Learn Through Immersive Worlds",
    description: "Explore interactive quests, virtual labs, and collaborative learning spaces.",
  },
  {
    icon: Brain,
    title: "Get Personalized AI Guidance",
    description: "NICS AI adapts to your learning style and provides real-time mentorship.",
  },
  {
    icon: Award,
    title: "Earn Digital Credentials",
    description: "Receive verified certificates and badges recognized by institutions worldwide.",
  },
];

const HowItWorks = () => {
  return (
    <section id="how-it-works" className="py-24 lg:py-32 relative overflow-hidden">
      {/* Background gradient */}
      <div className="absolute inset-0 bg-gradient-to-b from-background via-muted/20 to-background" />
      
      <div className="container relative z-10">
        <div className="text-center mb-16 animate-fade-up">
          <span className="text-primary font-display text-sm uppercase tracking-widest mb-4 block">
            How It Works
          </span>
          <h2 className="font-display text-4xl md:text-5xl lg:text-6xl font-bold mb-6">
            Your Journey <span className="gradient-text">Begins Here</span>
          </h2>
          <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
            Four simple steps to transform how you learn, teach, and grow in the Education Metaverse.
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 lg:gap-8">
          {steps.map((step, index) => (
            <div
              key={step.title}
              className="group relative animate-fade-up"
              style={{ animationDelay: `${index * 0.15}s` }}
            >
              {/* Connector line for desktop */}
              {index < steps.length - 1 && (
                <div className="hidden lg:block absolute top-12 left-[60%] w-full h-px bg-gradient-to-r from-primary/50 to-transparent" />
              )}
              
              <div className="glass rounded-2xl p-6 lg:p-8 h-full transition-all duration-500 hover:scale-105 hover:glow-primary">
                {/* Step number */}
                <div className="absolute -top-3 -left-3 w-8 h-8 rounded-full bg-primary text-primary-foreground font-display font-bold text-sm flex items-center justify-center">
                  {index + 1}
                </div>
                
                {/* Icon */}
                <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-6 group-hover:bg-primary/20 transition-colors">
                  <step.icon className="w-8 h-8 text-primary" />
                </div>
                
                <h3 className="font-display text-xl font-semibold mb-3 text-foreground">
                  {step.title}
                </h3>
                <p className="text-muted-foreground text-sm leading-relaxed">
                  {step.description}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default HowItWorks;
