import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    '/api/export-docx': ['./assets/fonts/*.ttf', './assets/fonts/OFL.txt'],
  },
};

export default nextConfig;
