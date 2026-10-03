// The one place the collector is read, and it is not part of the app. The site only ever
// writes; this is run by hand, by the person who holds the store's credential, to hand Kim
// what the collector has gathered as a single CSV.
//
//   BLOB_READ_WRITE_TOKEN=... npx tsx tools/collector-export.ts > collector.csv
//
// COLLECTOR_PREFIX picks the folder: "collector/" (the live site, the default) or "preview/".
import { get, list } from "@vercel/blob";

const prefix = process.env.COLLECTOR_PREFIX ?? "collector/";
// Spreadsheet software runs a cell that starts with =, +, - or @ as a formula. A leading
// apostrophe makes it plain text there. Only this export changes; the stored record does not.
const plain = (value: string) => (/^[=+\-@\t\r]/.test(value) ? `'${value}` : value);
const cell = (value: string) => `"${plain(value).replaceAll('"', '""')}"`;

const rows: string[] = [["statement", "fell_through", "uploaded_at"].join(",")];
let cursor: string | undefined;
do {
  const page = await list({ prefix, cursor, limit: 500 });
  for (const item of page.blobs) {
    const found = await get(item.pathname, { access: "private", useCache: false });
    if (!found || found.statusCode !== 200) continue;
    const record = JSON.parse(await new Response(found.stream).text()) as { statement: string; fellThrough: string };
    // The time is the store's own note of when the object arrived. It is not in the record.
    rows.push([cell(record.statement), cell(record.fellThrough), cell(item.uploadedAt.toISOString())].join(","));
  }
  cursor = page.hasMore ? page.cursor : undefined;
} while (cursor);

process.stdout.write(`${rows.join("\n")}\n`);
console.error(`${rows.length - 1} records from ${prefix}`);
