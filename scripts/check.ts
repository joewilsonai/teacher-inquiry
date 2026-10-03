// Checks of the data files and the code that need no model and cost nothing.
// Run: npm run check
import fs from "node:fs";
import path from "node:path";
import { drafts as draftItems, isDraft, loadData } from "../lib/data";
import { downCopy } from "../lib/down";
import { LIMITS } from "../lib/limits";
import { conditionCog, readSystem, sortIds, thresholdSystem } from "../lib/model";
import { isFinal } from "../lib/sections";
import { SLOTS } from "../lib/slots";
import { COG_NUMBER, HEDGES, hasWord, NOT_HER_ERROR, NOT_IN_A_READING, NOT_SAID_OF_5K } from "./harness";

const root = process.cwd();
const data = loadData(); // throws, naming the file, on a missing slot, a bad status or a missing section

const problems: string[] = [];
const fail = (message: string) => problems.push(message);

function files(dir: string, keep: (file: string) => boolean): string[] {
  const full = path.join(root, dir);
  if (!fs.existsSync(full)) return [];
  if (fs.statSync(full).isFile()) return keep(dir) ? [dir] : [];
  return fs.readdirSync(full).flatMap((name) => {
    if (name === "node_modules" || name.startsWith(".")) return [];
    return files(path.join(dir, name), keep);
  });
}
const isCode = (f: string) => /\.(ts|tsx)$/.test(f);
const text = (f: string) => fs.readFileSync(path.join(root, f), "utf8");
const code = [...files("app", isCode), ...files("lib", isCode)];
const everything = [
  ...code,
  ...files("scripts", isCode),
  ...files("tools", isCode),
  ...files("data", () => true),
  "proxy.ts",
  "next.config.ts",
  "package.json",
  "README.md",
];

// 1. The citation is Missouri's exact Quality Indicator name, character for character.
const MISSOURI: Record<string, string> = {
  "5.1": "5.1 Classroom Management Techniques",
  "5.2": "5.2 Management of Time, Space, Transitions, and Activities",
  "5.3": "5.3 Classroom, school and community culture",
};
for (const [id, cite] of Object.entries(MISSOURI)) {
  const cog = data.cogs.find((c) => c.id === id);
  if (!cog) fail(`data/cogs: no cog ${id}`);
  else if (cog.cite !== cite) fail(`data/cogs/${id}.md: cite must be exactly "${cite}"`);
}
// A cog with no Missouri indicator says so in a sentence of its own, and carries no Missouri cite.
for (const cog of data.cogs.filter((c) => !(c.id in MISSOURI))) {
  if (cog.cite || !cog.citeSentence) fail(`data/cogs/${cog.id}.md: needs a "## Cite sentence" section and no "cite:" line`);
}
// A cog with a Missouri indicator is cited through the frame, never by a sentence of its own.
for (const cog of data.cogs.filter((c) => c.id in MISSOURI)) {
  if (cog.citeSentence) fail(`data/cogs/${cog.id}.md: has a Missouri "cite:", so it takes no "## Cite sentence" section`);
  // Accounts are sorted to Missouri's cogs. None of them is worked out after the sort.
  if (cog.condition) fail(`data/cogs/${cog.id}.md: has a Missouri "cite:", so it takes no "others needed:" line`);
}

