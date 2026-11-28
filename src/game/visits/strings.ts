import type { Language } from "@/i18n/translations";

const en = {
  title: "Visitors",
  intro:
    "Our own counter, without cookies: a visitor is counted once a day, and the IP address is never stored. Country is shown by the browser's time zone. Views by the Founder, admins and the Council are left out.",
  today: "Today",
  week: "7 days",
  month: "30 days",
  visitors: "visitors",
  views: "views",
  residents: "signed in",
  own: (n: number) => `Our own views this week, not counted: ${n.toLocaleString("en")}`,
  since: (d: string) => `Counting since ${d}`,
  none: "No visits counted yet.",
  days: "Last 14 days, visitors",
  pages: "Pages",
  sources: "Where they came from",
  zones: "Time zone (country)",
  devices: "Devices",
  languages: "Browser language",
  recent: "Latest views",
  direct: "direct / link",
  unknown: "unknown",
  device: { mobile: "phone", tablet: "tablet", desktop: "computer" } as Record<string, string>,
  colWhen: "When",
  colPage: "Page",
  colFrom: "From",
  colZone: "Time zone",
  colDevice: "Device",
  resident: "resident",
  loading: "Loading…",
  retry: "Try again",
  errors: { session: "Please sign in again.", forbidden: "Only the Founder and admins see visitors.", network: "The counter did not answer." },
};

export type VisitsStrings = typeof en;
export const visitsStrings = (_l: Language): VisitsStrings => en;
