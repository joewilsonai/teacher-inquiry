import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { BlobError, put } from "@vercel/blob";

// The collector: an append-only store of what the system could not place. The app writes
// to it and has no way to read it back. A record is exactly two things.
export type CollectorRecord = {
  statement: string; // what she wrote, verbatim
  fellThrough: string; // where it fell through: "threshold", "no cog", or "<cog id>, she said no"
};

export interface Collector {
  append(record: CollectorRecord, signal?: AbortSignal): Promise<void>;
}

// A record is stored under a name made from its own two fields and nothing else, so the
// system adds no third fact about her, and writing the same record twice is one record.
export function recordName(record: CollectorRecord): string {
  return createHash("sha256").update(`${record.statement}\u0000${record.fellThrough}`).digest("hex");
}

const line = (record: CollectorRecord) =>
  JSON.stringify({ statement: record.statement, fellThrough: record.fellThrough });

// Local development: one JSON line per record in a file that git ignores.
export class FileCollector implements Collector {
  constructor(private file = process.env.COLLECTOR_FILE ?? path.join(process.cwd(), ".collector", "records.jsonl")) {}

  async append(record: CollectorRecord): Promise<void> {
    await fs.promises.mkdir(path.dirname(this.file), { recursive: true });
    await fs.promises.appendFile(this.file, `${line(record)}\n`, "utf8");
  }
}

// Deployed: one private object per record in a Vercel Blob store.
export class BlobCollector implements Collector {
  // "write" is the store's put; it is a parameter only so the checks can stand in for it.
  constructor(
    private prefix: string,
    private write: typeof put = put,
  ) {}

  async append(record: CollectorRecord, signal?: AbortSignal): Promise<void> {
    try {
      await this.write(`${this.prefix}${recordName(record)}.json`, line(record), {
        access: "private",
        addRandomSuffix: false,
        allowOverwrite: false,
        contentType: "application/json",
        abortSignal: signal,
      });
    } catch (e) {
      // The same record is already there (a retried turn). It is held; that is a success.
      if (e instanceof BlobError && /already exists/i.test(e.message)) return;
      throw e;
    }
  }
}

// Writes nothing. Only when COLLECTOR=none is set on purpose (CI, or a preview that has no
// store yet). The turn logs "collector_off record_not_kept" each time a record would have
// been written, and the page never says her words are held.
export class NoCollector implements Collector {
  async append(): Promise<void> {
    throw new Error("collector is off");
  }
}

export type CollectorKind = "file" | "blob" | "none";

// COLLECTOR=file|blob|none decides when set. Otherwise the deployed site and its previews
// write to the blob store (previews under their own prefix) and everything else to the file.
export function collectorKind(env: NodeJS.ProcessEnv = process.env): CollectorKind {
  const chosen = env.COLLECTOR;
  if (chosen === "file" || chosen === "blob" || chosen === "none") return chosen;
  return env.VERCEL_ENV === "production" || env.VERCEL_ENV === "preview" ? "blob" : "file";
}

export function collectorFromEnv(env: NodeJS.ProcessEnv = process.env): Collector {
  const kind = collectorKind(env);
  if (kind === "none") return new NoCollector();
  if (kind === "file") return new FileCollector();
  return new BlobCollector(env.COLLECTOR_PREFIX ?? (env.VERCEL_ENV === "preview" ? "preview/" : "collector/"));
}
