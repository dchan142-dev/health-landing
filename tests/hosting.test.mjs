import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { spawnSync } from "node:child_process";
import handler from "../api/health-intake.js";
import { serveApi } from "../server/bridge.mjs";

function response() {
  return {
    headers: {},
    statusCode: 200,
    setHeader(k, v) {
      this.headers[k] = v;
    },
    writeHead(status, headers) {
      this.statusCode = status;
      Object.assign(this.headers, headers);
    },
    end(body) {
      this.body = body?.toString();
    },
  };
}
test("missing production database configuration fails closed", async () => {
  const res = response();
  await handler(
    { url: "/api/health-intake/session", method: "GET", headers: {} },
    res,
  );
  assert.equal(res.statusCode, 503);
  assert.match(res.headers["cache-control"], /no-store/);
  assert.doesNotMatch(res.body, /DATABASE_URL|secret|password/);
});
test("production builds must initialize the database while local builds need no production credentials", () => {
  const script = new URL("../scripts/build-production.mjs", import.meta.url)
    .pathname;
  const local = spawnSync(process.execPath, [script], {
    encoding: "utf8",
    env: {
      ...process.env,
      VERCEL_ENV: "preview",
      DATABASE_URL: "",
      APP_ORIGIN: "",
      BETTER_AUTH_SECRET: "",
      DATA_ENCRYPTION_KEY: "",
    },
  });
  assert.equal(local.status, 0, local.stderr);
  const production = spawnSync(process.execPath, [script], {
    encoding: "utf8",
    env: {
      ...process.env,
      VERCEL_ENV: "production",
      DATABASE_URL: "",
      APP_ORIGIN: "",
      BETTER_AUTH_SECRET: "",
      DATA_ENCRYPTION_KEY: "",
    },
  });
  assert.notEqual(production.status, 0);
  assert.match(production.stderr, /Setup failed/);
});
test("Vercel rewrite preserves Better Auth paths and separate cookie headers", async () => {
  const res = response();
  let captured;
  await serveApi(
    {
      url: "/api/health-intake?route=auth%2Fsign-in%2Femail",
      method: "POST",
      headers: { "content-type": "application/json" },
      body: { email: "fiction@example.test", password: "test-password-only" },
    },
    res,
    {
      fetch: async (req) => {
        captured = req;
        const headers = new Headers();
        headers.append("set-cookie", "one=1; HttpOnly");
        headers.append("set-cookie", "two=2; HttpOnly");
        return new Response('{"ok":true}', { headers });
      },
    },
    "https://health-decoder.com",
  );
  assert.equal(
    new URL(captured.url).pathname,
    "/api/health-intake/auth/sign-in/email",
  );
  assert.equal(res.headers["set-cookie"].length, 2);
  assert.equal(res.statusCode, 200);
});
test("the static build retains the existing website and excludes backend and private files", async () => {
  execFileSync(process.execPath, ["scripts/build.mjs"]);
  for (const path of [
    "index.html",
    "shared/js/site-config.js",
    "intake/index.html",
    "intake/app.mjs",
    "intake/schema.mjs",
  ])
    assert.deepEqual(await readFile("dist/" + path), await readFile(path));
  for (const path of [
    "server/app.mjs",
    "api/health-intake.js",
    "node_modules",
    "package.json",
    ".env.example",
    "tests",
  ])
    await assert.rejects(stat("dist/" + path));
  const config = JSON.parse(await readFile("vercel.json", "utf8"));
  assert.equal(config.outputDirectory, "dist");
  assert.equal(
    config.rewrites[0].destination,
    "/api/health-intake?route=:path*",
  );
});
