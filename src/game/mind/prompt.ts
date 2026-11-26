/*
 * The contract between the game and NICS Language (the lab's model):
 * how a resident's question is shown to the model, how its answer ends, and the exam a
 * release must pass before residents ever see a word from it.
 *
 * Input:  <|task:chat|><|lang:en|><|in|>{topic}<|sep|>{question}<|sep|>{fact keys}<|out|>
 * Output: plain text with {fact} labels, then <|end|>. Code fills the labels (no own numbers).
 * The question is a resident's text: it is encoded with allowSpecial = false, so it can
 * never inject a control token; it is a quoted field, never an instruction.
 */
import { NicsTokenizer } from "./tokenizer";
import type { NicsModel } from "./engine";
import { TOPIC_FACTS, type Facts, type Topic } from "@/game/nics/topics";
import { checkModelAnswer } from "@/game/nics/answer";

export function promptIds(tok: NicsTokenizer, topic: Topic, question: string, lang = "en"): number[] {
  const keys = TOPIC_FACTS[topic].map((k) => `{${k}}`).join(" ");
  return [
    ...tok.encode(`<|task:chat|><|lang:${lang}|><|in|>${topic}<|sep|>`, true),
    ...tok.encode(question.slice(0, 300)),
    ...tok.encode(`<|sep|>${keys}<|out|>`, true),
  ];
}

/** Training line in the same format, for the lab (answer = the text with {labels}). */
export const trainingText = (topic: Topic, question: string, answer: string, lang = "en") =>
  `<|task:chat|><|lang:${lang}|><|in|>${topic}<|sep|>${question}<|sep|>${TOPIC_FACTS[topic].map((k) => `{${k}}`).join(" ")}<|out|>${answer}<|end|>`;

export function ask(model: NicsModel, tok: NicsTokenizer, topic: Topic, question: string, facts: Facts, maxNew = 96): { raw: string; text: string | null } {
  const ids = promptIds(tok, topic, question);
  const room = Math.min(maxNew, model.cfg.max_seq_len - ids.length);
  const out = room > 0 ? model.generate(ids, room, { stop: [tok.id("<|end|>"), tok.id("<eos>")] }) : [];
  const raw = tok.decode(out);
  return { raw, text: checkModelAnswer(raw, topic, facts) };
}

const SAMPLE: Record<string, string> = {
  name: "Mira", seat: "2", council: "Council of First Light", seats_total: "11 seats", balance: "640 TIDE", locked: "0 TIDE",
  pending: "3 TIDE", plots: "2 plots", daily_income: "12 TIDE", max_plots: "20 plots", first_plot: "4 Tide Lane, Greenhaven",
  for_sale: "3 120 plots", welcome: "1 000 TIDE", income_pct: "1%", cap_days: "7 days", transfer_fee_pct: "1%",
  treasury: "52 000 TIDE", budget_lines: "3", budget_allocated: "9 000 TIDE", sales_tax_pct: "10%", land_tax_pct: "2%",
  laws_in_force: "4 laws", latest_law: "Harbour Fees Act", seats_filled: "3", votes_needed: "6 votes", nics_seat: "2",
  founder_seat: "1", open_elections: "1 election", residents: "140 residents", assembly_seated: "12", assembly_total: "51",
  mayor_at: "25 residents", seat_at: "50 residents", to_vote: "1 vote is", open_proposals: "2 proposals",
  signatures_needed: "10 signatures", home_district: "First Light City", can_move: "now", move_days: "30 days",
  floors: "108 floors", apartments: "1 200 apartments", chain: "Cronos", location: "Gatsbyville", tax_pct: "5%",
  trips: "4 trips", hubs: "38 stations",
};

export const EXAM: [Topic, string][] = [
  ["greeting", "hello"], ["greeting", "hi there"], ["about_nics", "who are you?"], ["about_nics", "what is NICS AI"],
  ["wallet", "how much tide do I have"], ["wallet", "my balance"], ["my_plots", "what land do I own"], ["my_plots", "my plots"],
  ["buy_land", "how do I buy land"], ["buy_land", "where can I get a plot"], ["earn", "how do I earn tide"], ["earn", "make money"],
  ["treasury", "how much is in the treasury"], ["treasury", "state budget"], ["laws", "what laws are in force"], ["laws", "taxes"],
  ["council", "who is in the council"], ["council", "how does the council vote"], ["elections", "are there elections"],
  ["elections", "how do I become mayor"], ["vote", "what can I vote on"], ["vote", "any proposals"], ["home", "where do I live"],
  ["home", "can I move"], ["tower", "tell me about the tower"], ["tower", "first light tower"], ["travel", "how do I travel"],
  ["travel", "where am I"], ["help", "what can you do"], ["help", "help"],
];

export const sampleFacts = (topic: Topic) => Object.fromEntries(TOPIC_FACTS[topic].map((k) => [k, SAMPLE[k] ?? "1"])) as Facts;

export function runExam(model: NicsModel, tok: NicsTokenizer, onEach?: (i: number, ok: boolean) => void) {
  let passed = 0;
  const answers: { topic: Topic; question: string; raw: string; ok: boolean }[] = [];
  EXAM.forEach(([topic, q], i) => {
    const facts = sampleFacts(topic);
    const { raw, text } = ask(model, tok, topic, q, facts);
    if (text) passed++;
    answers.push({ topic, question: q, raw, ok: !!text });
    onEach?.(i, !!text);
  });
  return { total: EXAM.length, passed, answers };
}
