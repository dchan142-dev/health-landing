import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { createApplication } from "../server/app.mjs";
import { createReelsAdmin } from "../server/reels-admin.mjs";

const origin = "http://localhost:3010";
const id = "11111111-1111-4111-8111-111111111111";
const triageId = "22222222-2222-4222-8222-222222222222";
const exportKey = "integration-only-admin-bearer-key";
const submission = {
  submission_id: id,
  submitted_at: "2026-11-18T00:00:00.000Z",
  event_type: "booking_intent",
  user: {
    name: "=測試客人陳小姐",
    phone: "51234567",
    email: "visitor@example.test",
    ageRange: "55-64",
    gender: "女",
    heightCm: 160,
    weightKg: 58,
    marketingConsent: false,
  },
  axis_entry: "metabolic",
  day_entry: "17",
  bmi: { bmi: 22.7, status: "正常", color: "green", risk: "維持均衡生活。" },
  top_axis: "metabolic",
  ratios: { metabolic: 54, mito: 20, gut: 15, dual: 11 },
  answers: {
    q1: "肚腩明顯",
    q2: ["脂肪肝", "血脂超標"],
    q3: ["瞓足八個鐘起身依然無電"],
    q4: ["以上皆無"],
    q5: ["薄血藥／抗凝血藥"],
    q6: ["以上全部沒有"],
    q7: "想幫屋企人一齊梳理情況",
  },
  booking: { store: "灣仔", date: "2026-11-21", weekday: "星期六", timeSlot: "11am-1pm" },
};
const triage = {
  submission_id: triageId,
  submitted_at: "2026-11-18T05:00:00.000Z",
  event_type: "triage_aborted_level1",
  user: null,
  axis_entry: "dual",
  day_entry: "05",
  bmi: null,
  top_axis: null,
  ratios: null,
  answers: { q6: ["胸痛心翳氣促"] },
  booking: null,
};

let db, app, admin, adminCookie, visitorCookie;

before(async () => {
  db = new PGlite();
  const query = async (statement, parameters) => {
    const result = await db.query(
      typeof statement === "string" ? statement : statement.text,
      parameters || statement.values,
    );
    return { ...result, rowCount: result.affectedRows ?? result.rows.length };
  };
  app = createApplication({
    pool: { query, connect: async () => ({ query, release() {} }) },
    origin,
    secret: "separate-reels-admin-integration-test-32chars",
    production: false,
  });
  await app.initialize();
  await app.bootstrapAdmin({
    name: "測試管理員",
    email: "admin@example.test",
    password: "Admin-test-password-123!",
  });
  const signUp = await app.fetch(new Request(origin + "/api/health-intake/auth/sign-up/email", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({
      name: "測試客人", email: "visitor@example.test", password: "Visitor-test-password-123!",
      consent: true,
    }),
  }));
  assert.equal(signUp.status, 200, await signUp.clone().text());
  adminCookie = await login("admin@example.test", "Admin-test-password-123!");
  visitorCookie = await login("visitor@example.test", "Visitor-test-password-123!");

  admin = createReelsAdmin({
    origin,
    exportKey,
    getSession: (headers) => app.auth.api.getSession({ headers }),
    getStore: () => ({
      list: async () => [submission, triage],
      find: async (key) => [submission, triage].find((record) => record.submission_id === key),
    }),
  });
});
after(async () => db?.close());

async function login(email, password) {
  const response = await app.fetch(new Request(origin + "/api/health-intake/auth/sign-in/email", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  }));
  assert.equal(response.status, 200, await response.clone().text());
  return response.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
}

function adminRequest(handler, path, headers = {}, method = "GET") {
  return admin[handler](new Request(origin + path, { headers, method }));
}

test("only an intake administrator or an explicit server bearer can download records", async () => {
  const anonymous = await adminRequest("exportCsv", "/api/export");
  assert.equal(anonymous.status, 401);
  assert.match(anonymous.headers.get("cache-control"), /no-store/);
  assert.equal((await adminRequest("exportCsv", "/api/export", { cookie: visitorCookie })).status, 403);
  assert.equal((await adminRequest("exportCsv", "/api/export?key=" + exportKey)).status, 401);
  assert.equal((await adminRequest("exportCsv", "/api/export", { authorization: "Bearer wrong" })).status, 401);
  assert.equal((await adminRequest("exportCsv", "/api/export", { authorization: "Bearer " + exportKey })).status, 200);
  assert.equal((await adminRequest("exportCsv", "/api/export", { cookie: adminCookie })).status, 200);
  assert.equal((await adminRequest("exportCsv", "/api/export", { cookie: adminCookie }, "POST")).status, 405);
  assert.equal((await adminRequest("reportPdf", "/api/report-pdf?id=" + id)).status, 401);
});

