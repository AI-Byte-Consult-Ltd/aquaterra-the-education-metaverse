/*
 * Turning a topic and its facts into words, and checking any text that comes
 * back from NICS Language before a resident sees it.
 */
import type { Language } from "@/i18n/translations";
import { phraseBank, type Phrase } from "./phrases";
import { TOPIC_FACTS, type Facts, type Topic } from "./topics";

const SLOT = /\{([a-z_]+)\}/g;

export const slots = (text: string): string[] => [...text.matchAll(SLOT)].map((m) => m[1]);

/** Fill {placeholders}; null if any is missing, so a phrase never shows a gap. */
export const fill = (text: string, facts: Facts): string | null => {
  let missing = false;
  const out = text.replace(SLOT, (_, k: string) => {
    const v = (facts as Record<string, string | undefined>)[k];
    if (v === undefined || v === "") missing = true;
    return v ?? "";
  });
  return missing ? null : out;
};

/** The first matching conditional phrase, else a variant without a condition (varied by `seed`). */
export const pickPhrase = (options: Phrase[], facts: Facts, seed: number): string | null => {
  for (const p of options) if (p.when?.(facts)) { const t = fill(p.text, facts); if (t) return t; }
  const plain = options.filter((p) => !p.when);
  for (let i = 0; i < plain.length; i++) {
    const t = fill(plain[(seed + i) % plain.length].text, facts);
    if (t) return t;
  }
  return null;
};

export const readyAnswer = (lang: Language, topic: Topic, facts: Facts | null, seed: number): string => {
  const bank = phraseBank(lang);
  if (facts === null) return pickPhrase(bank.offline, {}, seed)!;
  return pickPhrase(bank[topic], facts, seed) ?? pickPhrase(bank.offline, {}, seed)!;
};

/*
 * A model answer is accepted only if it is short plain text whose every
 * number and name comes from a placeholder: no digits of its own, no links,
 * no markup, only placeholders that belong to the topic, and every one of
 * them filled. Anything else falls back to the prepared phrase.
 */
export const MAX_MODEL_CHARS = 420;

export const checkModelAnswer = (raw: unknown, topic: Topic, facts: Facts): string | null => {
  if (typeof raw !== "string") return null;
  const text = raw.replace(/\s+/g, " ").trim();
  if (text.length < 8 || text.length > MAX_MODEL_CHARS) return null;
  const allowed = new Set<string>(TOPIC_FACTS[topic]);
  const used = slots(text);
  if (used.some((k) => !allowed.has(k))) return null;
  const bare = text.replace(SLOT, "");
  if (/[0-9]/.test(bare)) return null;
  if (/https?:|www\.|[<>{}[\]`]|@/i.test(bare)) return null;
  return fill(text, facts);
};
