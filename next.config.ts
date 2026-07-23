import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The Claude Agent SDK spawns the local `claude` CLI as a child process.
  // It must NOT be bundled/traced by Next, or the spawn breaks (ENOENT) inside
  // route handlers. Keep it external so it runs from node_modules at runtime.
  serverExternalPackages: [
    "@anthropic-ai/claude-agent-sdk",
    // Native + import.meta-based packages that must not be bundled/traced.
    "@prisma/client",
    "@prisma/adapter-better-sqlite3",
    "better-sqlite3",
  ],
};

export default nextConfig;
