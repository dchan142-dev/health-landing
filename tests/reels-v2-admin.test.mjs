import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setImmediate as tick } from "node:timers/promises";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";
import { PGlite } from "@electric-sql/pglite";
import { JSDOM } from "jsdom";
import { createApplication } from "../server/app.mjs";
import { createReelsStore } from "../server/reels-store.mjs";
import { createReelsV2Store } from "../server/reels-v2-store.mjs";

const origin = "http://localhost:3010";
const exportKey = "integration-only-reels-v2-export-key";
const encryptionKey = Buffer.alloc(32, 29).toString("base64");
const id = "abcdef01-1111-4111-8111-111111111111";
const triageId = "abcdef02-2222-4222-8222-222222222222";
const v1Id = "abcdef03-3333-4333-8333-333333333333";
const submittedAt = "2026-11-18T02:00:00.000Z";
const bookedAt = "2026-11-18T02:00:20.000Z";
const noSignal = "你喺第 2 至第 5 題未有揀到明確相關訊號，暫時未能分出重點。第一次見面可以由你最想了解嘅方向開始梳理。";
const reportPath = "/api/report-v2-pdf?id=";
const credentials = { email: "admin@example.test", password: "Admin-test-password-123!" };
const booking = { store: "灣仔", date: "2026-11-20", weekday: "星期五", timeSlot: "11am-1pm" };
const unlock = {
  schema_version: 2,
  submission_id: id,
  submission_token: "abcdef04-4444-4444-8444-444444444444",
  submitted_at: submittedAt,
  event_type: "quiz_unlocked",
  day_entry: "17",
  axis_entry: "metabolic",
  user: {
    name: '\u200B＝測試陳小姐 "A" <b>',
    phone: "98760001",
    email: "+visitor@example.test",
    ageRange: "55-64",
    gender: "女",
    heightCm: 165,
    weightKg: 65,
    marketingConsent: true,
  },
  answers: {
    q1: "手腳瘦肚腩大／驗出脂肪肝",
    q2: ["以上皆無"],
    q3: ["以上皆無"],
    q4: ["以上皆無"],
    q5: ["沒有食長期處方西藥"],
    q6: ["以上全部沒有"],
    q7: "想幫屋企人（父母／伴侶）一齊梳理情況",
  },
  booking: null,
};
const triage = {
  ...unlock,
  submission_id: triageId,
  submission_token: "abcdef05-5555-4555-8555-555555555555",
  event_type: "triage_aborted_level1",
  user: null,
  day_entry: "05",
  axis_entry: "dual",
  answers: { q6: ["靜止或行一層樓梯即胸痛心翳氣促"] },
};
let db, app, v2, v1, adminCookie, visitorCookie;

before(async () => {
  db = new PGlite();
  const query = async (statement, parameters) => {
    const result = await db.query(
      typeof statement === "string" ? statement : statement.text,
      parameters || statement.values,
    );
    return { ...result, rowCount: result.affectedRows ?? result.rows.length };
  };
  const pool = { query, connect: async () => ({ query, release() {} }) };
  app = createApplication({
    pool,
    origin,
    secret: "reels-v2-admin-test-auth-secret-32chars",
    production: false,
  });
  await app.initialize();
  await app.bootstrapAdmin({ name: "測試管理員", ...credentials });
  const visitor = { email: "visitor@example.test", password: "Visitor-test-password-123!" };
  const registered = await authRequest("sign-up/email", { name: "測試客人", consent: true, ...visitor });
  assert.equal(registered.status, 200, await registered.clone().text());
  adminCookie = await login(credentials);
  visitorCookie = await login(visitor);

  const now = () => new Date("2026-11-18T02:01:00.000Z");
  v2 = createReelsV2Store({ pool, encryptionKey, now });
  v1 = createReelsStore({ pool, encryptionKey, now });
  await v2.save(triage);
  await v2.save(unlock);
  await v2.save({ ...unlock, event_type: "booking_intent", submitted_at: bookedAt, booking });
  await v1.save({ ...unlock, submission_id: v1Id, user: { ...unlock.user, name: "只屬 V1 客人" } });
});

