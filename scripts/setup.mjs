import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const backendEnv = join(root, "backend", ".env");
const envExample = join(root, "backend", ".env.example");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

if (!existsSync(backendEnv)) {
  copyFileSync(envExample, backendEnv);
  console.log("Created backend/.env from backend/.env.example.");
}

for (const folder of ["backend", "frontend"]) {
  console.log(`Installing ${folder} dependencies...`);
  const result = spawnSync(npm, ["install"], {
    cwd: join(root, folder),
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log("Setup complete. Add your Plex URL and token to backend/.env.");
