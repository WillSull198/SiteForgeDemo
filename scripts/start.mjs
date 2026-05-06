#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const port = process.env.PORT;

if (!port) {
  console.error("[start] PORT env var is not set. Railway should provide it. Aborting.");
  process.exit(1);
}

console.log(`[start] Starting serve on 0.0.0.0:${port}`);

const result = spawnSync(
  "serve",
  ["-s", "dist", "-l", `tcp://0.0.0.0:${port}`],
  { stdio: "inherit" },
);

if (result.error) {
  console.error(`[start] Failed to launch serve: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
