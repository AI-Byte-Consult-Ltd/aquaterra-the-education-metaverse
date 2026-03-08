import { GraduationCap, Building2, School, Briefcase, BookMarked, Users } from "lucide-react";
import { useLanguage } from "@/i18n/LanguageContext";

const UseCases = () => {
  const { t } = useLanguage();

  const useCases = [
    { icon: GraduationCap, title: t("uc_students"), description: t("uc_students_desc"), color: "from-cyan-500 to-teal-500" },
    { icon: Users, title: t("uc_educators"), description: t("uc_educators_desc"), color: "from-violet-500 to-purple-500" },
    { icon: Building2, title: t("uc_universities"), description: t("uc_universities_desc"), color: "from-blue-500 to-indigo-500" },
    { icon: School, title: t("uc_schools"), description: t("uc_schools_desc"), color: "from-emerald-500 to-green-500" },
    { icon: BookMarked, title: t("uc_training"), description: t("uc_training_desc"), color: "from-orange-500 to-amber-500" },
    { icon: Briefcase, title: t("uc_enterprises"), description: t("uc_enterprises_desc"), color: "from-pink-500 to-rose-500" },
  ];

  return (
    <section id="use-cases" className="py-24 lg:py-32 relative overflow-hidden">
      <div className="container relative z-10">
        <div className="text-center mb-16 animate-fade-up">
          <span className="text-primary font-display text-sm uppercase tracking-widest mb-4 block">{t("uc_label")}</span>
          <h2 className="font-display text-4xl md:text-5xl lg:text-6xl font-bold mb-6">
            {t("uc_title1")} <span className="gradient-text">{t("uc_title2")}</span>
          </h2>
          <p className="text-muted-foreground text-lg max-w-2xl mx-auto">{t("uc_subtitle")}</p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {useCases.map((useCase, index) => (
            <div key={index} className="group relative glass rounded-2xl p-8 transition-all duration-500 hover:scale-105 overflow-hidden animate-fade-up" style={{ animationDelay: `${index * 0.1}s` }}>
              <div className={`absolute inset-0 bg-gradient-to-br ${useCase.color} opacity-0 group-hover:opacity-10 transition-opacity duration-500`} />
              <div className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${useCase.color} flex items-center justify-center mb-6`}>
                <useCase.icon className="w-7 h-7 text-white" />
              </div>
              <h3 className="font-display text-2xl font-semibold text-foreground mb-3">{useCase.title}</h3>
              <p className="text-muted-foreground leading-relaxed">{useCase.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default UseCases;
