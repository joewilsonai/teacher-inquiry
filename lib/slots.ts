// Every piece of interface text the app can show. Each one is a "## <slot>" section in
// data/copy.md. A slot missing from that file, or a section there that is not listed here,
// stops the app at load with the slot's name, so a typo cannot quietly drop a sentence.
// Safe to import from the browser.
export const SLOTS = [
  "site.title",
  "site.description",
  "banner.draft",
  "page.eyebrow",
  "page.title",
  "page.lede",
  "band.legend",
  "account.label",
  "account.placeholder",
  "account.submit",
  "said.eyebrow",
  "reading.eyebrow",
  "paraphrase.lead",
  "paraphrase.meaning",
  "paraphrase.cite",
  "paraphrase.others",
  "paraphrase.question",
  "agree.button",
  "disagree.button",
  "disagree.label",
  "disagree.submit",
  "disagree.cancel",
  "ask.eyebrow",
  "ask.sentence",
  "ask.label",
  "ask.submit",
  "held.sentence",
  "beyond.eyebrow",
  "beyond.again",
  "settled.eyebrow",
  "settled.line",
  "past.agreed",
  "past.disagreed",
  "past.added",
  "status.thinking",
  "restart",
  "limits.unavailable",
  "limits.busy",
  "limits.long",
  "limits.empty",
  "limits.turns",
  "limits.tangled",
  "limits.offline",
  "limits.retry",
  "down.sentence",
] as const;

export type Slot = (typeof SLOTS)[number];
export type Copy = Record<Slot, string>;

// Fills the {placeholders} in an authored sentence. Anything it has no value for is left as is.
export const fill = (template: string, values: Record<string, string>) =>
  template.replace(/\{(\w+)\}/g, (whole, key: string) => values[key] ?? whole);
