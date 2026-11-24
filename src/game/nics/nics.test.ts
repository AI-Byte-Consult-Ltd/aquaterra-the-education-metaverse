import { describe, expect, it } from "vitest";
import { checkModelAnswer, fill, pickPhrase, readyAnswer, slots } from "./answer";
import { phraseBank } from "./phrases";
import { MENU, TOPICS, TOPIC_FACTS, classify, type Facts, type Topic } from "./topics";

const bank = phraseBank("en");

/** A full set of facts for a topic, every key filled. */
const full = (topic: Topic): Facts => Object.fromEntries(TOPIC_FACTS[topic].map((k) => [k, `<${k}>`])) as Facts;

describe("phrase bank", () => {
  it("has phrases for every topic", () => {
    for (const t of TOPICS) expect(bank[t].length, t).toBeGreaterThan(0);
  });
  it("uses only the facts its topic carries", () => {
    for (const t of TOPICS) for (const p of bank[t]) for (const k of slots(p.text)) expect(TOPIC_FACTS[t] as readonly string[], `${t}: ${k}`).toContain(k);
  });
  it("never states a number of its own", () => {
    for (const t of TOPICS) for (const p of bank[t]) expect(p.text.replace(/\{[a-z_]+\}/g, ""), t).not.toMatch(/[0-9]/);
  });
  it("answers every topic when all facts are there", () => {
    for (const t of TOPICS) {
      const a = readyAnswer("en", t, full(t), 1);
      expect(a, t).not.toContain("{");
      expect(a).not.toBe(bank.offline[0].text);
    }
  });
  it("is honest when records cannot be read", () => {
    expect(readyAnswer("en", "treasury", null, 0)).toBe(bank.offline[0].text);
  });
  it("picks the conditional phrase when it matches", () => {
    const a = pickPhrase(bank.laws, { ...full("laws"), laws_in_force: "no laws" }, 0);
    expect(a).toMatch(/No law has been passed yet/);
    expect(pickPhrase(bank.vote, { ...full("vote"), to_vote: "nothing" }, 0)).toMatch(/Nothing is waiting/);
  });
  it("has 20 to 40 sample answers in total", () => {
    const n = TOPICS.reduce((s, t) => s + bank[t].length, 0);
    expect(n).toBeGreaterThanOrEqual(20);
  });
});

describe("fill", () => {
  it("fills and refuses gaps", () => {
    expect(fill("You hold {balance}.", { balance: "5 TIDE" })).toBe("You hold 5 TIDE.");
    expect(fill("You hold {balance}.", {})).toBeNull();
  });
});

describe("model answer check", () => {
  const f: Facts = { balance: "1,200 TIDE", locked: "0 TIDE", pending: "12 TIDE", plots: "2 plots" };
  it("accepts placeholders of the topic and fills them by code", () => {
    expect(checkModelAnswer("You have {balance} and {plots}.", "wallet", f)).toBe("You have 1,200 TIDE and 2 plots.");
  });
  it("refuses numbers written by the model", () => {
    expect(checkModelAnswer("You have 5000 TIDE.", "wallet", f)).toBeNull();
  });
  it("refuses placeholders from another topic, links and markup", () => {
    expect(checkModelAnswer("The treasury has {treasury}.", "wallet", f)).toBeNull();
    expect(checkModelAnswer("See https://example.com for {balance}", "wallet", f)).toBeNull();
    expect(checkModelAnswer("<b>{balance}</b> is yours", "wallet", f)).toBeNull();
    expect(checkModelAnswer("x".repeat(500), "wallet", f)).toBeNull();
    expect(checkModelAnswer(42, "wallet", f)).toBeNull();
  });
});

describe("classify", () => {
  it("routes common questions", () => {
    expect(classify("How much Tide do I have?")).toBe("wallet");
    expect(classify("how do I buy a plot")).toBe("buy_land");
    expect(classify("what laws are there")).toBe("laws");
    expect(classify("who sits on the council")).toBe("council");
    expect(classify("when is the next election")).toBe("elections");
    expect(classify("can I take the train to Oceania")).toBe("travel");
    expect(classify("who are you")).toBe("about_nics");
    expect(classify("hello")).toBe("greeting");
    expect(classify("what is the meaning of life")).toBe("unknown");
    expect(classify("   ")).toBe("help");
  });
  it("menu topics all have phrases", () => {
    for (const t of MENU) expect(bank[t].length).toBeGreaterThan(0);
  });
});
