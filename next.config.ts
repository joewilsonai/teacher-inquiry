import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The box files are read from disk at request time, so ship them with the server bundle.
  outputFileTracingIncludes: {
    "/": ["./data/**/*"],
    "/api/inquire": ["./data/**/*"],
  },
};

export default nextConfig;
