import fs from "node:fs";
import path from "node:path";
import { checkStatus, isFinal, oneLine, parseHeader, parseSections } from "./sections";
import { type Copy, SLOTS, type Slot } from "./slots";

// Everything the system can say is authored in data/. This module only reads it.

export type CogId = string;

// The two words the "others needed:" line of a cog file can hold. The choice between them
// is made in that file. This table only says what each word asks for.
export const HOW_MANY = ["one", "two"] as const;
export type HowMany = (typeof HOW_MANY)[number];
// "sorted" is how many cogs her account was sorted to and are still offered on this turn.
// "marked" is how many of those were on her at the same moment as her own teaching.
export type Tally = { sorted: number; marked: number };
const NEEDS: Record<HowMany, (n: Tally) => boolean> = {
  // Her teaching and one other thing on her at the same moment.
  one: ({ marked }) => marked >= 1,
  // Two of the other cogs, with her teaching on her at the same moment as at least one of them.
  two: ({ sorted, marked }) => sorted >= 2 && marked >= 1,
};
// Any other word is never enough, so a typo cannot let a reading through.
export const enough = (word: string, n: Tally): boolean =>
  (HOW_MANY as readonly string[]).includes(word) && NEEDS[word as HowMany](n);

export type Cog = {
  id: CogId;
  name: string; // the teacher-language name: what she sees and what the reading names
  cite: string; // Missouri's exact Quality Indicator name; empty when there is none
  citeSentence?: string; // a whole citation sentence, used in place of the cite frame
  status: string;
  actingOn: string;
  definition: string;
  fallbackMeaning: string;
  examples: string;
  nearMisses: string;
  // Only on the cog an account is never sorted to. It leads a reading when her words name
  // teaching of her own and enough of the cogs that were sorted to were on her at that moment.
  condition?: {
    othersNeeded: HowMany; // the "others needed:" line
    teaching: string; // "## Her teaching is named when": how the reading step decides that
    counts: string; // "## Counts alongside her teaching when": how it decides, cog by cog, what was on her then
  };
};

export type Beyond = {
  id: string;
  status: string; // of the sentence she sees
  sentence: string; // shown to her
  sits: string; // what sits here: a lookup for the threshold, never shown
  sitsStatus: string; // of that lookup paragraph, which can be a draft under a final sentence
};

// How the system reads her: the line calls that decide where an account is placed and what
// the middle of the paraphrase says. Never shown to her as written, but they shape what is.
export const RULES = ["threshold", "reading", "meaning"] as const;
export type Rule = (typeof RULES)[number];

export type Data = {
  cogs: Cog[];
  beyond: Beyond[];
  copy: Copy;
  copyStatus: Record<Slot, string>;
  rules: Record<Rule, string>;
  rulesStatus: Record<Rule, string>;
};

const DATA_DIR = path.join(process.cwd(), "data");
const read = (...parts: string[]) => fs.readFileSync(path.join(DATA_DIR, ...parts), "utf8");