// 1b. The cog with no Missouri indicator is never a choice in the sort. It carries the
//     "others needed:" line, the reading step is never told its name, and its sentence says
//     plainly that it is proposed and that Missouri has no Quality Indicator for it.
const notes: string[] = [];
const condition = conditionCog(data);
const conditionFile = `data/cogs/${condition.id}.md`;
for (const cog of data.cogs.filter((c) => !(c.id in MISSOURI))) {
  if (!cog.condition) fail(`data/cogs/${cog.id}.md: has no Missouri "cite:", so it needs an "others needed:" line`);
}
if (sortIds(data).join() !== Object.keys(MISSOURI).join()) {
  fail(`data/cogs: accounts must be sorted to exactly Missouri's cogs (${Object.keys(MISSOURI).join(", ")}); the sort now holds ${sortIds(data).join(", ")}`);
}
{
  const sentence = condition.citeSentence ?? "";
  // While the file is a DRAFT these stop the build. Once Kim has written the sentence
  // herself (status: final) her wording stands, and the same three are only pointed out.
  const report = isFinal(condition.status) ? (m: string) => notes.push(m) : fail;
  if (!/propos/i.test(sentence)) report(`${conditionFile}: the "## Cite sentence" section must say this is proposed (the word "proposed" is not in it)`);
  if (!/Quality Indicator/i.test(sentence)) report(`${conditionFile}: the "## Cite sentence" section must say Missouri has no Quality Indicator for this (the words "Quality Indicator" are not in it)`);
  for (const word of HEDGES) {
    if (hasWord(sentence, word)) report(`${conditionFile}: the "## Cite sentence" section says "${word}"; it says this is proposed without doubting it`);
  }
  for (const word of NOT_SAID_OF_5K) {
    if (hasWord(sentence, word)) fail(`${conditionFile}: the "## Cite sentence" section says "${word}"; this cog is never called that, and never presented as Missouri's`);
  }
  const citeLeadIn = data.copy["paraphrase.cite"].split("{")[0].trim();
  if (citeLeadIn && sentence.includes(citeLeadIn)) fail(`${conditionFile}: the "## Cite sentence" section begins a citation ("${citeLeadIn}"); there is nothing of Missouri's to cite for this cog`);
}
{
  // The sorting step is never told this cog's name: not by another cog file, not by the
  // rules, and not by the sections of its own file that the step is shown.
  let named = false;
  for (const f of files("data/cogs", () => true)) {
    if (f !== path.join("data", "cogs", `${condition.id}.md`) && text(f).includes(condition.name)) {
      named = true;
      fail(`${f}: names "${condition.name}"; an account is never sorted to that cog, so no other cog file points to it`);
    }
  }
  for (const rule of ["reading", "meaning"] as const) {
    if (data.rules[rule].includes(condition.name)) {
      named = true;
      fail(`data/rules.md "${rule}": names "${condition.name}"; the sorting step is never told that cog's name`);
    }
  }
  const prompt = readSystem(data);
  if (prompt.includes(`<cog id="${condition.id}"`)) fail(`lib/model.ts: the sorting step is shown ${condition.id} as a cog to sort to; it is worked out after the sort`);
  if (!named && prompt.includes(condition.name)) {
    fail(`${conditionFile}: the sorting step is never told this cog's name; take "${condition.name}" out of the Definition, Examples and Near-misses sections and the two sections of rules`);
  }
}

