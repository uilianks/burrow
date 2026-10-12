import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Folio ships as a desktop app: the build is plain files in out/, loaded by desktop/main.cjs.
  output: "export",
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
