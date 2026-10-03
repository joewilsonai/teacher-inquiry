// Checks of the data files and the code that need no model and cost nothing.
// Run: npm run check
import fs from "node:fs";
import path from "node:path";
import { drafts as draftItems, isDraft, loadData } from "../lib/data";
import { downCopy } from "../lib/down";
import { LIMITS } from "../lib/limits";
import { readSystem, thresholdSystem } from "../lib/model";
import { SLOTS } from "../lib/slots";
import { COG_NUMBER, hasWord, NOT_HER_ERROR, NOT_IN_A_READING } from "./harness";

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
console.log(
  `data checks: ${problems.length} problems. ${data.cogs.length} cogs, ${data.beyond.length} places beyond, ${SLOTS.length} slots, ${Object.keys(data.rules).length} rule sections. ` +
    `Banner ${isDraft(data) ? "showing" : "off"} (${drafts.length} DRAFT items). ` +
    `Private-term scan ${privateChecked ? "ran" : "skipped (no .private-terms file)"}.`,
);
if (process.argv.includes("--drafts")) for (const d of drafts) console.log(`  DRAFT ${d}`);
if (problems.length) process.exit(1);
