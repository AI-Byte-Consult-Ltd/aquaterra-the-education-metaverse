import type { Language } from "@/i18n/translations";

const n = (v: number) => v.toLocaleString("en");
const mb = (bytes: number) => `${(bytes / 1048576).toFixed(0)} MB`;
const millions = (p: number) => `${(p / 1e6).toFixed(1)} M`;

const en = {
  title: "City Mind",
  short: "Mind",
  backToWorld: "Back to the world",
  intro:
    "NICS AI has one mind: NICS Language, a model built from scratch in the NICS lab, with its own architecture, its own tokenizer and its own weights. It grows in the lab. AquaTerra receives numbered versions of it and runs them right in your browser, and what citizens teach it here (with their consent) goes back into its training.",
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
  tryNote: (bytes: number) => `Runs on your device, nothing is sent anywhere. Download once: ${mb(bytes)}.`,
  load: "Load the City Mind",
  loading: (bytes: number, total: number) => `Downloading ${mb(bytes)} of ${mb(total)}`,
  ready: "Ready. Pick a topic and ask.",
  ask: "Ask",
  thinking: "Thinking on your device",
  failedCheck: "This answer did not pass the city's checks, so it is not shown. The lab will see that this version still needs to learn.",
  loadError: "Could not load this version. Please try again later.",
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
