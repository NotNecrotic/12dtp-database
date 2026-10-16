import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const node = process.execPath;
const services = [
  {
    name: "backend",
    cwd: join(root, "backend"),
    args: [
      join(root, "backend", "node_modules", "tsx", "dist", "cli.mjs"),
      "src/main.ts",
    ],
  },
  {
    name: "frontend",
    cwd: join(root, "frontend"),
    args: [join(root, "frontend", "node_modules", "vite", "bin", "vite.js")],
  },
];
const children = [];
let stopping = false;

function stopAll(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.exitCode === null) child.kill("SIGTERM");
  }
  process.exitCode = exitCode;
}

for (const service of services) {
  const child = spawn(node, service.args, {
    cwd: service.cwd,
    stdio: "inherit",
  });
  children.push(child);
  child.on("error", (error) => {
    console.error(`Could not start ${service.name}:`, error);
    stopAll(1);
  });
  child.on("exit", (code) => {
    if (!stopping) {
      console.error(
        `${service.name} stopped${code === null ? "" : ` (${code})`}.`,
      );
      stopAll(code ?? 1);
    }
  });
}

process.on("SIGINT", () => stopAll());
process.on("SIGTERM", () => stopAll());
