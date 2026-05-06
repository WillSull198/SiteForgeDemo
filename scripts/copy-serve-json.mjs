import { copyFileSync, existsSync, mkdirSync } from "node:fs";

if (existsSync("serve.json")) {
  mkdirSync("dist", { recursive: true });
  copyFileSync("serve.json", "dist/serve.json");
  console.log("[postbuild] copied serve.json into dist/");
}
