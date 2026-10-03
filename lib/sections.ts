// Reads the data files. Two shapes, both plain text a person can edit without knowing any
// file format:
//
// - "## <id>" sections (data/threshold.md, data/copy.md, data/rules.md). Right under each
//   heading come the "key: value" lines that file knows; the first line that is not one of
//   those starts the body.
// - a few "key: value" lines at the top of a file (data/cogs/*.md), before its first section.
//
// A value is everything after the first colon, exactly as written: more colons, quotation
// marks and "#" are all just text. Only the keys a file names are ever treated as keys, so a
// body line that happens to contain a colon stays body.

export type Section<K extends string = string> = { id: string; body: string } & Partial<Record<K, string>>;

type Options<K extends string> = {
  keys: readonly K[]; // the "key:" lines this file knows
  required?: readonly K[];
  // Keys whose value may be wrapped over several lines. It runs to the next blank line or
  // the next key line, so a long sentence can be broken wherever the editor breaks it.
  wraps?: readonly K[];
};

const keyOf = <K extends string>(line: string, keys: readonly K[]) => keys.find((k) => line.startsWith(`${k}:`));

export function parseSections<K extends string>(text: string, file: string, options: Options<K>): Section<K>[] {
  const { keys, required = [], wraps = [] } = options;
  const sections: Section<K>[] = [];
  const seen = new Set<string>();
  // Anything before the first "## " is a note to whoever edits the file.
  for (const chunk of text.split(/^## /m).slice(1)) {
    const lines = chunk.split("\n");
    const id = lines[0].trim();
    if (seen.has(id)) throw new Error(`${file}: section "${id}" appears twice`);
    seen.add(id);

    const values: Partial<Record<K, string>> = {};
    let open: K | undefined; // a wrapping value that the next line may continue
    let i = 1;
    for (; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim() === "") {
        open = undefined;
        continue;
      }
      const key = keyOf(line, keys);
      if (key) {
        values[key] = line.slice(key.length + 1).trim();
        open = wraps.includes(key) ? key : undefined;
      } else if (open) {
        values[open] = `${values[open]} ${line.trim()}`.trim();
      } else break;
    }

    for (const key of required) {
      if (!values[key]) throw new Error(`${file}: section "${id}" needs a "${key}:" line right under its heading`);
    }
    sections.push({ id, body: lines.slice(i).join("\n").trim(), ...values });
  }
  return sections;
}

// The "key: value" lines at the top of a file, above its first "## " section. A value may
// wrap onto the following lines. Lines of dashes are ignored, and a value wrapped whole in
// quotation marks loses them, so a file written in the older fenced style still reads.
export function parseHeader<K extends string>(text: string, keys: readonly K[]): Partial<Record<K, string>> {
  const values: Partial<Record<K, string>> = {};
  let open: K | undefined;
  for (const line of text.split(/^## /m)[0].split("\n")) {
    if (line.trim() === "" || /^-{3,}\s*$/.test(line)) {
      open = undefined;
      continue;
    }
    const key = keyOf(line, keys);
    if (key) {
      values[key] = line.slice(key.length + 1).trim();
      open = key;
    } else if (open) {
      values[open] = `${values[open]} ${line.trim()}`.trim();
    }
  }
  for (const key of keys) {
    const whole = values[key]?.match(/^(["'])([^"']*)\1$/);
    if (whole) values[key] = whole[2].trim();
  }
  return values;
}

// A sentence or clause that may be wrapped across lines in the file is one line on the page.
export const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

// Two statuses only. "final" means the words are Kim's, verbatim. Anything else must say
// DRAFT, followed by who wrote it. Any other value stops the load.
export function checkStatus(status: string, where: string): string {
  if (status === "final" || /^DRAFT\b/.test(status)) return status;
  throw new Error(`${where}: status must be "final" or start with "DRAFT" (found "${status}")`);
}

export const isFinal = (status: string) => status === "final";
