#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";

const port = process.env.PORT;

if (!port) {
  console.error("[start] PORT env var is not set. Railway should provide it. Aborting.");
  process.exit(1);
}

const requiredFiles = ["dist/index.html", "dist/serve.json"];
for (const file of requiredFiles) {
  if (!existsSync(file)) {
    console.error(`[start] Missing ${file}. Run npm run build before npm start.`);
    process.exit(1);
  }
}

if (!existsSync("dist/assets") || !statSync("dist/assets").isDirectory()) {
  console.error("[start] Missing dist/assets. Vite build did not produce browser assets.");
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
