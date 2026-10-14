#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const applicationPath = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const result = spawnSync("bun", [applicationPath, ...process.argv.slice(2)], {
  stdio: "inherit",
});

if (result.error !== undefined) {
  if (result.error.code === "ENOENT") {
    console.error("Oden requires Bun 1.1 or later. Install Bun from https://bun.sh, then run `oden` again.");
  } else {
    console.error(`Could not start Oden with Bun: ${result.error.message}`);
  }
  process.exitCode = 1;
} else {
  process.exitCode = result.status ?? 1;
}
