import { Sparkles, Target, Users, Zap, BarChart3, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";

const features = [
  {
    icon: Sparkles,
    title: "Adaptive Learning",
    description: "AI that learns how you learn, personalizing every lesson to your unique style.",
  },
  {
    icon: Target,
    title: "Smart Curriculum",
    description: "Dynamic course paths that evolve based on your progress and goals.",
  },
  {
    icon: Users,
    title: "AI Mentors",
    description: "24/7 intelligent tutors available in any subject, any language.",
  },
  {
    icon: Zap,
    title: "Real-Time Feedback",
    description: "Instant assessments and recommendations to accelerate your learning.",
  },
  {
    icon: BarChart3,
    title: "Learning Analytics",
    description: "Deep insights into progress, strengths, and areas for improvement.",
  },
  {
    icon: Shield,
    title: "Educator Support",
    description: "AI-powered tools to help teachers create, manage, and optimize courses.",
  },
];

const NicsAI = () => {
  return (
    <section id="nics-ai" className="py-24 lg:py-32 relative overflow-hidden">
      {/* Background elements */}
      <div className="absolute inset-0 gradient-bg opacity-50" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] rounded-full bg-primary/5 blur-3xl" />
      
      <div className="container relative z-10">
        <div className="grid lg:grid-cols-2 gap-16 items-center">
          {/* Left content */}
          <div className="animate-fade-up">
            <span className="text-primary font-display text-sm uppercase tracking-widest mb-4 block">
              Powered by Intelligence
            </span>
            <h2 className="font-display text-4xl md:text-5xl lg:text-6xl font-bold mb-6">
              Meet <span className="gradient-text text-glow">NICS AI</span>
            </h2>
            <p className="text-muted-foreground text-lg mb-8 leading-relaxed">
              NICS AI is the intelligent heart of Aquaterra. Our advanced learning engine doesn't just deliver content — it understands you. Every interaction shapes a personalized educational journey that adapts in real-time.
            </p>
            <p className="text-muted-foreground text-lg mb-8 leading-relaxed">
              From AI mentors who guide your studies to smart curriculum engines that optimize learning outcomes, NICS AI transforms education from passive consumption to active discovery.
            </p>
            <Button variant="hero" size="lg">
              Experience NICS AI
            </Button>
          </div>
          
          {/* Right features grid */}
          <div className="grid sm:grid-cols-2 gap-4">
            {features.map((feature, index) => (
              <div
                key={feature.title}
                className="glass rounded-2xl p-6 transition-all duration-300 hover:scale-105 hover:border-primary/40 animate-fade-up"
                style={{ animationDelay: `${index * 0.1}s` }}
              >
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-4">
                  <feature.icon className="w-6 h-6 text-primary" />
                </div>
                <h3 className="font-display font-semibold text-foreground mb-2">
                  {feature.title}
                </h3>
                <p className="text-muted-foreground text-sm">
                  {feature.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};

export default NicsAI;
