import type { Language } from "@/i18n/translations";
import type { AccountError } from "./api";

const en = {
  brand: "AquaTerra World",
  back: "Home",
  loginTitle: "Enter AquaTerra World",
  loginIntro: "Sign in or create your citizen account with your email. We send a 6-digit code, no password needed.",
  emailLabel: "Email",
  emailPlaceholder: "you@example.com",
  sendCode: "Send code",
  sending: "Sending…",
  codeTitle: "Check your email",
  codeIntro: (email: string) => `We sent a 6-digit code to ${email}. It works for 15 minutes.`,
  codeLabel: "Code",
  verify: "Enter the world",
  verifying: "Checking…",
  otherEmail: "Use another email",
  resend: "Send a new code",
  checkSpam: "No email? Check the spam folder.",
  newHere: "New here? The same form creates your account.",
  profileTitle: "Citizen profile",
  profileIntro: "This is how other citizens will see you in the world.",
  displayName: "Citizen name",
  displayNameHint: "3–24 characters: letters, digits, space, dot, dash or underscore.",
  displayNamePlaceholder: "Coral Pioneer",
  save: "Save",
  saving: "Saving…",
  saved: "Saved",
  email: "Email",
  memberSince: "Citizen since",
  openWorld: "Open the world map",
  signOut: "Sign out",
  profile: "Profile",
  noName: "Citizen",
  chooseName: "Choose your citizen name",
  councilName: "Council of First Light",
  councilBadge: (title: string) => `Council · ${title}`,
  councilMember: (seat: number, title: string) => `Seat ${seat} of 11 · ${title}`,
  founder: "Founder",
  citizen: "Citizen",
  roleLabel: "Status",
  roles: { citizen: "Citizen", admin: "Admin", founder: "Founder" },
  councilTitle: "Council of First Light",
  councilIntro:
    "Eleven seats govern AquaTerra together with its City Mind. NICS AI proposes, the Council ratifies or vetoes, and citizens can petition both.",
  aiMember: "AI member",
  humanMember: "Human member",
  openSeat: "Open seat",
  openSeatNote: "Filled later by the citizens' vote.",
  seat: (n: number) => `Seat ${n}`,
  since: "Since",
  citizensCount: (n: number) => (n === 1 ? "1 citizen so far" : `${n.toLocaleString("en")} citizens so far`),
  viewCouncil: "Council of First Light",
  adminTitle: "Citizens",
  adminIntro: "Everyone who has entered AquaTerra World. Visible only to the founder and admins.",
  adminLink: "Citizens list",
  total: "Total",
  newToday: "New in 24 hours",
  colName: "Name",
  colEmail: "Email",
  colRole: "Status",
  colJoined: "Joined",
  colLastSeen: "Last sign-in",
  loading: "Loading…",
  retry: "Try again",
  errors: {
    email: "Enter a valid email address.",
    code: "Enter the 6 digits from the email.",
    wrong_code: "That code is not right or has expired. Try again or ask for a new one.",
    too_many: "Too many codes for this email in the last hour. Try again later.",
    mail_unavailable: "We could not send the email right now. Try again in a few minutes.",
    session: "Your session has ended. Please sign in again.",
    name: "Use 3–24 characters: letters, digits, space, dot, dash or underscore.",
    forbidden: "This page is only for the founder and admins.",
    network: "Connection problem. Check your internet and try again.",
  } satisfies Record<AccountError, string>,
};

export type AccountStrings = typeof en;

/**
 * The game UI is English-only for now (decision 2026-11-22). To add a
 * language, write an `AccountStrings` object and register it here.
 */
const registry: Partial<Record<Language, AccountStrings>> = { en };

export const accountStrings = (lang: Language): AccountStrings => registry[lang] ?? en;
export const accountLocale = (lang: Language): string => (registry[lang] ? lang : "en");
