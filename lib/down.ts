import fs from "node:fs";
import path from "node:path";
import { oneLine, parseSections } from "./sections";

// The one sentence shown when the page itself cannot run, and the label on its button. They
// are read straight out of data/copy.md without the usual checks, because they have to be
// there on exactly the day something else in the data files is wrong. next.config.ts reads
// them once, when the site is built or started, and bakes them into the error pages.
export function downCopy(): { sentence: string; retry: string } {
  try {
    const text = fs.readFileSync(path.join(process.cwd(), "data", "copy.md"), "utf8");
    const sections = parseSections(text, "data/copy.md", { keys: ["status"] });
    const body = (slot: string) => oneLine(sections.find((s) => s.id === slot)?.body ?? "");
    return { sentence: body("down.sentence"), retry: body("limits.retry") };
  } catch {
    return { sentence: "", retry: "" };
  }
}
