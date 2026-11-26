/*
 * Training examples of the AquaTerra chat task for the NICS lab, in the exact prompt format
 * of src/game/mind/prompt.ts: every resident question variant x every prepared phrase of its topic.
 * Only the game's own texts (no outside data). The lab adds these to its task examples.
 *   npx vite-node scripts/mind-chat-examples.ts > chat-train.jsonl
 */
import { phraseBank } from "../src/game/nics/phrases";
import { TOPICS, type Topic } from "../src/game/nics/topics";
import { trainingText, EXAM } from "../src/game/mind/prompt";

const extra: Partial<Record<Topic, string[]>> = {
  greeting: ["good morning", "hey", "hello NICS"], about_nics: ["what are you", "tell me about yourself"],
  wallet: ["how much do I have", "show my wallet", "what is my balance"], my_plots: ["which plots are mine", "show my land"],
  buy_land: ["I want to buy land", "how much is a plot"], earn: ["how can I get more tide", "how does income work"],
  treasury: ["how rich is the state", "what is in the treasury"], laws: ["which laws exist", "what are the taxes"],
  council: ["who governs the city", "tell me about the council"], elections: ["when are elections", "can I run for mayor"],
  vote: ["do I need to vote", "what is open for voting"], home: ["what is my home district", "how do I move"],
  tower: ["what is first light tower", "where do you live"], travel: ["how do I get around", "where can I go"],
  help: ["what do you know", "commands"], unknown: ["what is the meaning of life", "tell me a joke"],
};
const bank = phraseBank("en");
const out: string[] = [];
for (const topic of TOPICS as readonly Topic[]) {
  const qs = [...new Set([...EXAM.filter(([t]) => t === topic).map(([, q]) => q), ...(extra[topic] ?? [])])];
  for (const q of qs) for (const p of bank[topic]) out.push(JSON.stringify({ task: "aquaterra-chat", lang: "en", topic, text: trainingText(topic, q, p.text) }));
}
console.log(out.join("\n"));
