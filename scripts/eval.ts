// Sends every held-out situation in data/tests.md through the same top-level sort a teacher
// gets, and scores it against the expected box. Run: npm run eval  (spends real API money).
import fs from "node:fs";
import path from "node:path";
import { BANDS, type Band, loadBoxes } from "../lib/boxes";
import { inquire } from "../lib/inquire";

type Case = { band: Band; expected: string; situation: string };

const cases: Case[] = fs
  .readFileSync(path.join(process.cwd(), "data", "tests.md"), "utf8")
  .split("\n")
  .flatMap((line) => {
    const m = line.match(/^- \[(.+?)\] \[(.+?)\] (.+)$/);
    if (!m || !BANDS.includes(m[1] as Band)) return [];
    return [{ band: m[1] as Band, expected: m[2], situation: m[3].trim() }];
  });

const boxes = loadBoxes();
const started = Date.now();

const results = await Promise.all(
  cases.map(async (c) => {
    try {
      const r = await inquire({ band: c.band, situation: c.situation, turns: [] }, boxes);
      const got = r.kind === "suggest" ? r.boxId : r.kind === "none" ? "none" : r.kind;
      return { ...c, got, evidence: "evidence" in r ? r.evidence : "" };
    } catch (e) {
      return { ...c, got: `ERROR: ${(e as Error).message}`, evidence: "" };
    }
  }),
);

let hits = 0;
for (const r of results) {
  const ok = r.got === r.expected;
  if (ok) hits++;
  console.log(`${ok ? "✓" : "✗"} [${r.band}] expected ${r.expected}, got ${r.got}  ${r.situation}`);
  if (!ok && r.evidence) console.log(`    why: ${r.evidence}`);
}
console.log(`\n${hits}/${results.length} correct (${Math.round((100 * hits) / results.length)}%) in ${((Date.now() - started) / 1000).toFixed(1)}s`);
