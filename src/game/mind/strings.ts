import type { Language } from "@/i18n/translations";

const n = (v: number) => v.toLocaleString("en");
const millions = (p: number) => `${(p / 1e6).toFixed(1)} M`;

const en = {
  title: "City Mind",
  short: "Mind",
  backToWorld: "Back to the world",
  intro:
    "NICS AI has one mind: NICS Language, a model built from scratch in the NICS lab, with its own architecture, its own tokenizer and its own weights. It grows in the lab. AquaTerra receives numbered versions of it and answers you with them on its own server (the weights never leave it), and what citizens teach it here (with their consent) goes back into its training.",
  liveTitle: "Version in the city",
  noLive: "No version has passed the city's exam yet. Until one does, NICS AI answers with prepared phrases filled with live numbers, never with unchecked text.",
  version: (v: number) => `Version ${v}`,
  step: (s: number) => `trained ${n(s)} steps`,
  params: (p: number) => `${millions(p)} parameters`,
  exam: (passed: number, total: number) => `exam ${n(passed)} of ${n(total)} answers passed`,
  examNone: "not examined yet",
  examRule: (min: number) => `A version goes live only when at least ${Math.round(min * 100)}% of its exam answers pass the city's checks: only the facts' own labels, no numbers of its own, no links.`,
  releasesTitle: "Versions from the lab",
  noReleases: "The lab has not sent a version yet.",
  status: { shadow: "in shadow", live: "live", retired: "retired" } as Record<string, string>,
  dataTitle: "What the city gives back",
  dataNote:
    "Only lines of citizens who agreed are shared, without names or emails. Lines rated 👎, repeated questions and floods from one resident are held back, so nobody can poison the mind.",
  consenting: "Citizens who share",
  lines: "Dialog lines",
  week: "This week",
  sent: "Sent to the lab",
  dropped: "Held back by safety rules",
  lastFetch: (d: string | null) => (d ? `The lab last collected on ${new Date(d).toUTCString()}` : "The lab has not collected yet."),
  tryTitle: "Talk to the live version",
  tryNote: "The City Mind thinks on the city's server and sends back only its checked answer.",
  signIn: "Sign in to talk to the City Mind.",
  ready: "Pick a question and ask.",
  ask: "Ask",
  thinking: "Thinking",
  tooMany: "That is enough questions for this hour. Please come back later.",
  failedCheck: "This answer did not pass the city's checks, so it is not shown. The lab will see that this version still needs to learn.",
  loadError: "The City Mind could not answer right now. Please try again later.",
  sample: "Sample numbers are used here, not your records.",
  growTitle: "How the mind grows",
  grow: [
    "The lab trains NICS Language on its own computers and sends a numbered version here.",
    "The game examines every version with its own checks before a citizen sees a word from it.",
    "Your conversations, laws and quests (with consent) go back to the lab for the next version.",
    "Next: Mind mining. Your device will help the lab train the same model and earn Tide for verified work.",
  ],
  offline: "The City Mind records are offline right now.",
};

export type MindStrings = typeof en;
const registry: Partial<Record<Language, MindStrings>> = { en };
export const mindStrings = (lang: Language): MindStrings => registry[lang] ?? en;
