import { cp, mkdir, readdir, rm, stat } from "node:fs/promises";
import { resolve, join } from "node:path";

const base = resolve("."),
  out = join(base, "dist");
const excluded = new Set([
  "node_modules",
  "dist",
  "api",
  "server",
  "scripts",
  "tests",
  "docs",
  "package.json",
  "package-lock.json",
  "vercel.json",
  "README.md",
  "AGENTS.md",
]);
await rm(out, { recursive: true, force: true });
await mkdir(out);
for (const name of await readdir(base)) {
  if (name.startsWith(".") || excluded.has(name) || /\.(zip|log)$/.test(name))
    continue;
  await cp(join(base, name), join(out, name), {
    recursive: true,
    filter: (source) => !source.split("/").some((p) => p.startsWith(".")),
  });
}
await stat(join(out, "index.html"));
await stat(join(out, "intake/index.html"));
console.log(
  "Static site and intake built. Server code and private configuration excluded.",
);
