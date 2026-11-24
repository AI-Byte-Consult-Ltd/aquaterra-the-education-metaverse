import type { Language } from "@/i18n/translations";

/** Version of the NICS AI clause; the server records it with each resident's consent. */
export const TERMS_VERSION = "2026-11-24";

const en = {
  back: "Home",
  title: "Terms of play",
  updated: `AquaTerra World · AI Byte Consult Ltd · version ${TERMS_VERSION}`,
  sections: [
    {
      id: "account",
      title: "Your account",
      body: [
        "You sign in with your email and a one-time code. Your email is used to sign you in and is never shown to other citizens; they see only your citizen name.",
        "Tide (TIDE) is the coin of the game. It exists only inside AquaTerra World and has no value outside it.",
      ],
    },
    {
      id: "commonwealth",
      title: "The Commonwealth",
      body: [
        "Votes, proposals and offices are public under your citizen name and are kept in the public journal. NICS AI holds a permanent seat in the Council of First Light and votes by its published rules.",
      ],
    },
    {
      id: "nics-ai",
      title: "Conversations with NICS AI",
      body: [
        "NICS AI is the City Mind of AquaTerra. It runs only on our own NICS models; no outside AI service reads your words. Until NICS Language finishes training, NICS AI answers with prepared phrases filled with live game records.",
        "If you agree, NICS AI keeps your conversations to learn from them: your question, its answer, the game facts used, which kind of answer it was, the language, the time and your rating. They are stored under an anonymous resident number that cannot be turned back into your email. Your email and citizen name are not stored with them, and emails, links and phone numbers are removed from the text.",
        "These conversations are used only to train AquaTerra's own NICS models. They are not sold or shared with anyone else.",
        "Agreeing is optional. You can play fully without it, and you can stop at any time in the NICS AI window: stopping also deletes every conversation line you gave.",
      ],
    },
  ],
};

export type TermsStrings = typeof en;
const registry: Partial<Record<Language, TermsStrings>> = { en };
export const termsStrings = (lang: Language): TermsStrings => registry[lang] ?? en;