// 1c. No test account is also an example in a cog file, or the evaluation would be marking
//     the system on sentences it was handed. Whole sentences are compared, never parts.
{
  const norm = (s: string) => s.replace(/[’‘]/g, "'").replace(/\s+/g, " ").trim().toLowerCase();
  const accounts = new Map<string, number>();
  text(path.join("data", "tests.md")).split("\n").forEach((line, i) => {
    const m = line.match(/^\s*- \[[^\]]+\] (.+)$/);
    if (!m) return;
    const said = m[1].replace(/\s+#[^#]*$/, "").replace(/^(\[[^\]]+\]\s*)+/, "");
    if (said && said !== "(no note)") accounts.set(norm(said), i + 1);
  });
  for (const c of data.cogs) {
    // Each bullet under Examples and Near-misses, and the quoted sentence a near-miss opens with.
    const bullets = `${c.examples}\n${c.nearMisses}`.split("\n").flatMap((l) => (l.startsWith("- ") ? [l.slice(2).trim()] : []));
    const sentences = [...bullets, ...bullets.flatMap((b) => b.match(/^"([^"]+)"/)?.[1] ?? [])];
    for (const sentence of sentences) {
      const line = accounts.get(norm(sentence));
      if (line) fail(`data/cogs/${c.id}.md: "${sentence}" is also a test account (data/tests.md line ${line}); a test account never appears in a cog file`);
    }
  }
}

// 2. Nothing she can be shown blames her, turns her away, gives advice, or assigns a motive.
const shown: [string, string][] = [
  ...SLOTS.map((s): [string, string] => [`copy.md "${s}"`, data.copy[s]]),
  ...data.beyond.map((b): [string, string] => [`threshold.md "${b.id}" sentence`, b.sentence]),
  ...data.cogs.flatMap((c): [string, string][] => [
    [`cogs/${c.id}.md fallback meaning`, c.fallbackMeaning],
    [`cogs/${c.id}.md cite sentence`, c.citeSentence ?? ""],
  ]),
];
for (const [where, sentence] of shown) {
  for (const word of [...NOT_HER_ERROR, ...NOT_IN_A_READING]) {
    if (hasWord(sentence, word)) fail(`${where}: contains "${word}"`);
  }
}
// A whole sentence she is shown ends like one. A sentence cut short in the file (a line
// break in the wrong place, a stray character) stops here instead of reaching her.
for (const [where, sentence] of [
  ...data.beyond.map((b): [string, string] => [`threshold.md "${b.id}" sentence`, b.sentence]),
  ...data.cogs.flatMap((c): [string, string][] => (c.citeSentence ? [[`cogs/${c.id}.md cite sentence`, c.citeSentence]] : [])),
  ...(["ask.sentence", "held.sentence", "settled.line", "down.sentence", "paraphrase.question"] as const).map((s): [string, string] => [`copy.md "${s}"`, data.copy[s]]),
  ...LIMITS.map((l): [string, string] => [`copy.md "limits.${l}"`, data.copy[`limits.${l}`]]),
]) {
  if (!/[.?!]$/.test(sentence)) fail(`${where}: does not end in a period or question mark ("…${sentence.slice(-30)}")`);
}
// The parts of a cog the model builds its clause from carry no advice or motive either.
for (const c of data.cogs) {
  for (const [part, body] of [["Acting on", c.actingOn], ["Definition", c.definition], ["Fallback meaning", c.fallbackMeaning]]) {
    for (const word of NOT_IN_A_READING) if (hasWord(body, word)) fail(`cogs/${c.id}.md ${part}: contains "${word}"`);
    if (COG_NUMBER.test(body)) fail(`cogs/${c.id}.md ${part}: names a cog by number`);
  }
}

// 3. No band language beyond the three labels: not in the cog files, not in either prompt.
const BAND = /(?<![0-9A-Za-z])(K[-–]2|3[-–]5|6[-–]8)(?![0-9A-Za-z])|grade band/i;
for (const f of files("data/cogs", () => true)) {
  if (BAND.test(text(f)) || /^## Grade bands/im.test(text(f))) fail(`${f}: band language`);
}
for (const [name, prompt] of [["threshold", thresholdSystem(data)], ["read", readSystem(data)]]) {
  if (BAND.test(prompt)) fail(`the ${name} prompt mentions a band`);
  // Prompt caching needs a prefix of about 512 tokens; four characters is roughly one.
  if (prompt.length / 4 < 512) fail(`the ${name} prompt is too short to be cached (${Math.round(prompt.length / 4)} tokens)`);
}
if (BAND.test(text("lib/model.ts"))) fail("lib/model.ts mentions a band");

// 4. The app writes to the collector and has no way to read it.
const BLOB_IMPORT = /import\s*\{([^}]*)\}\s*from\s*["']@vercel\/blob["']/g;
for (const f of [...code, ...files("scripts", isCode), ...files("tools", isCode), "proxy.ts"]) {
  if (f === path.join("tools", "collector-export.ts")) continue; // the one read, outside the app
  for (const match of text(f).matchAll(BLOB_IMPORT)) {
    const names = match[1].split(",").map((n) => n.replace(/\btype\b/, "").trim()).filter(Boolean);
    const extra = names.filter((n) => !["put", "BlobError"].includes(n));
    if (extra.length) fail(`${f}: imports ${extra.join(", ")} from @vercel/blob (only put is allowed in the app)`);
  }
  if (/import\s*\*\s*as\s+\w+\s*from\s*["']@vercel\/blob["']/.test(text(f))) fail(`${f}: imports all of @vercel/blob`);
}
for (const f of files("app", (x) => /route\.ts$/.test(x))) {
  if (f !== path.join("app", "api", "turn", "route.ts") && /collector/i.test(text(f))) fail(`${f}: only the turn route may touch the collector`);
}
for (const f of [...files("app", isCode), ...files("lib", isCode)]) {
  if (/readFile|createReadStream/.test(text(f)) && /collector/i.test(f)) fail(`${f}: reads a file in the collector module`);
}

// 5. Nothing she writes goes to the log: every console call logs fixed labels only.
const HER_WORDS = /\b(account|statement|words|note|text|meaning|newText|thread|turns|typing|record|req|body|parsed)\b/;
for (const f of [...files("lib", isCode), ...files(path.join("app", "api"), isCode)]) {
  for (const match of text(f).matchAll(/console\.\w+\(([^;]*)\);/g)) {
    // Look only at the code inside the call: drop plain strings, keep what ${...} interpolates.
    const args = match[1]
      .replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""')
      .replace(/`(?:[^`\\]|\\.)*`/g, (t) => [...t.matchAll(/\$\{([^}]*)\}/g)].map((m) => m[1]).join(" "));
    if (HER_WORDS.test(args)) fail(`${f}: a console call may be logging her words: ${match[0].slice(0, 80)}`);
  }
}

// 6. Every slot is used somewhere, and limits name their slots.
const source = code.map(text).join("\n");
for (const slot of SLOTS) {
  const used = source.includes(`"${slot}"`) || (slot.startsWith("limits.") && (LIMITS as readonly string[]).includes(slot.slice(7)));
  if (!used) fail(`copy.md "${slot}" is not used by the app`);
}
for (const name of LIMITS) if (!(`limits.${name}` in data.copy)) fail(`copy.md has no "limits.${name}"`);

// 7. The only caps are the named ones in lib/limits.ts: no bare number caps a length anywhere.
for (const f of code) {
  if (f === path.join("lib", "limits.ts")) continue;
  if (/maxLength=\{\s*\d|\.max\(\s*\d|\.length\s*[<>]=?\s*\d{2,}/.test(text(f))) fail(`${f}: a length is capped by a bare number; use lib/limits.ts`);
}

// 8. No teacher-facing sentence is written in the page itself: text between tags is {t("slot")}.
for (const f of files("app", (x) => x.endsWith(".tsx"))) {
  for (const match of text(f).matchAll(/>([^<>{}]*[A-Za-z]{3,}[^<>{}]*)</g)) {
    const words = match[1].trim();
    if (/^[\w\s.,'’!?()-]+$/.test(words) && /\s/.test(words)) fail(`${f}: text written in the page: "${words}"`);
  }
}

// 9. A failure never reaches her as the framework's own error page, and a data file that
//    does not load never reaches the live site: the build runs these checks first.
for (const f of ["app/error.tsx", "app/global-error.tsx"]) {
  if (!fs.existsSync(path.join(root, f))) fail(`${f} is missing: a page that cannot load would show the framework's error screen`);
}
const down = downCopy();
if (down.sentence !== data.copy["down.sentence"] || down.retry !== data.copy["limits.retry"]) fail("lib/down.ts does not read the error page's copy the way lib/data.ts does");
const build = (JSON.parse(text("package.json")) as { scripts: Record<string, string> }).scripts.build;
if (!/npm run check\s*&&\s*next build/.test(build)) fail('package.json: "build" must run "npm run check" before "next build"');

// 10. Private notes stay private. If a .private-terms file is present (it is never committed),
//    each line is a pattern that must not appear anywhere in the repo.
const termsFile = path.join(root, ".private-terms");
let privateChecked = false;
if (fs.existsSync(termsFile)) {
  privateChecked = true;
  const terms = fs.readFileSync(termsFile, "utf8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  for (const f of everything) {
    for (const term of terms) {
      if (new RegExp(term, "i").test(text(f))) fail(`${f}: contains a private term (pattern ${terms.indexOf(term) + 1} in .private-terms)`);
    }
  }
}

// What is still a placeholder, so the banner's reason is always one command away.
const drafts = draftItems(data);

for (const p of problems) console.log(`  ✗ ${p}`);
for (const n of notes) console.log(`  note: ${n}`);
console.log(
  `data checks: ${problems.length} problems. ${data.cogs.length} cogs, ${data.beyond.length} places beyond, ${SLOTS.length} slots, ${Object.keys(data.rules).length} rule sections. ` +
    `Banner ${isDraft(data) ? "showing" : "off"} (${drafts.length} DRAFT items). ` +
    `Private-term scan ${privateChecked ? "ran" : "skipped (no .private-terms file)"}. ` +
    `Others needed for ${condition.name}: "${condition.condition.othersNeeded}".`,
);
if (process.argv.includes("--drafts")) for (const d of drafts) console.log(`  DRAFT ${d}`);
if (problems.length) process.exit(1);
