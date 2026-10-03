import fs from "node:fs";
import path from "node:path";
import { checkStatus, isFinal, oneLine, parseHeader, parseSections } from "./sections";
import { type Copy, SLOTS, type Slot } from "./slots";

// Everything the system can say is authored in data/. This module only reads it.

export type CogId = string;

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
function parseCog(file: string): Cog {
  const where = `data/cogs/${file}`;
  const text = read("cogs", file);
  const head = parseHeader(text, ["id", "name", "cite", "status"]);
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
  };
}

export function loadCogs(): Cog[] {
  const cogs = fs
    .readdirSync(path.join(DATA_DIR, "cogs"))
    .filter((f) => f.endsWith(".md"))
    .map(parseCog)
    .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
  if (cogs.length === 0) throw new Error("data/cogs: no cog files found");
  const ids = new Set(cogs.map((c) => c.id));
  if (ids.size !== cogs.length) throw new Error("data/cogs: two files share an id");
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
