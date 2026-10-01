import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";

export const BANDS = ["K-2", "3-5", "6-8"] as const;
export type Band = (typeof BANDS)[number];

export type Box = {
  id: string;
  name: string;
  parent: string; // "root" for the top level
  order: number;
  status: string;
  definition: string;
  indicators: string;
  bands: Partial<Record<Band, string>>;
  examples: string;
  nearMisses: string;
};

// What the browser needs: enough to render names, the trail, and the "pick one yourself" list.
export type BoxSummary = Pick<Box, "id" | "name" | "parent" | "order" | "definition">;

const BOX_DIR = path.join(process.cwd(), "data", "boxes");

// One markdown file per box. Front matter carries id/name/parent/order; the body is split on
// "## " headings, and "## Grade bands" is split again on "### <band>".
function parseBox(file: string): Box {
  const { data, content } = matter(fs.readFileSync(path.join(BOX_DIR, file), "utf8"));
  const sections: Record<string, string> = {};
  for (const chunk of content.split(/^## /m).slice(1)) {
    const [heading, ...rest] = chunk.split("\n");
    sections[heading.trim().toLowerCase()] = rest.join("\n").trim();
  }
  const bands: Partial<Record<Band, string>> = {};
  for (const chunk of (sections["grade bands"] ?? "").split(/^### /m).slice(1)) {
    const [heading, ...rest] = chunk.split("\n");
    const band = heading.trim() as Band;
    if (BANDS.includes(band)) bands[band] = rest.join("\n").trim();
  }
  return {
    id: String(data.id),
    name: String(data.name),
    parent: String(data.parent ?? "root"),
    order: Number(data.order ?? 0),
    status: String(data.status ?? ""),
    definition: sections["definition"] ?? "",
    indicators: sections["indicators"] ?? "",
    bands,
    examples: sections["examples"] ?? "",
    nearMisses: sections["near-misses"] ?? "",
  };
}

export function loadBoxes(): Box[] {
  return fs
    .readdirSync(BOX_DIR)
    .filter((f) => f.endsWith(".md"))
    .map(parseBox)
    .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
}

export function childrenOf(boxes: Box[], parentId: string): Box[] {
  return boxes.filter((b) => b.parent === parentId).sort((a, b) => a.order - b.order);
}

export function summarize(boxes: Box[]): BoxSummary[] {
  return boxes.map(({ id, name, parent, order, definition }) => ({ id, name, parent, order, definition }));
}

export function isDraft(boxes: Box[]): boolean {
  return boxes.some((b) => /draft/i.test(b.status));
}