after(async () => db?.close());

function authRequest(operation, body) {
  return app.fetch(new Request(origin + "/api/health-intake/auth/" + operation, {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(body),
  }));
}

function cookieFrom(response) {
  return response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
}

async function login(user) {
  const response = await authRequest("sign-in/email", user);
  assert.equal(response.status, 200, await response.clone().text());
  return cookieFrom(response);
}

async function makeAdmin(getStore = () => v2) {
  const { createReelsV2Admin } = await import("../server/reels-v2-admin.mjs");
  return createReelsV2Admin({
    origin, exportKey, getStore,
    getSession: (headers) => app.auth.api.getSession({ headers }),
  });
}

function request(path, headers = { cookie: adminCookie }, method = "GET") {
  return new Request(origin + path, { headers, method });
}

function assertPrivate(response) {
  assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow, noarchive");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.equal(response.headers.get("vary"), "Cookie, Authorization");
}

test("V2 downloads require GET and a real admin session or matching bearer", async () => {
  const admin = await makeAdmin();
  const denied = [
    [admin.exportCsv, request("/api/export-v2", {}), 401],
    [admin.exportCsv, request("/api/export-v2?key=" + exportKey, {}), 401],
    [admin.exportCsv, request("/api/export-v2", { authorization: "Bearer wrong" }), 401],
    [admin.exportCsv, request("/api/export-v2", { cookie: visitorCookie }), 403],
    [admin.reportPdf, request(reportPath + id, {}), 401],
    [admin.reportPdf, request(reportPath + id, { cookie: visitorCookie }), 403],
    [admin.exportCsv, request("/api/export-v2", undefined, "POST"), 405],
    [admin.reportPdf, request(reportPath + id, undefined, "HEAD"), 405],
  ];
  for (const [handler, req, status] of denied) {
    const response = await handler(req);
    assert.equal(response.status, status);
    assertPrivate(response);
    assert.ok(!(await response.text()).includes(exportKey));
    if (status === 405) assert.equal(response.headers.get("allow"), "GET");
  }
  for (const headers of [{ cookie: adminCookie }, { authorization: "Bearer " + exportKey }]) {
    const response = await admin.exportCsv(request("/api/export-v2?format=json", headers));
    assert.equal(response.status, 200);
    assertPrivate(response);
  }
});

test("V2 JSON lists the dedicated store with private contact summaries and V2 report links", async () => {
  assert.equal((await v1.find(v1Id)).user.name, "只屬 V1 客人");
  const admin = await makeAdmin();
  const response = await admin.exportCsv(request("/api/export-v2?format=json"));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /^application\/json/);
  const { records } = await response.json();
  assert.deepEqual(records.sort((a, b) => a.submission_id.localeCompare(b.submission_id)), [
    {
      submission_id: id, submitted_at: bookedAt, event_type: "booking_intent",
      name: '\u200B＝測試陳小姐 "A" <b>', phone: "98760001", email: "+visitor@example.test",
      day_entry: "17", axis_entry: "metabolic", top_axis: null, evidence_count: 0, booking,
      report_url: origin + "/api/report-v2-pdf?id=abcdef01-1111-4111-8111-111111111111",
    },
    {
      submission_id: triageId, submitted_at: submittedAt, event_type: "triage_aborted_level1",
      name: null, phone: null, email: null, day_entry: "05", axis_entry: "dual",
      top_axis: null, evidence_count: null, booking: null, report_url: null,
    },
  ]);
});

