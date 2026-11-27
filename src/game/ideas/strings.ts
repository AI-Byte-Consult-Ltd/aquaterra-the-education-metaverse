import type { Language } from "@/i18n/translations";
import type { IdeaError, IdeaFilter, IdeaStatus, IdeaTopic } from "./api";

const n = (v: number) => v.toLocaleString("en");

const en = {
  n,
  title: "Ideas for NICS",
  short: "Ideas",
  backToWorld: "Back to the world",
  intro:
    "Tell NICS AI how AquaTerra should grow: a new district, a machine from the future, a better law, a game. NICS AI reads every idea, remembers what residents ask for, and passes the ideas to the Council of First Light. The Council takes the best ones into development.",
  formTitle: "Share an idea",
  ideaTitle: "Idea in one line",
  ideaTitlePh: "Hover trams between the islands",
  ideaBody: "Tell more",
  ideaBodyPh: "What should it be, who would use it, why would the city be better with it?",
  topic: "Topic",
  auto: "Let NICS AI decide",
  send: "Send to NICS AI",
  leftToday: (l: number, d: number) => `${l} of ${d} ideas left today`,
  noMore: "You shared all your ideas for today. Come back tomorrow.",
  signIn: "Sign in to share ideas and support others",
  dataNote: "Do not write personal data. Emails, links and phone numbers are removed. NICS AI learns from ideas without names.",
  received: "NICS AI received your idea and passed it to the Council.",
  nicsRead: (topic: string) => `NICS AI filed it under ${topic}.`,
  nicsSimilar: (ids: number[]) =>
    ids.length === 1 ? `Another resident had a similar idea: #${ids[0]}.` : `${ids.length} other ideas are similar: ${ids.map((i) => `#${i}`).join(", ")}.`,
  nicsNew: "Nobody has asked for this before.",
  learned: "What NICS AI has learned",
  learnedNote: (ideas: number, residents: number) => `${n(ideas)} ${ideas === 1 ? "idea" : "ideas"} from ${n(residents)} ${residents === 1 ? "resident" : "residents"}`,
  sharedWords: "Residents ask for",
  board: "Ideas board",
  empty: "No ideas here yet.",
  by: (a: string) => `by ${a}`,
  support: "Support",
  supported: "Supported",
  supports: (s: number) => `${n(s)} ${s === 1 ? "resident supports" : "residents support"}`,
  withdraw: "Take back",
  council: "Council of First Light",
  councilNote: "Note from the Council",
  decidedBy: (who: string) => `Decision by ${who}`,
  decide: "Council decision",
  notePh: "A short note for the resident (needed to decline)",
  actions: { accepted: "Accept", in_dev: "Into development", done: "Built", rejected: "Decline", open: "Reopen" } as Record<IdeaStatus, string>,
  filters: { open: "New", accepted: "Accepted", in_dev: "In development", done: "Built", rejected: "Declined", all: "All", mine: "Mine" } as Record<IdeaFilter, string>,
  statuses: { open: "With the Council", accepted: "Accepted", in_dev: "In development", done: "Built", rejected: "Declined" } as Record<IdeaStatus, string>,
  topics: {
    tech: "Future tech", economy: "Economy", building: "Building", transport: "Transport", nature: "Ocean and nature",
    governance: "Government", play: "Games and events", nics: "NICS AI", other: "Other",
  } as Record<IdeaTopic, string>,
  errors: {
    session: "Please sign in again.",
    title: "Write the idea in at least 5 characters.",
    body: "Tell a bit more: at least 20 characters.",
    limit: "You shared all your ideas for today.",
    duplicate: "You already shared an idea with this title.",
    category: "Choose a topic.",
    not_found: "This idea is gone.",
    own: "You cannot support your own idea.",
    closed: "The Council already decided on this idea.",
    council: "Only Council members decide on ideas.",
    status: "Something went wrong.",
    note: "Write a short note when you decline an idea.",
    action: "Something went wrong.",
    network: "No connection to NICS AI. Try again.",
  } satisfies Record<IdeaError, string>,
};

export type IdeaStrings = typeof en;
const registry: Partial<Record<Language, IdeaStrings>> = { en };
export const ideaStrings = (lang: Language): IdeaStrings => registry[lang] ?? en;
