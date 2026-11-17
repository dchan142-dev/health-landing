import { createServer } from "node:http";
import { readFile, stat, mkdir } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { createApplication } from "./app.mjs";
import { serveApi } from "./bridge.mjs";

// Local development only. Production always uses PostgreSQL via runtime.mjs.
if (process.env.NODE_ENV === "production")
  throw new Error("Do not use the local development server in production");
const port = Number(process.env.PORT || 3010),
  origin = "http://localhost:" + port,
  base = resolve(".");
await mkdir(".local-data", { recursive: true });
const db = new PGlite(".local-data");
const query = async (text, params) => {
  const result = await db.query(
    typeof text === "string" ? text : text.text,
    params || text.values,
  );
  return { ...result, rowCount: result.affectedRows ?? result.rows.length };
};
const app = createApplication({
  pool: { query, connect: async () => ({ query, release() {} }) },
  origin,
  secret:
    process.env.BETTER_AUTH_SECRET ||
    "development-only-not-for-hosting-32-characters",
  production: false,
});
await app.initialize();
if (process.env.HD_ADMIN_EMAIL && process.env.HD_ADMIN_PASSWORD) {
  const admins = await query('SELECT id FROM "user" WHERE role=$1', ["admin"]);
  if (!admins.rows.length)
    await app.bootstrapAdmin({
      name: process.env.HD_ADMIN_NAME || "本機測試管理員",
      email: process.env.HD_ADMIN_EMAIL,
      password: process.env.HD_ADMIN_PASSWORD,
    });
}
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
};
createServer(async (req, res) => {
  const path = new URL(req.url, origin).pathname;
  if (path.startsWith("/api/health-intake"))
    return serveApi(req, res, app, origin);
  try {
    let file = resolve(base, "." + decodeURIComponent(path));
    if (!file.startsWith(base + sep) && file !== base) throw new Error();
    const rel = file.slice(base.length + 1);
    if (
      rel.split(sep).some((p) => p.startsWith(".")) ||
      /^(server|scripts|tests|node_modules|api|docs)(\/|$)/.test(rel) ||
      /package(-lock)?\.json$/.test(rel)
    )
      throw new Error();
    if ((await stat(file)).isDirectory()) file = resolve(file, "index.html");
    res.writeHead(200, {
      "content-type": types[extname(file)] || "application/octet-stream",
      "cache-control": "no-store",
    });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}).listen(port, "127.0.0.1", () =>
  console.log("Local development server: " + origin + "/intake/"),
);
