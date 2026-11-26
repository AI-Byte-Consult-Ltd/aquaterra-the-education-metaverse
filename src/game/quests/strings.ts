import type { Language } from "@/i18n/translations";
import type { Quest, QuestsError } from "./api";

const n = (v: number) => v.toLocaleString("en");
const tide = (v: number) => `${n(v)} TIDE`;

const en = {
  tide,
  title: "Quests of NICS AI",
  short: "Quests",
  backToWorld: "Back to the world",
  intro:
    "Every day at midnight UTC NICS AI, the mind of the city, looks at what happened in AquaTerra and writes new quests: places few people visit, games few people play, decisions that wait for citizens. Rewards come from the NICS AI fund.",
  signIn: "Sign in to take quests and collect rewards.",
  quest: (q: Quest): { title: string; how: string } => {
    switch (q.id) {
      case "visit":
        return { title: `Visit ${q.districtName}`, how: "Travel there by car, train, ferry or plane. Standing in the district counts too." };
      case "play":
        return { title: `Play ${q.title}`, how: `A pop-up attraction of NICS AI at ${q.address}, ${q.districtName}. Travel to the plot and play once (win or lose).` };
      case "civic":
        return { title: "Have your say", how: `${n(q.open)} ${q.open === 1 ? "proposal waits" : "proposals wait"} in the Commonwealth. Sign a petition or cast a vote today.` };
      case "ride":
        return { title: `Ride the ${q.mode}`, how: `Take at least one ${q.mode} trip today.` };
      case "ask":
        return { title: questionOf(q.topic), how: "One try. The answer is on the Commonwealth page." };
    }
  },
  reward: (v: number) => (v > 0 ? `+${tide(v)}` : "No reward today"),
  claim: "Collect",
  claimed: "Collected",
  done: "Done",
  todo: "To do",
  go: "Go",
  rightAnswer: "Right!",
  wrongAnswer: "Not this time. Come back tomorrow.",
  paid: (v: number, tax: number) => `+${tide(v - tax)} to your wallet (${tide(tax)} income tax to the State Treasury)`,
  fundEmpty: "Done! NICS AI's fund for today is spent, so this one pays nothing. New quests and rewards tomorrow.",
  fund: "NICS AI fund",
  fundNote: "Fed every day by NICS AI's share of the state payroll. It pays quests and mini-games.",
  potLeft: "Left for today",
  people: "Citizens rewarded today",
  resets: (iso: string) => `New quests in ${hoursTo(iso)}`,
  tax: (p: number) => `Rewards are income: ${p}% income tax goes to the State Treasury.`,
  why: "Why NICS AI chose these",
  journal: "Journal of NICS AI",
  journalLine: (pot: number, paid: number, people: number) => `Set aside ${tide(pot)}, paid ${tide(paid)} to ${n(people)} ${people === 1 ? "citizen" : "citizens"}`,
  errors: {
    session: "Please sign in again.",
    quest: "This quest is not in today's list.",
    not_ready: "Not done yet.",
    claimed: "Already collected.",
    answered: "You already answered today.",
    choice: "Pick one of the answers.",
    action: "Something went wrong.",
    network: "Connection problem. Check your internet and try again.",
  } satisfies Record<QuestsError, string>,
};

function questionOf(t: "citizens" | "districts" | "council" | "treasury") {
  return {
    citizens: "How many citizens does AquaTerra have?",
    districts: "How many districts does the Commonwealth have?",
    council: "How many seats of the Council of First Light are filled?",
    treasury: "How much TIDE is in the State Treasury?",
  }[t];
}

function hoursTo(iso: string) {
  const ms = Math.max(0, new Date(iso).getTime() - Date.now());
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

export type QuestsStrings = typeof en;

/** English only for now (decision 2026-11-22). Add a language by registering another object. */
const registry: Partial<Record<Language, QuestsStrings>> = { en };

export const questsStrings = (lang: Language): QuestsStrings => registry[lang] ?? en;