test("V2 CSV includes every field, a UTF-8 BOM, and spreadsheet-safe cells", async () => {
  const admin = await makeAdmin();
  const response = await admin.exportCsv(request("/api/export-v2"));
  assert.equal(response.status, 200);
  assertPrivate(response);
  assert.equal(response.headers.get("content-type"), "text/csv; charset=utf-8");
  assert.equal(response.headers.get("content-disposition"), 'attachment; filename="health-decoder-reels-v2.csv"');
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.equal(bytes.subarray(0, 3).toString("hex"), "efbbbf");
  const [header, ...rows] = bytes.subarray(3).toString("utf8").split("\r\n");
  assert.equal(header, [
    '"版本","紀錄編號","提交時間（香港）","提交時間（UTC）","事件","稱呼","WhatsApp 電話","電郵地址","年齡範圍","性別","身高（cm）","體重（kg）","同意接收推廣資訊"',
    '"來源 Day","來源 Axis","BMI","BMI 分類","BMI 提示","自評重點","糖脂代謝（%）","體力與肌力（%）","腸胃與發炎（%）","用藥配合（%）","相關訊號數量"',
    '"第1題","第2題","第3題","第4題","第5題","第6題","第7題","意向門市","意向日期","星期","意向時段","客戶版報告 PDF 下載連結"',
  ].join(","));
  assert.equal(rows.pop(), "", "CSV ends with CRLF");
  rows.sort();
  assert.deepEqual(rows, [
    [
      `"V2","${id}","2026-11-18 10:00:20","2026-11-18T02:00:20.000Z","booking_intent","'\u200B＝測試陳小姐 ""A"" <b>","98760001","'+visitor@example.test","55-64","女","165","65","同意"`,
      '"17","metabolic","23.9","體重過重","BMI 超標風險（過重 23.0–24.9）：糖脂代謝負荷、血壓波動同脂肪肝風險開始上升，建議及早從源頭調整。","","0","0","0","0","0"',
      `"手腳瘦肚腩大／驗出脂肪肝","以上皆無","以上皆無","以上皆無","沒有食長期處方西藥","以上全部沒有","想幫屋企人（父母／伴侶）一齊梳理情況","灣仔","2026-11-20","星期五","11am-1pm","${origin}/api/report-v2-pdf?id=${id}"`,
    ].join(","),
    [
      `"V2","${triageId}","2026-11-18 10:00:00","2026-11-18T02:00:00.000Z","triage_aborted_level1","","","","","","","",""`,
      '"05","dual","","","","","","","","",""',
      '"","","","","","靜止或行一層樓梯即胸痛心翳氣促","","","","","",""',
    ].join(","),
  ]);
  assert.doesNotMatch(bytes.toString("utf8"), /\/api\/report-pdf\?|只屬 V1 客人|abcdef04-4444/);
});

// Parse the PDFKit page streams and embedded ToUnicode CID map. Decoding the
// page's text operators verifies selectable content without an external test binary.
function parseReport(bytes) {
  const source = bytes.toString("latin1");
  assert.match(source, /^%PDF-/);
  assert.match(source, /\/BaseFont \/\w+\+NotoSansCJKhk-Regular\b/);
  assert.match(source, /\/FontFile[23] \d+ 0 R/);
  const objects = new Map(Array.from(source.matchAll(/^(\d+) 0 obj\n([\s\S]*?)\nendobj$/gm), ([, id, value]) => [id, value]));
  function stream(id) {
    const [, data] = objects.get(id).match(/\/Filter \/FlateDecode[\s\S]*?\nstream\n([\s\S]*)\nendstream$/);
    return inflateSync(Buffer.from(data, "latin1")).toString("ascii");
  }
  const [, cmapId] = source.match(/\/ToUnicode (\d+) 0 R/);
  const cmap = stream(cmapId);
  const glyphs = new Map();
  for (const [, first, , entries] of cmap.matchAll(/<(\w+)> <(\w+)> \[([^\]]+)\]/g)) {
    Array.from(entries.matchAll(/<(\w+)>/g)).forEach(([, hex], offset) => {
      glyphs.set(Number.parseInt(first, 16) + offset, Buffer.from(hex, "hex").swap16().toString("utf16le"));
    });
  }
  const pages = [...objects.values()].filter(object => /\/Type \/Page\b/.test(object));
  assert.ok(pages.length >= 2);
  return pages.map(page => {
    assert.match(page, /\/MediaBox \[0 0 595\.28 841\.89\]/);
    const [, contentId] = page.match(/\/Contents (\d+) 0 R/);
    return Array.from(stream(contentId).matchAll(/\[([^\]]+)\] TJ/g), ([, run]) =>
      Array.from(run.matchAll(/<([\da-f]+)>/gi), ([, hex]) =>
        hex.match(/.{4}/g).map(cid => glyphs.get(Number.parseInt(cid, 16))).join(""),
      ).join(""),
    ).join("\n");
  }).join("\n");
}