test("CSV is Excel-compatible and gives report links only for completed analyses", async () => {
  const response = await adminRequest("exportCsv", "/api/export", { cookie: adminCookie });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-disposition"), /attachment; filename="health-decoder-reels.*\.csv"/);
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.equal(bytes.subarray(0, 3).toString("hex"), "efbbbf");
  const csv = bytes.toString("utf8");
  assert.match(csv, /"第1題".*"第7題"/);
  assert.match(csv, /"'\=測試客人陳小姐","51234567","visitor@example\.test"/);
  assert.match(csv, /"脂肪肝；血脂超標"/);
  assert.match(csv, /"17","metabolic"/);
  assert.match(csv, /"灣仔","2026-11-21","星期六","11am-1pm"/);
  assert.ok(csv.includes(origin + "/api/report-pdf?id=" + id));
  assert.ok(!csv.includes(origin + "/api/report-pdf?id=" + triageId));
  assert.ok(!csv.includes(exportKey));
});

test("secure PDF output is A4 with embedded selectable text and private report data", async () => {
  const response = await adminRequest("reportPdf", "/api/report-pdf?id=" + id, { cookie: adminCookie });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/pdf");
  assert.match(response.headers.get("cache-control"), /private, no-store/);
  const pdf = Buffer.from(await response.arrayBuffer()).toString("latin1");
  assert.match(pdf, /^%PDF-/);
  assert.match(pdf, /\/MediaBox \[0 0 595\.28 841\.89\]/);
  assert.match(pdf, /\/ToUnicode /);
  assert.match(pdf, /\/FontFile[23] /);
  assert.equal((await adminRequest("reportPdf", "/api/report-pdf?id=" + triageId, { cookie: adminCookie })).status, 404);
  assert.equal((await adminRequest("reportPdf", "/api/report-pdf?id=invalid", { cookie: adminCookie })).status, 400);
});

test("dashboard list exposes a download URL and omits health answers from its summary", async () => {
  const response = await adminRequest("exportCsv", "/api/export?format=json", { cookie: adminCookie });
  assert.equal(response.status, 200);
  const { records } = await response.json();
  assert.equal(records[0].submission_id, id);
  assert.equal(records[0].report_url, origin + "/api/report-pdf?id=" + id);
  assert.equal(records[1].report_url, null);
  assert.equal(records[0].answers, undefined);
  assert.equal(records[0].ratios, undefined);
  assert.equal(records[0].user, undefined);
});

test("admin dashboard offers sign-in when signed out and one-click downloads for reports", async () => {
  const [{ readFile }, { JSDOM }] = await Promise.all([import("node:fs/promises"), import("jsdom")]);
  const folder = new URL("../reels-quiz/admin/", import.meta.url);
  const [markup, script] = await Promise.all([
    readFile(new URL("index.html", folder), "utf8"),
    readFile(new URL("app.mjs", folder), "utf8"),
  ]);
  const dom = new JSDOM(markup, { url: origin + "/reels-quiz/admin/", runScripts: "outside-only" });
  try {
    const { document } = dom.window;
    let signedIn = false;
    dom.window.fetch = async () => signedIn
      ? new Response(JSON.stringify({ records: [
          { submission_id: id, submitted_at: submission.submitted_at, event_type: submission.event_type,
            name: "陳小姐<script>", booking: submission.booking, report_url: origin + "/api/report-pdf?id=" + id },
          { submission_id: triageId, submitted_at: triage.submitted_at, event_type: triage.event_type,
            name: null, booking: null, report_url: null },
        ] }))
      : new Response(null, { status: 401 });
    dom.window.eval(script);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(document.querySelector("#sign-in").hidden, false);
    assert.equal(document.querySelector("#sign-in a").getAttribute("href"), "/intake/");
    assert.equal(document.querySelector("#download-csv").hidden, true);

    signedIn = true;
    document.querySelector("#refresh").click();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(document.querySelector("#download-csv").getAttribute("href"), "/api/export");
    assert.equal(document.querySelector("#download-csv").hidden, false);
    const links = document.querySelectorAll("#records a");
    assert.equal(links.length, 1);
    assert.equal(links[0].getAttribute("href"), "/api/report-pdf?id=" + id);
    assert.match(document.querySelector("#records").textContent, /陳小姐<script>/);
    assert.equal(document.querySelector("#records script"), null);
  } finally {
    dom.window.close();
  }
});
