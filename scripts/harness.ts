// Shared by the checks and the evaluation. Nothing in app/ or lib/ imports this.
import type { Collector, CollectorRecord } from "../lib/collector";
import type { ModelClient, ReadInput, ReadOutput, ThresholdInput, ThresholdOutput } from "../lib/model";

// One log of everything a turn did, in order, so a check can say "kept before it was read".
export type Event =
  | { what: "threshold"; input: ThresholdInput }
  | { what: "read"; input: ReadInput }
  | { what: "write"; record: CollectorRecord };

// A collector that lives in memory for one test. The app itself never has one of these.
export class MemoryCollector implements Collector {
  records: CollectorRecord[] = [];
  constructor(private events: Event[] = []) {}
  async append(record: CollectorRecord): Promise<void> {
    this.records.push(record);
    this.events.push({ what: "write", record });
  }
}

// Wraps a model so every call lands in the event log.
export function logged(model: ModelClient, events: Event[]): ModelClient {
  return {
    async threshold(input) {
      events.push({ what: "threshold", input });
      return model.threshold(input);
    },
    async read(input) {
      events.push({ what: "read", input });
      return model.read(input);
    },
  };
}

// A model that answers from a script instead of calling anything.
export function stubModel(answers: {
  threshold?: ThresholdOutput | (() => Promise<ThresholdOutput>);
  read?: ReadOutput | (() => Promise<ReadOutput>);
}): ModelClient {
  const give = async <T>(a: T | (() => Promise<T>) | undefined, name: string): Promise<T> => {
    if (a === undefined) throw new Error(`the stub model was not expected to be asked for a ${name}`);
    return typeof a === "function" ? (a as () => Promise<T>)() : a;
  };
  return {
    threshold: () => give(answers.threshold, "threshold"),
    read: () => give(answers.read, "read"),
  };
}

export const TEST_SECRET = Buffer.from("test-secret-not-used-anywhere-real");

export const count = (events: Event[], what: Event["what"]) => events.filter((e) => e.what === what).length;

// Whole-word search that treats straight and curly apostrophes alike.
export function hasWord(text: string, phrase: string): boolean {
  const norm = (s: string) => s.replace(/[’‘]/g, "'").toLowerCase();
  const escaped = norm(phrase).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`).test(norm(text));
}

// Things a teacher must never be shown.
// Wording that turns a limit of the system into her mistake, or into "we can't help".
export const NOT_HER_ERROR = ["can't help", "cannot help", "sorry", "unable", "invalid", "error", "rephrase", "not allowed", "off-topic"];
// A model turning her down.
export const NO_REFUSAL = /declin|refus/i;
// Motive, verdicts on her, advice, and claims about children of an age.
export const NOT_IN_A_READING = [
  "because he wants",
  "is trying to",
  "to get attention",
  "to avoid work",
  "doesn't care",
  "you're frustrated",
  "you're struggling",
  "you've been",
  "try to",
  "you could",
  "consider",
  "strategy",
  "strategies",
  "tip",
  "tips",
  "next step",
  "at this age",
  "typically",
  "kindergartners",
  "year olds",
  "diagnosis",
  "diagnose",
  "the problem is",
];
// Ways of mislabelling the cog that is Kim's own.
export const NOT_SAID_OF_5K = ["invented", "made up", "unofficial", "not a real", "Missouri's 5.K", "Quality Indicator 5.K"];
// A cog number where only a name belongs.
export const COG_NUMBER = /(?<![0-9.])5\.[123K](?![0-9A-Za-z])/;
