import type { Language } from "@/i18n/translations";
import type { AvatarStyle } from "./avatars";
import type { ResidentsError } from "./api";

const en = {
  avatarTitle: "Your avatar",
  chooseAvatar: "Choose your avatar",
  avatarIntro: "This is how other residents see you on the map. You can change it any time in your profile.",
  styles: {
    drop: "Drop",
    explorer: "Explorer",
    builder: "Builder",
    sailor: "Sailor",
    scholar: "Scholar",
    pilot: "Pilot",
    diver: "Diver",
    robot: "Robot",
    astronaut: "Astronaut",
    wisp: "Wisp",
  } satisfies Record<AvatarStyle, string>,
  colour: "Colour",
  visible: "Show me on the map to other residents",
  visibleHint: "When this is off, nobody else sees you on the map. You still see yourself.",
  save: "Save avatar",
  saving: "Saving…",
  saved: "Saved",
  next: "Next",
  skip: "Skip for now",
  // on the map
  online: (n: number) => (n === 1 ? "1 resident online" : `${n.toLocaleString("en")} residents online`),
  recent: (n: number) => (n === 1 ? "1 resident this week" : `${n.toLocaleString("en")} residents this week`),
  aloneNow: "No other residents online right now",
  showResidents: "Show residents",
  hideResidents: "Hide residents",
  residentAway: "away",
  errors: {
    session: "Your session has ended. Please sign in again.",
    style: "Pick one of the avatars.",
    hue: "Pick one of the colours.",
    action: "Not possible.",
    network: "Connection problem. Check your internet and try again.",
  } satisfies Record<ResidentsError, string>,
};

export type ResidentsStrings = typeof en;

/** English only for now (decision 2026-11-22). Add a language by registering another object. */
const registry: Partial<Record<Language, ResidentsStrings>> = { en };

export const residentsStrings = (lang: Language): ResidentsStrings => registry[lang] ?? en;
