import { Button } from "@/components/ui/button";
import heroBg from "@/assets/hero-bg.jpg";

const Hero = () => {
  return (
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden">
      {/* Background Image */}
      <div 
        className="absolute inset-0 bg-cover bg-center bg-no-repeat"
        style={{ backgroundImage: `url(${heroBg})` }}
      />
      
      {/* Overlay gradients */}
      <div className="absolute inset-0 bg-gradient-to-b from-background/80 via-background/40 to-background" />
      <div className="absolute inset-0 bg-gradient-to-r from-background/60 via-transparent to-background/60" />
      
      {/* Animated glow orbs */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/20 rounded-full blur-3xl animate-pulse-glow" />
      <div className="absolute bottom-1/4 right-1/4 w-72 h-72 bg-secondary/20 rounded-full blur-3xl animate-pulse-glow" style={{ animationDelay: "1.5s" }} />

      {/* Content */}
      <div className="container relative z-10 pt-32 pb-20 lg:pt-40 lg:pb-32">
        <div className="max-w-4xl mx-auto text-center">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 glass px-4 py-2 rounded-full mb-8 animate-fade-up">
            <span className="w-2 h-2 bg-primary rounded-full animate-pulse" />
            <span className="text-sm text-muted-foreground">The Future of Education is Here</span>
          </div>

          {/* Headline */}
          <h1 className="font-display text-5xl md:text-6xl lg:text-7xl xl:text-8xl font-bold mb-6 leading-tight animate-fade-up">
            Welcome to{" "}
            <span className="gradient-text text-glow block md:inline">Aquaterra</span>
          </h1>

          {/* Subheadline */}
          <p className="text-xl md:text-2xl text-muted-foreground max-w-2xl mx-auto mb-10 leading-relaxed animate-fade-up-delayed">
            The Education Metaverse powered by{" "}
            <span className="text-primary font-semibold">NICS AI</span>. 
            Learn, teach, and grow in immersive digital worlds.
          </p>

          {/* CTAs */}
          <div className="flex flex-col sm:flex-row gap-4 justify-center animate-fade-up" style={{ animationDelay: "0.4s" }}>
            <Button variant="glow" size="xl">
              Explore the World
            </Button>
            <Button variant="heroOutline" size="xl">
              Start Learning
            </Button>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-3 gap-8 max-w-xl mx-auto mt-16 animate-fade-up" style={{ animationDelay: "0.6s" }}>
            <div className="text-center">
              <div className="font-display text-3xl md:text-4xl font-bold text-foreground mb-1">50K+</div>
              <div className="text-muted-foreground text-sm">Active Learners</div>
            </div>
            <div className="text-center">
              <div className="font-display text-3xl md:text-4xl font-bold text-foreground mb-1">200+</div>
              <div className="text-muted-foreground text-sm">Partner Institutions</div>
            </div>
            <div className="text-center">
              <div className="font-display text-3xl md:text-4xl font-bold text-foreground mb-1">40+</div>
              <div className="text-muted-foreground text-sm">Countries</div>
            </div>
          </div>
        </div>
      </div>

      {/* Scroll indicator */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 animate-float">
        <div className="w-6 h-10 border-2 border-muted-foreground/30 rounded-full flex justify-center pt-2">
          <div className="w-1 h-2 bg-primary rounded-full animate-pulse" />
        </div>
      </div>
    </section>
  );
};

export default Hero;
