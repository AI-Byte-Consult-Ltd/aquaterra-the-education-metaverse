import { GraduationCap, Building2, School, Briefcase, BookMarked, Users } from "lucide-react";

const useCases = [
  {
    icon: GraduationCap,
    title: "Students",
    description: "Immersive learning experiences that make education engaging and effective. Learn at your own pace with AI guidance.",
    color: "from-cyan-500 to-teal-500",
  },
  {
    icon: Users,
    title: "Educators",
    description: "AI-powered tools to create, deliver, and optimize courses. Focus on teaching while NICS AI handles the rest.",
    color: "from-violet-500 to-purple-500",
  },
  {
    icon: Building2,
    title: "Universities",
    description: "Transform traditional education with virtual campuses, collaborative research spaces, and global reach.",
    color: "from-blue-500 to-indigo-500",
  },
  {
    icon: School,
    title: "Schools",
    description: "Engage younger learners with interactive metaverse classrooms and gamified educational experiences.",
    color: "from-emerald-500 to-green-500",
  },
  {
    icon: BookMarked,
    title: "Training Centers",
    description: "Professional certification programs with hands-on virtual simulations and skill assessments.",
    color: "from-orange-500 to-amber-500",
  },
  {
    icon: Briefcase,
    title: "Enterprises",
    description: "Corporate training and upskilling at scale. Virtual onboarding, workshops, and team collaboration.",
    color: "from-pink-500 to-rose-500",
  },
];

const UseCases = () => {
  return (
    <section id="use-cases" className="py-24 lg:py-32 relative overflow-hidden">
      <div className="container relative z-10">
        <div className="text-center mb-16 animate-fade-up">
          <span className="text-primary font-display text-sm uppercase tracking-widest mb-4 block">
            Who It's For
          </span>
          <h2 className="font-display text-4xl md:text-5xl lg:text-6xl font-bold mb-6">
            Education for <span className="gradient-text">Everyone</span>
          </h2>
          <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
            Aquaterra serves learners, educators, and institutions of all sizes and types around the world.
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {useCases.map((useCase, index) => (
            <div
              key={useCase.title}
              className="group relative glass rounded-2xl p-8 transition-all duration-500 hover:scale-105 overflow-hidden animate-fade-up"
              style={{ animationDelay: `${index * 0.1}s` }}
            >
              {/* Gradient overlay on hover */}
              <div className={`absolute inset-0 bg-gradient-to-br ${useCase.color} opacity-0 group-hover:opacity-10 transition-opacity duration-500`} />
              
              <div className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${useCase.color} flex items-center justify-center mb-6`}>
                <useCase.icon className="w-7 h-7 text-white" />
              </div>
              
              <h3 className="font-display text-2xl font-semibold text-foreground mb-3">
                {useCase.title}
              </h3>
              <p className="text-muted-foreground leading-relaxed">
                {useCase.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default UseCases;
