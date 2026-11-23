import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile,
} from "node:fs/promises";
import { execFileSync, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
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
test("the static build retains the website and both Reels versions while excluding backend and private files", async (t) => {
  execFileSync(process.execPath, ["scripts/build.mjs"]);
  const v2Files = (await readdir("reels-quiz-v2", { recursive: true, withFileTypes: true }))
    .filter((entry) => !entry.isDirectory())
    .map((entry) => join(entry.parentPath, entry.name))
    .filter((path) => !path.split(sep).some((part) => part.startsWith(".")));
  for (const path of [
    "index.html",
    "shared/js/site-config.js",
    "intake/index.html",
    "daily/index.html",
    "intake/app.mjs",
    "intake/schema.mjs",
    "reels-quiz/index.html",
    "reels-quiz/quiz.mjs",
    "reels-quiz/quiz-data.mjs",
    "reels-quiz/quiz.css",
    "reels-quiz/admin/index.html",
    "reels-quiz/admin/app.mjs",
    "reels-quiz/admin/style.css",
    ...v2Files,
  ]) {
    const output = await readFile(join("dist", path));
    assert.ok(output.equals(await readFile(path)), `Built bytes differ for ${path}`);
  }
  for (const path of [
    "server/app.mjs",
    "server/reels-v2-admin.mjs",
    "server/reels-v2-events.mjs",
    "server/reels-v2-report-pdf.mjs",
    "server/reels-v2-store.mjs",
    "api/health-intake.js",
    "api/event-v2.js",
    "api/export-v2.js",
    "api/report-v2-pdf.js",
    "api/submit-v2.js",
    "scripts",
    "docs",
    "integrations",
    "node_modules",
    "package.json",
    "package-lock.json",
    "vercel.json",
    ".env.example",
    "tests",
    "tests/reels-quiz-v2-ui.test.mjs",
    ".superpowers",
    ".github",
  ])
    await assert.rejects(stat(join("dist", path)), { code: "ENOENT" }, path);

  for (const base of ["reels-quiz", "reels-quiz-v2"]) {
    for (const [page, style, module] of [
      ["index.html", "quiz.css", "quiz.mjs"],
      ["admin/index.html", "admin/style.css", "admin/app.mjs"],
    ]) {
      const dom = new JSDOM(await readFile(join("dist", base, page), "utf8"));
      t.after(() => dom.window.close());
      const doc = dom.window.document;
      assert.equal(doc.querySelector('link[rel="stylesheet"]').getAttribute("href"), `/${base}/${style}`);
      assert.equal(doc.querySelector('script[type="module"]').getAttribute("src"), `/${base}/${module}`);
    }
  }

  const v1 = await readFile("dist/reels-quiz/quiz.mjs", "utf8");
  assert.match(v1, /["']\/demo\/reels-quiz\/media\/["']/);
  assert.match(v1, /["']\/api\/submit["']/);
  assert.match(v1, /\bhd_reels_v3:/);
  assert.doesNotMatch(v1, /\/api\/(?:submit|event)-v2|\bhd_reels_v4:/);

  const v2 = await readFile("dist/reels-quiz-v2/quiz.mjs", "utf8");
  assert.match(v2, /["']\/demo\/reels-quiz\/media\/["']/);
  assert.match(v2, /["']\/api\/submit-v2["']/);
  assert.match(v2, /["']\/api\/event-v2["']/);
  assert.match(v2, /\bhd_reels_v4:/);
  assert.doesNotMatch(v2, /["']\/api\/submit["']|\bhd_reels_v3:/);
});

test("the static build requires every entry point to be an HTML file", async (t) => {
  const build = fileURLToPath(new URL("../scripts/build.mjs", import.meta.url));
  const pages = [
    "index.html",
    "intake/index.html",
    "daily/index.html",
    "reels-quiz/index.html",
    "reels-quiz-v2/index.html",
    "reels-quiz-v2/admin/index.html",
  ];
  const invalidEntries = pages.map((page) => ({ page, type: "missing" }));
  invalidEntries.push({ page: "reels-quiz-v2/admin/index.html", type: "directory" });
  for (const { page, type } of invalidEntries) {
    await t.test(`${page} is a ${type} entry`, async (t) => {
      const root = await mkdtemp(join(tmpdir(), "health-landing-build-"));
      t.after(() => rm(root, { recursive: true, force: true }));
      for (const entry of pages) {
        if (entry === page) continue;
        const file = join(root, entry);
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file, "<!doctype html>");
      }
      if (type === "directory") await mkdir(join(root, page), { recursive: true });

      const result = spawnSync(process.execPath, [build], { cwd: root, encoding: "utf8" });
      assert.equal(result.status, 1, `Build must reject ${page} when it is ${type}`);
      assert.match(result.stderr, type === "directory" ? /is not a file/ : /ENOENT/);
      assert.ok(result.stderr.includes(join("dist", page)), result.stderr);
    });
  }
});

test("Vercel serves the static build and keeps the intake rewrite as the only route override", async () => {
  const config = JSON.parse(await readFile("vercel.json", "utf8"));
  assert.equal(config.outputDirectory, "dist");
  assert.deepEqual(config.rewrites, [{
    source: "/api/health-intake/:path*",
    destination: "/api/health-intake?route=:path*",
  }]);
  assert.deepEqual(config.redirects ?? [], []);
  assert.deepEqual(config.routes ?? [], []);
});

test("Vercel bundles the report font for the V2 PDF function", async () => {
  const config = JSON.parse(await readFile("vercel.json", "utf8"));
  assert.deepEqual(config.functions["api/report-v2-pdf.js"], {
    includeFiles: "server/fonts/*.otf",
    maxDuration: 30,
  });
  assert.ok((await stat("server/fonts/NotoSansCJKhk-Regular.otf")).isFile());
});

test("Vercel applies the Reels security policy to both versions and their subpaths", async () => {
  const config = JSON.parse(await readFile("vercel.json", "utf8"));
  const policy = {
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; media-src 'self' blob:; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  };
  for (const path of ["/reels-quiz", "/reels-quiz-v2"]) {
    const rules = config.headers.filter(({ source }) => source === path || source.startsWith(path + "/"));
    assert.deepEqual(rules.map(({ source }) => source).sort(), [path, path + "/:path*"]);
    for (const { source, headers } of rules) {
      assert.equal(headers.length, Object.keys(policy).length, source);
      assert.deepEqual(Object.fromEntries(headers.map(({ key, value }) => [key, value])), policy, source);
    }
  }
});

test('daily entry and assets use private no-store, noindex and same-origin CSP', async () => {
  const config=JSON.parse(await readFile('vercel.json','utf8'));
  for(const source of ['/daily','/daily/','/daily/:path*']){
    const rule=config.headers.find(r=>r.source===source);
    assert.ok(rule,source);
    const headers=Object.fromEntries(rule.headers.map(h=>[h.key.toLowerCase(),h.value]));
    assert.match(headers['cache-control'],/private, no-store/);
    assert.match(headers['x-robots-tag'],/noindex/);
    assert.match(headers['content-security-policy'],/default-src 'self'/);
  }
});
