import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The baseline skills are read from disk at request time; ship them with every server route.
  outputFileTracingIncludes: {
    "/api/**": ["./skills/baseline/**/*"],
  },
};

export default nextConfig;
