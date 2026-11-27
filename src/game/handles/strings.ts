import type { Language } from "@/i18n/translations";
import type { HandleError } from "./api";

const en = {
  label: "Your @handle",
  hint: "Unique, Latin letters, digits and _ (3–20). Residents send you Tide by it.",
  pickTitle: "Pick your @handle",
  pickIntro: "Your name can repeat, your @handle cannot. Other residents find you and send you Tide by it.",
  suggested: "We made this one from your name. Keep it or type your own.",
  autoNote: "Made from your name. You can change it once for free.",
  nextChange: (date: string) => `You can change it again on ${date}.`,
  checking: "Checking…",
  free: (h: string) => `@${h} is free`,
  save: "Save",
  saved: "Saved",
  keep: "Keep and continue",
  changed: (h: string) => `Your handle is now @${h}`,
  searchHint: "Type @handle or a name",
  noMatches: "No resident found",
  errors: {
    session: "Your session has ended. Please sign in again.",
    format: "Use 3–20 Latin letters, digits or _ (no _ at the ends).",
    reserved: "This handle is reserved.",
    taken: "This handle is taken. Try another.",
    too_soon: "You changed your handle recently. Please wait.",
    network: "Connection problem. Check your internet and try again.",
  } satisfies Record<HandleError, string>,
};

export type HandleStrings = typeof en;
const registry: Partial<Record<Language, HandleStrings>> = { en };
export const handleStrings = (lang: Language): HandleStrings => registry[lang] ?? en;