const compact = value => value.replace(/\s+/gu, "");

test("a booked zero-signal record downloads an A4 report with neutral copy and no winning marker", async () => {
  const admin = await makeAdmin();
  const response = await admin.reportPdf(request(reportPath + id.toUpperCase(), { authorization: "Bearer " + exportKey }));
  assert.equal(response.status, 200);
  assertPrivate(response);
  assert.equal(response.headers.get("content-type"), "application/pdf");
  assert.equal(response.headers.get("content-disposition"), `attachment; filename="health-decoder-v2-report-${id}.pdf"`);
  const text = compact(parseReport(Buffer.from(await response.arrayBuffer())));
  for (const passage of [
    "Health Decoder 個人自評報告", "2026年11月18日", "測試陳小姐", "55-64", "女",
    "23.9", "體重過重", "糖脂代謝負荷、血壓波動同脂肪肝風險開始上升",
    noSignal, "灣仔", "2026-11-20", "星期五", "11am-1pm",
    "健康交流參考", "醫療診斷", "第一次見面流程",
  ]) {
    assert.ok(text.includes(compact(passage)), passage);
  }
  assert.equal(text.match(/0%/g)?.length, 4);
  assert.doesNotMatch(text, /較多相關訊號|今次自評重點/);
});

test("V2 report eligibility excludes absent, V1, triage, incomplete and wrong-version snapshots", async () => {
  const admin = await makeAdmin();
  for (const missing of [triageId, v1Id, "abcdef06-6666-4666-8666-666666666666"]) {
    const response = await admin.reportPdf(request(reportPath + missing));
    assert.equal(response.status, 404);
    assertPrivate(response);
    assert.deepEqual(await response.json(), { error: "未有可下載嘅問卷報告" });
  }
  assert.equal((await admin.reportPdf(request(reportPath + "invalid"))).status, 400);

  const record = await v2.find(id);
  for (const fields of [
    { user: null }, { bmi: null }, { ratios: null }, { ratios: { metabolic: 0 } },
    { event_type: "triage_aborted_level1" }, { scoring_version: "v1" },
  ]) {
    const invalid = { ...record, ...fields };
    const corrupt = await makeAdmin(() => ({ ...v2, list: async () => [invalid], find: async () => invalid }));
    const response = await corrupt.reportPdf(request(reportPath + id));
    assert.equal(response.status, 404, JSON.stringify(fields));
    assertPrivate(response);
    const summary = await (await corrupt.exportCsv(request("/api/export-v2?format=json"))).json();
    assert.equal(summary.records[0].report_url, null);
  }
});

