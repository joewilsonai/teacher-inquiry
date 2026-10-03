import type { Cog } from "./data";
import { MAX_MEANING_CHARS } from "./limits";
import { type Copy, fill } from "./slots";

// Builds the reading she sees. Every sentence is an authored frame from data/copy.md; the
// only words that are not authored are the middle clause, and when that clause is missing
// or out of bounds the cog's own authored fallback is used, so the frame is always whole.

// Tidy the model's clause so it sits inside "In this model that means ___."
export function boundMeaning(raw: string, lead: Cog): { meaning: string; fallback: boolean } {
  let meaning = raw.replace(/\s+/g, " ").trim();
  meaning = meaning.replace(/^in this model,? that means\s+/i, "").replace(/\.$/, "").trim();
  if (/^[A-Z][a-z]/.test(meaning)) meaning = meaning[0].toLowerCase() + meaning.slice(1);
  if (meaning === "" || meaning.length > MAX_MEANING_CHARS || meaning.includes("?")) {
    return { meaning: lead.fallbackMeaning, fallback: true };
  }
  return { meaning, fallback: false };
}

export type Paraphrase = {
  text: string; // the whole reading, before the closing question
  cite: string; // the citation sentence by itself
  question: string;
  fallback: boolean;
  sentences: { lead: string; meaning: string; cite: string; others: string };
};

// cogs[0] leads; each of the rest is named out loud in a sentence of its own, because the
// names themselves contain commas and "&" and cannot be strung into a list. Only the lead
// is cited.
export function compose(cogs: Cog[], rawMeaning: string, copy: Copy): Paraphrase {
  const [lead, ...others] = cogs;
  const { meaning, fallback } = boundMeaning(rawMeaning, lead);
  const article = /^[aeiou]/i.test(lead.name) ? "an" : "a";
  const sentences = {
    lead: fill(copy["paraphrase.lead"], { article, name: lead.name }),
    meaning: fill(copy["paraphrase.meaning"], { meaning }),
    cite: lead.citeSentence ?? fill(copy["paraphrase.cite"], { cite: lead.cite }),
    others: others.map((c) => fill(copy["paraphrase.others"], { name: c.name })).join(" "),
  };
  return {
    text: [sentences.lead, sentences.meaning, sentences.cite, sentences.others].filter(Boolean).join(" "),
    cite: sentences.cite,
    question: copy["paraphrase.question"],
    fallback,
    sentences,
  };
}
