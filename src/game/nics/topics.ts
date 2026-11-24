/*
 * The question types NICS AI answers. Each type has a fixed list of facts the
 * game passes with it (key = value, always filled by code from live records).
 * The same list goes to NICS Language: it writes text with {placeholders}
 * from these keys only, and code fills in the numbers and names.
 */

export const TOPICS = [
  "greeting",
  "about_nics",
  "wallet",
  "my_plots",
  "buy_land",
  "earn",
  "treasury",
  "laws",
  "council",
  "elections",
  "vote",
  "home",
  "tower",
  "travel",
  "help",
  "unknown",
] as const;
export type Topic = (typeof TOPICS)[number];

/** Facts each topic carries. Values are strings already formatted for the resident's language. */
export const TOPIC_FACTS = {
  greeting: ["name"],
  about_nics: ["seat", "council", "seats_total"],
  wallet: ["balance", "locked", "pending", "plots"],
  my_plots: ["plots", "daily_income", "pending", "max_plots", "first_plot"],
  buy_land: ["for_sale", "welcome", "income_pct", "cap_days", "max_plots"],
  earn: ["income_pct", "cap_days", "transfer_fee_pct", "welcome"],
  treasury: ["treasury", "budget_lines", "budget_allocated", "sales_tax_pct", "land_tax_pct"],
  laws: ["laws_in_force", "latest_law", "sales_tax_pct", "land_tax_pct"],
  council: ["seats_total", "seats_filled", "votes_needed", "nics_seat", "founder_seat"],
  elections: ["open_elections", "residents", "assembly_seated", "assembly_total", "mayor_at", "seat_at"],
  vote: ["to_vote", "open_proposals", "signatures_needed"],
  home: ["home_district", "can_move", "move_days"],
  tower: ["floors", "apartments", "chain"],
  travel: [],
  help: [],
  unknown: [],
} as const satisfies Record<Topic, readonly string[]>;

export type FactKey = (typeof TOPIC_FACTS)[Topic][number];
export type Facts = Partial<Record<FactKey, string>>;

/** Topics a resident can pick on the card, in this order. */
export const MENU: Topic[] = ["wallet", "my_plots", "buy_land", "earn", "treasury", "laws", "council", "elections", "vote", "home", "tower", "travel", "about_nics"];

/** Topics whose facts need a signed-in resident. */
export const PERSONAL: ReadonlySet<Topic> = new Set<Topic>(["wallet", "my_plots", "vote", "home"]);

/*
 * Free text is only matched against these words to pick a topic. The text
 * itself never reaches any rule, only the topic does.
 */
const WORDS: [Topic, RegExp][] = [
  ["travel", /\b(travel|trip|train|plane|flight|ferry|airship|car|drive|airport|station|journey)\b/],
  ["tower", /\b(tower|first light tower|apartment|apartments|radiant|floor|floors|nft)\b/],
  ["wallet", /\b(wallet|balance|my tide|how much tide|coins?|money|locked)\b/],
  ["my_plots", /\b(my plots?|my land|i own|owned|my income|claim)\b/],
  ["buy_land", /\b(buy|purchase|price|cost|for sale|get a plot|new plot|land)\b/],
  ["earn", /\b(earn|income|profit|make tide|rent|yield|send tide|transfer|fee)\b/],
  ["treasury", /\b(treasury|budget|state money|reserve|taxes collected)\b/],
  ["laws", /\b(laws?|statute|rules?|tax|taxes|charter|legal)\b/],
  ["council", /\b(council|councillor|seats?|founder|senate)\b/],
  ["elections", /\b(elections?|elect|candidate|stand|mayor|deputy|assembly|ballot)\b/],
  ["vote", /\b(vote|voting|proposals?|petition|sign|referendum)\b/],
  ["home", /\b(home|district|move|citizenship|residence|live|where do i live)\b/],
  ["about_nics", /\b(who are you|what are you|nics|ai|you learn|your name|are you human|robot)\b/],
  ["greeting", /^\s*(hi|hello|hey|good (morning|evening|afternoon)|greetings)\b/],
  ["help", /\b(help|what can you|topics|commands)\b/],
];

export const classify = (text: string): Topic => {
  const s = text.toLowerCase().replace(/\s+/g, " ").slice(0, 500);
  if (!s.trim()) return "help";
  for (const [topic, re] of WORDS) if (re.test(s)) return topic;
  return "unknown";
};