test("the V2 customer PDF renders the stored scores and answers without exposing scoring mechanics", async () => {
  const record = await v2.find(id);
  const { renderReelsV2Report } = await import("../server/reels-v2-report-pdf.mjs");
  // These answers naturally score 0% for every group. This stored snapshot has a clear, different result.
  const output = await renderReelsV2Report({
    ...record, evidence_count: 5, top_axis: "gut", ratios: { metabolic: 7, mito: 13, gut: 59, dual: 21 },
    submission_token: "DO-NOT-PRINT-TOKEN", analytics_id: "DO-NOT-PRINT-ANALYTICS-ID",
  });
  assert.ok(Buffer.isBuffer(output));
  const extracted = parseReport(output);
  const text = compact(extracted);
  assert.match(text, /今次自評重點腸胃與發炎/);
  assert.equal(text.match(/較多相關訊號/g)?.length, 1);
  assert.match(text, /糖脂代謝7%/);
  assert.match(text, /體力與肌力13%/);
  assert.match(text, /腸胃與發炎較多相關訊號59%/);
  assert.match(text, /用藥與安全配合21%/);
  for (const [number, answer] of Object.values(record.answers).entries()) {
    const next = text.indexOf(`第${number + 1}題`);
    assert.ok(next >= 0 && text.slice(next, next + 75).includes(compact([answer].flat().join("；"))), `question ${number + 1}`);
  }
  for (const title of [
    "微電流檢測", "身體成份分析", "深入聆聽處境與訴求", "初步分析結果及見解",
    "一週深入分析方案（自願）", "再約下一次見面詳細解讀",
  ]) assert.ok(text.includes(title), title);
  assert.doesNotMatch(extracted, /DO-NOT-PRINT|\b(?:metabolic|mito|gut|dual|Axis|Day|V2)\b|版本|權重|公式|主要火頭|主因/i);
});

test("failed V2 reads return only the safe private 503", async () => {
  const admin = await makeAdmin(() => { throw new Error("private connection string"); });
  for (const [handler, path] of [[admin.exportCsv, "/api/export-v2"], [admin.reportPdf, reportPath + id]]) {
    const response = await handler(request(path));
    assert.equal(response.status, 503);
    assertPrivate(response);
    assert.deepEqual(await response.json(), { error: "暫時未能讀取紀錄，請稍後再試。" });
  }
});

const dashboardUrl = origin + "/reels-quiz-v2/admin/";
const folder = new URL("../reels-quiz-v2/admin/", import.meta.url);

async function dashboard(t, fetch) {
  const [markup, script] = await Promise.all([
    readFile(new URL("index.html", folder), "utf8"),
    readFile(new URL("app.mjs", folder), "utf8"),
  ]);
  const dom = new JSDOM(markup, { url: dashboardUrl, runScripts: "outside-only" });
  t.after(() => dom.window.close());
  dom.window.fetch = fetch;
  dom.window.eval(script);
  return dom.window;
}

