import type { NextConfig } from "next";
import { downCopy } from "./lib/down";

const down = downCopy();

const nextConfig: NextConfig = {
  // The data files are read from disk at request time, so ship them with the server bundle.
  outputFileTracingIncludes: {
    "/": ["./data/**/*"],
    "/api/turn": ["./data/**/*"],
  },
  // The error pages cannot read data/ when they are needed, so their two pieces of copy are
  // read here, once, and built in.
  env: {
    DOWN_SENTENCE: down.sentence,
    DOWN_RETRY: down.retry,
  },
};

export default nextConfig;
