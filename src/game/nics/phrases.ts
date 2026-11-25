/*
 * NICS AI's prepared answers. Every number and name comes from {placeholders}
 * that code fills from live records (see facts.ts); a phrase never states a
 * figure of its own. These phrases are also the first lesson for NICS
 * Language: it learns to answer each topic in this shape.
 *
 * To add a language, write a PhraseBank for it and register it below.
 */
import type { Language } from "@/i18n/translations";
import type { Facts, Topic } from "./topics";

export interface Phrase {
  text: string;
  /** Use this phrase only when the facts match (checked before any variant without a condition). */
  when?: (f: Facts) => boolean;
}

export type PhraseBank = Record<Topic, Phrase[]> & {
  /** Said when the live records could not be read: honest, no made-up numbers. */
  offline: Phrase[];
  /** Said when a personal topic is asked without signing in. */
  signIn: Phrase[];
};

const zero = (v?: string) => v === undefined || v === "0" || v === "0 TIDE";

const en: PhraseBank = {
  greeting: [
    { text: "Hello, {name}. I am NICS AI, the City Mind of AquaTerra. Ask me about your Tide, your land, the laws or the Commonwealth." },
    { text: "Welcome, {name}. I keep the city's records in my head: wallets, plots, laws, votes. What would you like to know?" },
  ],
  about_nics: [
    { text: "I am NICS AI, the City Mind. I hold seat {seat} of {seats_total} in the {council} and co-govern AquaTerra with its citizens. For now I speak in prepared words built on live city records; my own language model, NICS Language, is still learning." },
    { text: "I am the AI that lives in First Light Tower. I vote in the {council} from seat {seat}. I learn from how the city lives, and while NICS Language trains, my answers are prepared phrases filled with real numbers." },
  ],
  wallet: [
    { when: (f) => zero(f.balance), text: "Your wallet is empty right now: {balance}. Every new resident receives a welcome grant once; if you already spent it on land, your plots earn income you can claim in the Wallet." },
    { when: (f) => !zero(f.locked), text: "You hold {balance}. Of that, {locked} is your welcome grant: it can be spent on land but not sent to others. You own {plots} and have {pending} of income waiting to be claimed." },
    { text: "You hold {balance}. You own {plots}, and {pending} of income is waiting for you in the Wallet." },
    { text: "Your balance is {balance}. Income waiting to be claimed: {pending}. Plots in your name: {plots}." },
  ],
  my_plots: [
    { when: (f) => f.plots === "no plots", text: "You do not own land yet. You may hold up to {max_plots}. Open any free plot on the map to see its price and buy it with Tide." },
    { text: "You own {plots}. Together they earn {daily_income} a day, and {pending} is waiting to be claimed. Your first plot: {first_plot}. The limit is {max_plots} per resident." },
    { text: "In the land registry you hold {plots}, starting with {first_plot}. Daily income: {daily_income}. Ready to claim now: {pending}." },
  ],
  buy_land: [
    { text: "On sale now: {for_sale}. Tap a free plot on the map, check its price and buy it with Tide. Each plot earns {income_pct} of its price a day, and income waits up to {cap_days} for you to claim it. One resident may own up to {max_plots}." },
    { text: "To buy land, open the map and choose a free plot: the card shows its price. New residents get {welcome} once to start. Available now: {for_sale}. You can own up to {max_plots}." },
  ],
  earn: [
    { text: "Land earns Tide: every plot you own pays {income_pct} of its price a day. Claim it in the Wallet at least every {cap_days}, because income stops piling up after that. Sending Tide to another citizen costs a {transfer_fee_pct} fee for the State Treasury." },
    { text: "Start with the welcome grant of {welcome}, buy land, and the land pays you {income_pct} of its price each day. Income waits up to {cap_days}. Transfers between citizens carry a {transfer_fee_pct} fee." },
  ],
  treasury: [
    { text: "The State Treasury holds {treasury}. Budget lines in force: {budget_lines}, with {budget_allocated} allocated by law. It is filled by the {income_tax_pct} income tax, the {sales_tax_pct} sales tax, the {land_tax_pct} weekly land tax and transfer fees, and it pays the salaries of office holders every day." },
    { text: "Right now the Commonwealth has {treasury} in its treasury. Budget lines: {budget_lines}, allocated: {budget_allocated}. Taxes in force: income {income_tax_pct}, sales {sales_tax_pct}, land {land_tax_pct} a week." },
  ],
  laws: [
    { when: (f) => f.laws_in_force === "no laws", text: "No law has been passed yet: the statute book is waiting for its first entry. The city's base rules apply: income tax {income_tax_pct}, sales tax {sales_tax_pct}, land tax {land_tax_pct} a week. Any citizen can write a proposal in the Commonwealth." },
    { text: "The statute book has {laws_in_force} in force. The latest is “{latest_law}”. Taxes now: income {income_tax_pct}, sales {sales_tax_pct}, land {land_tax_pct} a week. The full statute book is in the Commonwealth." },
    { text: "The statute book has {laws_in_force} in force, most recently “{latest_law}”. The income tax is {income_tax_pct}, the sales tax {sales_tax_pct} and the land tax {land_tax_pct} a week." },
  ],
  council: [
    { text: "The Council of First Light has {seats_total}. Filled now: {seats_filled}. The Founder holds seat {founder_seat}, I hold seat {nics_seat}. A proposal passes the Council with {votes_needed}." },
    { text: "Seats taken in the Council of First Light: {seats_filled} of {seats_total}. Seats {founder_seat} and {nics_seat} are permanent: the Founder and NICS AI. The rest are elected by the Assembly. Passing needs {votes_needed}." },
  ],
  elections: [
    { when: (f) => f.open_elections === "no elections", text: "No election is open right now. The city has {residents}. A district elects a Mayor at {mayor_at} and gets its own Assembly seat at {seat_at}. The Assembly has {assembly_seated} of {assembly_total} seated." },
    { text: "Open right now: {open_elections}. See Elections in the Commonwealth to stand or vote. The city has {residents}; the Assembly has {assembly_seated} of {assembly_total} seated." },
  ],
  vote: [
    { when: (f) => f.to_vote === "nothing", text: "Nothing is waiting for your vote right now. Open in the Commonwealth: {open_proposals}. A citizen proposal needs {signatures_needed} to go to a vote." },
    { text: "{to_vote} waiting for you. Open in total: {open_proposals}. Open the Commonwealth to read them and cast your vote." },
  ],
  home: [
    { when: (f) => f.can_move === "now", text: "Your home district is {home_district}. You can choose another home now; after a move you stay {move_days} before the next one." },
    { text: "You live in {home_district}. You can move again after {can_move}. Moves are allowed once every {move_days}." },
  ],
  tower: [
    { text: "First Light Tower is the heart of the world and my home. It has {floors} and {apartments}, each one an NFT on {chain}." },
    { text: "I live in First Light Tower: {floors}, {apartments}. Every apartment is an NFT on {chain}, and the Commonwealth's chambers stand on the plaza around it." },
  ],
  travel: [
    { text: "You are in {location}. Travel by car, train, ferry or plane: tap a district on the map and choose a route. Fares are paid in Tide, and {tax_pct} of every fare goes to the State Treasury as travel tax. Trips so far: {trips}." },
    { text: "Your drop is in {location}. The city has {hubs} you can leave from. Each fare is paid in Tide; the travel tax of {tax_pct} goes to the State Treasury. You have made {trips}." },
  ],
  help: [
    { text: "I can tell you about your wallet, your plots, how to buy land and earn Tide, the treasury, the laws, the Council, elections, votes waiting for you, your home district and First Light Tower. Pick a topic or ask in your own words." },
  ],
  unknown: [
    { text: "I do not know how to answer that yet. I am learning, and I will remember the question. For now I can tell you about your wallet, land, the treasury, laws, the Council, elections, votes and your home district." },
    { text: "That question is new to me. I keep it so I can learn to answer it. Meanwhile, try one of the topics below." },
  ],
  offline: [
    { text: "I cannot reach the city records right now, so I will not guess a number. Please ask me again in a minute." },
  ],
  signIn: [
    { text: "Sign in first, and I will look up your own records." },
  ],
};

const registry: Partial<Record<Language, PhraseBank>> = { en };

export const phraseBank = (lang: Language): PhraseBank => registry[lang] ?? en;
/** Languages that have their own phrases now. Others are answered in English. */
export const PHRASE_LANGUAGES = Object.keys(registry) as Language[];