test("the V2 dashboard signs in here and shows V2 contact, source, progress, booking and download links", async t => {
  const admin = await makeAdmin();
  let cookie;
  const calls = [];
  const window = await dashboard(t, async (path, options) => {
    calls.push(path);
    assert.equal(options.credentials, "same-origin");
    if (path === "/api/health-intake/auth/sign-in/email") {
      assert.equal(options.method, "POST");
      const response = await authRequest("sign-in/email", JSON.parse(options.body));
      cookie = cookieFrom(response);
      return response;
    }
    assert.equal(path, "/api/export-v2?format=json");
    assert.equal(options.cache, "no-store");
    return admin.exportCsv(request(path, cookie ? { cookie } : {}));
  });
  const { document } = window;
  const signIn = document.querySelector("#sign-in");
  const form = signIn.querySelector("form");
  const status = document.querySelector("#status");
  const csv = document.querySelector("#download-csv");
  const search = document.querySelector("#record-search");
  const table = document.querySelector("#table");
  const list = document.querySelector("#records");
  assert.equal(document.title, "Reels 問卷 V2 管理");
  assert.equal(document.querySelector("h1").textContent, "Reels 問卷 V2 管理");
  assert.equal(status.getAttribute("role"), "status");
  await tick();
  assert.equal(signIn.hidden, false);
  assert.equal(form.querySelector("button").textContent, "登入 Reels V2 問卷管理");
  assert.equal(csv.hidden, true);
  assert.equal(table.hidden, true);

  form.elements.email.value = credentials.email;
  form.elements.password.value = credentials.password;
  form.dispatchEvent(new window.Event("submit", { cancelable: true }));
  for (let attempt = 0; csv.hidden && attempt < 100; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.deepEqual(calls, [
    "/api/export-v2?format=json", "/api/health-intake/auth/sign-in/email", "/api/export-v2?format=json",
  ]);
  assert.equal(window.location.href, dashboardUrl);
  assert.equal(signIn.hidden, true);
  assert.equal(form.elements.password.value, "");
  assert.equal(csv.hidden, false);
  assert.equal(csv.getAttribute("href"), "/api/export-v2");
  assert.equal(table.hidden, false);
  assert.match(status.textContent, /共 2 筆紀錄.*香港時間/);
  const link = list.querySelector("a");
  assert.equal(list.querySelectorAll("a").length, 1);
  assert.equal(link.getAttribute("href"), "/api/report-v2-pdf?id=abcdef01-1111-4111-8111-111111111111");
  const row = link.closest("tr");
  assert.deepEqual(Array.from(row.cells, cell => cell.dataset.label), [
    "提交時間", "稱呼", "電郵／WhatsApp", "Reel Day", "進度", "預約意向", "客人報告",
  ]);
  assert.match(row.cells[0].textContent, /10:00/);
  assert.equal(row.cells[1].textContent, '\u200B＝測試陳小姐 "A" <b>');
  assert.equal(row.querySelector("b"), null);
  assert.match(row.cells[2].textContent, /\+visitor@example\.test.*98760001/s);
  assert.match(row.cells[3].textContent, /17/);
  assert.equal(row.cells[4].textContent, "已記錄預約意向");
  assert.match(row.cells[5].textContent, /灣仔.*2026-11-20.*星期五.*11am-1pm/);
  assert.match(list.textContent, /已顯示安全提醒/);
  for (const term of ["ABCDEF01", "測試陳小姐", "+VISITOR", "98760001"]) {
    search.value = term;
    search.dispatchEvent(new window.Event("input"));
    assert.equal(list.rows.length, 1, term);
    assert.equal(list.querySelector("a").getAttribute("href"), reportPath + id);
  }
  search.value = "NO-SUCH-RECORD";
  search.dispatchEvent(new window.Event("input"));
  assert.equal(table.hidden, true);
  assert.equal(list.rows.length, 0);
  assert.equal(status.textContent, "搵唔到符合條件嘅紀錄。");
});

test("the V2 dashboard recovers from network failure and distinguishes empty, unauthorized and forbidden states", async t => {
  let state = "empty";
  const window = await dashboard(t, async path => {
    assert.equal(path, "/api/export-v2?format=json");
    if (state === "network") throw new TypeError("network error");
    if (state !== "empty") return new Response(null, { status: state });
    return Response.json({ records: [] });
  });
  const { document } = window;
  const status = document.querySelector("#status");
  const refresh = document.querySelector("#refresh");
  const csv = document.querySelector("#download-csv");
  const signIn = document.querySelector("#sign-in");
  await tick();
  assert.equal(status.textContent, "暫未有 V2 問卷紀錄。");
  assert.equal(csv.hidden, false);
  assert.equal(document.querySelector("#table").hidden, true);
  assert.equal(document.querySelector("#search-wrap").hidden, true);
  for (const [next, message, loginHidden] of [
    ["network", "暫時未能載入紀錄，請重新載入。", true],
    [401, "請先登入管理員帳戶。", false],
    [403, "目前帳戶未有管理員權限。", false],
    ["empty", "暫未有 V2 問卷紀錄。", true],
  ]) {
    state = next;
    refresh.click();
    await tick();
    assert.equal(status.textContent, message);
    assert.equal(refresh.disabled, false);
    assert.equal(csv.hidden, next !== "empty");
    assert.equal(signIn.hidden, loginHidden);
  }
});

async function callVercel(handler, url, { method = "GET", authorization } = {}) {
  let status, headers, body;
  await handler({ url, method, headers: { authorization } }, {
    writeHead(code, values) { status = code; headers = values; },
    end(value) { body = value; },
  });
  return new Response(body, { status, headers });
}

test("Vercel handlers bridge HTTP requests to their dedicated V2 operations", async t => {
  const environment = { APP_ORIGIN: origin, ADMIN_EXPORT_KEY: exportKey, DATABASE_URL: "" };
  for (const [key, value] of Object.entries(environment)) {
    const previous = process.env[key];
    process.env[key] = value;
    t.after(() => {
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    });
  }
  const [{ default: exportV2 }, { default: reportV2 }] = await Promise.all([
    import("../api/export-v2.js"),
    import("../api/report-v2-pdf.js"),
  ]);
  assert.equal((await callVercel(exportV2, "/api/export-v2?format=json")).status, 401);
  assert.equal((await callVercel(reportV2, reportPath + id)).status, 401);
  const authorized = { authorization: "Bearer " + exportKey };
  const download = await callVercel(exportV2, "/api/export-v2?format=json", authorized);
  assert.equal(download.status, 503);
  assertPrivate(download);
  const malformed = await callVercel(reportV2, reportPath + "not-a-uuid", authorized);
  assert.equal(malformed.status, 400);
  assertPrivate(malformed);
});

test("both V2 Vercel handlers return private 405 responses for Fetch-forbidden methods", async t => {
  const [{ default: exportV2 }, { default: reportV2 }] = await Promise.all([
    import("../api/export-v2.js"),
    import("../api/report-v2-pdf.js"),
  ]);
  for (const [handler, path] of [[exportV2, "/api/export-v2?format=json"], [reportV2, reportPath + id]]) {
    for (const method of ["TRACE", "TRACK", "CONNECT"]) {
      await t.test(`${method} ${path}`, async () => {
        const response = await callVercel(handler, path, { method });
        assert.equal(response.status, 405);
        assert.equal(response.headers.get("allow"), "GET");
        assertPrivate(response);
        assert.deepEqual(await response.json(), { error: "不支援此操作" });
      });
    }
  }
});

async function startLocalServer(t) {
  const directory = await mkdtemp(join(tmpdir(), "reels-v2-admin-"));
  let child, stopped;
  t.after(async () => {
    if (child) {
      child.kill();
      await stopped;
    }
    await rm(directory, { recursive: true, force: true });
  });
  await cp(folder, join(directory, "reels-quiz-v2", "admin"), { recursive: true });

  const listener = createServer().listen(0, "127.0.0.1");
  await once(listener, "listening");
  const { port } = listener.address();
  const released = once(listener, "close");
  listener.close();
  await released;

  const entry = fileURLToPath(new URL("../server/local.mjs", import.meta.url));
  child = spawn(process.execPath, [entry], {
    cwd: directory,
    env: {
      ...process.env,
      NODE_ENV: "development",
      PORT: String(port),
      BETTER_AUTH_SECRET: "reels-v2-local-admin-test-only-secret",
      DATA_ENCRYPTION_KEY: encryptionKey,
      ADMIN_EXPORT_KEY: exportKey,
      HD_ADMIN_NAME: "本機測試管理員",
      HD_ADMIN_EMAIL: credentials.email,
      HD_ADMIN_PASSWORD: credentials.password,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  stopped = new Promise(resolve => child.once("close", resolve));
  const localOrigin = "http://localhost:" + port;
  await new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error(`Local server startup timed out\n${output}`)), 20_000);
    child.stderr.on("data", bytes => { output += bytes; });
    child.stdout.on("data", bytes => {
      output += bytes;
      if (output.includes(`Local development server: ${localOrigin}/intake/`)) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.once("error", error => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", code => {
      clearTimeout(timer);
      reject(new Error(`Local server exited with ${code}\n${output}`));
    });
  });
  return localOrigin;
}

test("the real local entry point serves V2 admin login, the isolated list, CSV and PDF", { timeout: 40_000 }, async t => {
  const localOrigin = await startLocalServer(t);
  const get = (path, headers) => fetch(localOrigin + path, { headers });
  const post = (path, body) => fetch(localOrigin + path, {
    method: "POST",
    headers: { origin: localOrigin, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const dashboard = await get("/reels-quiz-v2/admin/");
  assert.equal(dashboard.status, 200);
  assert.match(await dashboard.text(), /<h1>Reels 問卷 V2 管理<\/h1>/);

  const listPath = "/api/export-v2?format=json";
  const pdfPath = reportPath + id;
  const anonymous = await Promise.all([get(listPath), get(pdfPath)]);
  assert.deepEqual(anonymous.map(response => response.status), [401, 401]);
  anonymous.forEach(assertPrivate);

  const signedIn = await post("/api/health-intake/auth/sign-in/email", credentials);
  assert.equal(signedIn.status, 200, await signedIn.clone().text());
  const cookie = cookieFrom(signedIn);
  assert.ok(cookie);
  const payload = { ...unlock, submitted_at: new Date().toISOString() };
  const v2Saved = await post("/api/submit-v2", payload);
  assert.equal(v2Saved.status, 200, await v2Saved.clone().text());
  const v1Saved = await post("/api/submit", { ...payload, submission_id: v1Id });
  assert.equal(v1Saved.status, 200, await v1Saved.clone().text());

  const [list, csv, pdf, v1List] = await Promise.all([
    get(listPath, { cookie }),
    get("/api/export-v2", { authorization: "Bearer " + exportKey }),
    get(pdfPath, { cookie }),
    get("/api/export?format=json", { cookie }),
  ]);
  assert.deepEqual([list, csv, pdf, v1List].map(response => response.status), [200, 200, 200, 200]);
  [list, csv, pdf].forEach(assertPrivate);
  const { records } = await list.json();
  assert.deepEqual(records.map(record => record.submission_id), [id]);
  assert.equal(records[0].report_url, localOrigin + pdfPath);
  assert.deepEqual((await v1List.json()).records.map(record => record.submission_id), [v1Id]);
  assert.equal(csv.headers.get("content-disposition"), 'attachment; filename="health-decoder-reels-v2.csv"');
  assert.ok((await csv.text()).includes(localOrigin + pdfPath));
  assert.equal(pdf.headers.get("content-disposition"), `attachment; filename="health-decoder-v2-report-${id}.pdf"`);
  const report = compact(parseReport(Buffer.from(await pdf.arrayBuffer())));
  assert.ok(report.includes(compact(noSignal)));
});

test("unbooked V2 unlocks expose neutral and nonzero stored summaries and both retain report access", async () => {
  const neutralId = "abcdef07-7777-4777-8777-777777777777";
  const signalId = "abcdef08-8888-4888-8888-888888888888";
  await v2.save({ ...unlock, submission_id: neutralId });
  await v2.save({
    ...unlock,
    submission_id: signalId,
    answers: { ...unlock.answers, q4: ["成日胃脹／排便唔暢順", "長年鼻敏感、打噴嚏流鼻水"] },
  });

  const admin = await makeAdmin();
  const response = await admin.exportCsv(request("/api/export-v2?format=json"));
  assert.equal(response.status, 200);
  const { records } = await response.json();
  const results = records.filter(record => [neutralId, signalId].includes(record.submission_id))
    .sort((a, b) => a.submission_id.localeCompare(b.submission_id))
    .map(({ event_type, top_axis, evidence_count, booking, report_url }) =>
      [event_type, top_axis, evidence_count, booking, report_url]);
  assert.deepEqual(results, [
    ["quiz_unlocked", null, 0, null, origin + reportPath + neutralId],
    ["quiz_unlocked", "gut", 2, null, origin + reportPath + signalId],
  ]);
  const neutral = await admin.reportPdf(request(reportPath + neutralId));
  assert.equal(neutral.status, 200);
  const pdfText = compact(parseReport(Buffer.from(await neutral.arrayBuffer())));
  assert.ok(pdfText.includes(compact(noSignal)));
  assert.doesNotMatch(pdfText, /預約意向|較多相關訊號/);
});
