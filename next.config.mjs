import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Parent-directory package-lock.json (e.g. in $HOME) makes Turbopack
  // infer the wrong workspace root and fail page collection. Pin to this app.
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