// One file per cog: a few "key: value" lines at the top, then "## " sections for the rest.
// `where` is the file's name, for the message when something is missing.
export function parseCogText(text: string, where: string): Cog {
  const head = parseHeader(text, ["id", "name", "cite", "status", "others needed"]);
  const sections: Record<string, string> = {};
  for (const chunk of text.split(/^## /m).slice(1)) {
    const [heading, ...rest] = chunk.split("\n");
    sections[heading.trim().toLowerCase()] = rest.join("\n").trim();
  }
  const need = (value: string | undefined, what: string): string => {
    const found = (value ?? "").trim();
    if (!found) throw new Error(`${where}: missing ${what}`);
    return found;
  };
  const cite = (head.cite ?? "").trim();
  const citeSentence = oneLine(sections["cite sentence"] ?? "") || undefined;
  if (!cite && !citeSentence) throw new Error(`${where}: needs a "cite:" line or a "## Cite sentence" section`);

  // A cog file carries one of two lines. With "cite:", accounts are sorted to it. With
  // "others needed:", they never are. A file with neither stops the load, so deleting that
  // line cannot quietly turn the cog into one more choice in the sort.
  const others = head["others needed"]?.trim().toLowerCase();
  if (others === undefined && !cite) throw new Error(`${where}: needs a "cite:" line or an "others needed:" line`);
  let condition: Cog["condition"];
  if (others !== undefined) {
    if (cite) throw new Error(`${where}: has both a "cite:" line and an "others needed:" line; a cog takes one or the other`);
    if (!(HOW_MANY as readonly string[]).includes(others)) {
      throw new Error(`${where}: "others needed:" must be ${HOW_MANY.map((w) => `"${w}"`).join(" or ")} (found "${others}")`);
    }
    condition = {
      othersNeeded: others as HowMany,
      teaching: need(sections["her teaching is named when"], 'the "## Her teaching is named when" section'),
      counts: need(sections["counts alongside her teaching when"], 'the "## Counts alongside her teaching when" section'),
    };
  }
  return {
    id: need(head.id, 'an "id:" line'),
    name: need(head.name, 'a "name:" line'),
    cite,
    citeSentence,
    status: checkStatus(need(head.status, 'a "status:" line'), where),
    actingOn: oneLine(need(sections["acting on"], 'the "## Acting on" section')),
    definition: need(sections["definition"], 'the "## Definition" section'),
    fallbackMeaning: oneLine(need(sections["fallback meaning"], 'the "## Fallback meaning" section')),
    examples: sections["examples"] ?? "",
    nearMisses: sections["near-misses"] ?? "",
    ...(condition ? { condition } : {}),
  };
}

const parseCog = (file: string): Cog => parseCogText(read("cogs", file), `data/cogs/${file}`);

export function loadCogs(): Cog[] {
  const cogs = fs
    .readdirSync(path.join(DATA_DIR, "cogs"))
    .filter((f) => f.endsWith(".md"))
    .map(parseCog)
    .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
  if (cogs.length === 0) throw new Error("data/cogs: no cog files found");
  const ids = new Set(cogs.map((c) => c.id));
  if (ids.size !== cogs.length) throw new Error("data/cogs: two files share an id");
  if (cogs.filter((c) => c.condition).length !== 1) throw new Error('data/cogs: exactly one cog file carries an "others needed:" line');
  if (!cogs.some((c) => !c.condition)) throw new Error('data/cogs: no cog an account can be sorted to (every file has an "others needed:" line)');
  return cogs;
}

export function loadBeyond(): Beyond[] {
  const file = "data/threshold.md";
  const beyond = parseSections(read("threshold.md"), file, {
    keys: ["status", "sentence", "lookup"],
    required: ["status", "sentence"],
    wraps: ["sentence"],
  }).map((s) => {
    if (!s.body) throw new Error(`${file}: section "${s.id}" needs a paragraph saying what sits there, after a blank line`);
    const status = checkStatus(s.status!, `${file} "${s.id}"`);
    return {
      id: s.id,
      status,
      sentence: s.sentence!,
      sits: s.body,
      // With no "lookup:" line the paragraph has the same status as the sentence above it.
      sitsStatus: s.lookup ? checkStatus(s.lookup, `${file} "${s.id}" lookup`) : status,
    };
  });
  if (beyond.some((b) => b.id === "inside")) throw new Error(`${file}: "inside" is not a place beyond`);
  if (beyond.length === 0) throw new Error(`${file}: no sections found`);
  return beyond;
}

export function loadCopy(): { copy: Copy; copyStatus: Record<Slot, string> } {
  const file = "data/copy.md";
  const copy = {} as Copy;
  const copyStatus = {} as Record<Slot, string>;
  for (const s of parseSections(read("copy.md"), file, { keys: ["status"], required: ["status"] })) {
    if (!(SLOTS as readonly string[]).includes(s.id)) throw new Error(`${file}: "${s.id}" is not a slot the app knows`);
    if (!s.body) throw new Error(`${file}: slot "${s.id}" has no text`);
    // The text may be wrapped across lines in the file; it is one sentence on the page.
    copy[s.id as Slot] = oneLine(s.body);
    copyStatus[s.id as Slot] = checkStatus(s.status!, `${file} "${s.id}"`);
  }
  for (const slot of SLOTS) if (!copy[slot]) throw new Error(`${file}: slot "${slot}" is missing`);
  return { copy, copyStatus };
}

export function loadRules(): { rules: Record<Rule, string>; rulesStatus: Record<Rule, string> } {
  const file = "data/rules.md";
  const rules = {} as Record<Rule, string>;
  const rulesStatus = {} as Record<Rule, string>;
  for (const s of parseSections(read("rules.md"), file, { keys: ["status"], required: ["status"] })) {
    if (!(RULES as readonly string[]).includes(s.id)) throw new Error(`${file}: "${s.id}" is not a section the app knows`);
    if (!s.body) throw new Error(`${file}: section "${s.id}" has no rules in it`);
    rules[s.id as Rule] = s.body;
    rulesStatus[s.id as Rule] = checkStatus(s.status!, `${file} "${s.id}"`);
  }
  for (const rule of RULES) if (!rules[rule]) throw new Error(`${file}: section "${rule}" is missing`);
  return { rules, rulesStatus };
}

// Read from disk on every request, so an edit to data/ shows on the next one.
export function loadData(): Data {
  return { cogs: loadCogs(), beyond: loadBeyond(), ...loadCopy(), ...loadRules() };
}

// Everything that is not yet Kim's own words, by where it lives. `npm run drafts` prints this.
export function drafts(data: Data): string[] {
  return [
    ...data.cogs.filter((c) => !isFinal(c.status)).map((c) => `cogs/${c.id}.md`),
    ...data.beyond.flatMap((b) => [
      ...(isFinal(b.status) ? [] : [`threshold.md "${b.id}"`]),
      ...(isFinal(b.sitsStatus) ? [] : [`threshold.md "${b.id}" lookup`]),
    ]),
    ...RULES.filter((r) => !isFinal(data.rulesStatus[r])).map((r) => `rules.md "${r}"`),
    ...SLOTS.filter((s) => !isFinal(data.copyStatus[s])).map((s) => `copy.md "${s}"`),
  ];
}

// The prototype banner shows while anything is not yet Kim's own words: what she reads on
// the page, and what decides what she reads.
export function isDraft(data: Data): boolean {
  return drafts(data).length > 0;
}
