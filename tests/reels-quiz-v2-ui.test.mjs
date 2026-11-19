import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { JSDOM } from "jsdom";

const root = new URL("../reels-quiz-v2/", import.meta.url);
async function openPage(path = "index.html", search = "") {
  const file = new URL(path, root);
  assert.ok(existsSync(file), `Missing V2 page: ${path}`);
  return new JSDOM(await readFile(file, "utf8"), { url: "https://example.test/reels-quiz-v2/" + path + search });
}

test("first paint offers direct answers with the V2 assets before the module runs", async () => {
  const dom = await openPage();
  try {
    const doc = dom.window.document;
    assert.equal(doc.querySelector("script[type=module]").getAttribute("src"), "/reels-quiz-v2/quiz.mjs");
    assert.equal(doc.querySelector("link[rel=stylesheet]").getAttribute("href"), "/reels-quiz-v2/quiz.css");
    const css = doc.createElement("style");
    css.textContent = await readFile(new URL("quiz.css", root), "utf8");
    doc.head.append(css);
    const direct = [...doc.querySelectorAll("#videoControls button")].find(el => el.textContent === "直接作答（影片可稍後重溫）");
    assert.ok(direct, "Direct answer button on first paint");
    for (let el = direct; el; el = el.parentElement) {
      const style = dom.window.getComputedStyle(el);
      assert.notEqual(style.display, "none");
      assert.notEqual(style.visibility, "hidden");
      assert.notEqual(style.opacity, "0");
    }
    assert.equal(dom.window.getComputedStyle(direct).pointerEvents, "auto");
  } finally {
    dom.window.close();
  }
});

test("Admin shell identifies V2 and uses the isolated asset and export URLs", async () => {
  const dom = await openPage("admin/index.html");
  try {
    const doc = dom.window.document;
    assert.equal(doc.querySelector("h1").textContent, "Reels 問卷 V2 管理");
    assert.equal(doc.querySelector("script[type=module]").getAttribute("src"), "/reels-quiz-v2/admin/app.mjs");
    assert.equal(doc.querySelector("link[rel=stylesheet]").getAttribute("href"), "/reels-quiz-v2/admin/style.css");
    assert.equal(doc.querySelector("#download-csv").getAttribute("href"), "/api/export-v2");
  } finally {
    dom.window.close();
  }
});

const draftKey = "hd_reels_v4:01:metabolic";
const v1Key = "hd_reels_v3:01:metabolic";
const answers = {
  q1: "手腳瘦肚腩大／驗出脂肪肝", q2: ["以上皆無"], q3: ["唔肯定"], q4: ["以上皆無"],
  q5: ["沒有食長期處方西藥"], q6: ["以上全部沒有"], q7: "想幫屋企人（父母／伴侶）一齊梳理情況",
};
const user = { name: "陳太", phone: "51234567", email: "reader@example.test", ageRange: "55-64", gender: "女", heightCm: "160", weightKg: "58", marketingConsent: false };
const directCopy = "直接作答（影片可稍後重溫）";
const neutralCopy = "你喺第 2 至第 5 題未有揀到明確相關訊號，暫時未能分出重點。第一次見面可以由你最想了解嘅方向開始梳理。";
const validResponse = () => Response.json({ ok: true });
const settle = () => new Promise(resolve => setImmediate(resolve));

async function quiz(t, options = {}) {
  const { search = "", storage = {}, saved, submit = validResponse, event = validResponse, mediaFails = false } = options;
  const dom = await openPage("index.html", search);
  const win = dom.window;
  const doc = win.document;
  t.after(() => dom.window.close());
  for (const [key, value] of Object.entries(storage)) win.sessionStorage.setItem(key, value);
  if (saved) win.sessionStorage.setItem(draftKey, JSON.stringify({ ts: Date.now(), phase: "panel", answers, ...saved }));
  const requests = [];
  win.fetch = async (path, init) => {
    const request = new Request(new URL(path, win.location.href), init);
    const body = await request.json();
    requests.push({ path, body, request });
    if (path === "/api/submit-v2") return submit(body);
    if (path === "/api/event-v2") return event(body);
    throw new Error("Unexpected endpoint " + path);
  };
  win.HTMLMediaElement.prototype.pause = function () {};
  win.HTMLMediaElement.prototype.load = function () {
    if (mediaFails) this.dispatchEvent(new win.Event("error"));
  };
  win.HTMLMediaElement.prototype.play = function () {
    return mediaFails ? Promise.reject(new win.DOMException("Unavailable media", "NotSupportedError")) : Promise.resolve();
  };
  globalThis.window = win;
  const module = new URL("quiz.mjs", root);
  assert.ok(existsSync(module), "Missing V2 questionnaire behavior");
  module.search = "?run=" + crypto.randomUUID();
  await import(module.href);
  await settle();
  const one = selector => doc.querySelector(selector);
  const all = selector => [...doc.querySelectorAll(selector)];
  const action = name => one(`[data-click="${name}"]`);
  function click(el) {
    assert.ok(el, "Expected an actionable element on " + (win.state?.step || "Welcome"));
    assert.ok(!el.disabled);
    el.click();
  }
  function panel(step) {
    assert.equal(win.state.step, step);
    assert.equal(win.state.phase, "panel");
    assert.equal(one("#glassPanel").inert, false);
  }
  return { win, doc, one, all, click, panel, requests, action,
    events: () => requests.filter(r => r.path === "/api/event-v2").map(r => r.body),
    posts: () => requests.filter(r => r.path === "/api/submit-v2").map(r => r.body),
    snapshot: () => Object.fromEntries(Object.keys(win.sessionStorage).map(k => [k, win.sessionStorage.getItem(k)])),
  };
}

test("direct answers survive video failure, persist across reload, replay the current clip and return to Welcome", async t => {
  const legacy = JSON.stringify({ ts: Date.now(), step: "booking_done", paidLocked: true });
  let app = await quiz(t, { storage: { [v1Key]: legacy }, mediaFails: true });
  const direct = () => app.all("#videoControls button").find(el => el.textContent === directCopy);
  assert.equal(app.win.state.step, "welcome");
  app.click(app.action("manualStartVideo"));
  await settle();
  app.click(direct());
  app.panel("q1");
  app.click(app.action("stepBack"));
  assert.equal(app.win.state.step, "welcome");
  assert.equal(app.one("#videoControls").inert, false);
  assert.match(app.one("video").src, /01-welcome\.mp4$/);
  app.click(direct());
  app.click(app.action("pickSingle"));
  app.click(app.action("submitQuestion"));
  app.panel("q2");
  app = await quiz(t, { storage: app.snapshot(), mediaFails: true });
  app.panel("q2");
  app.click(app.action("replayStepVideo"));
  assert.equal(app.one("#videoControls").inert, false);
  assert.match(app.one("video").src, /\/demo\/reels-quiz\/media\/03-q2-metabolic\.mp4$/);
  app.click(direct());
  app.click(app.action("pickMulti"));
  app.click(app.action("submitQuestion"));
  app.panel("q3");
  assert.equal(app.snapshot()[v1Key], legacy);
  assert.equal(JSON.parse(app.snapshot()[draftKey]).textFirst, true);
});

test("video viewers keep the manual end-of-clip action and the day-specific Q1 video", async t => {
  const app = await quiz(t, { search: "?day=30&src=ig" });
  app.one("video").dispatchEvent(new app.win.Event("ended"));
  assert.equal(app.one("#skipVideoBtn").classList.contains("delayed-hide"), false);
  app.click(app.one("#skipVideoBtn"));
  assert.match(app.one("video").src, /02c-q1-gut\.mp4$/);
  assert.equal(app.win.state.phase, "video");
  assert.deepEqual(app.events().map(e => e.event), ["landing"]);
  app.one("video").dispatchEvent(new app.win.Event("ended"));
  app.click(app.one("#skipVideoBtn"));
  app.panel("q1");
  await settle();
  assert.deepEqual(app.events().map(e => [e.event, e.platform, e.reel]), [["landing", "ig", "30"], ["start", "ig", "30"]]);
});

for (const guard of ["q6", "checkout"]) {
  test("danger answer immediately displays the safety panel at " + guard, async t => {
    const app = await quiz(t, { saved: { step: guard }, submit: () => Response.json({ error: "unavailable" }, { status: 503 }) });
    if (guard === "q6") {
      app.click(app.action("pickMulti"));
      app.click(app.action("submitQuestion"));
    } else {
      // Exercise the submit-time guard independently of restore-time triage.
      app.win.state.answers.q6 = ["視力突然驟變／無故體重急跌"];
      app.click(app.one("#unlockBtn"));
    }
    app.panel("safety_stop");
    assert.match(app.one("#panelTitle").textContent, /請優先搵醫生檢查清楚/);
    assert.match(app.action("reviseSafetyAnswer").textContent, /剛才揀錯，返回重選/);
    assert.equal(app.one(".ratio-stack"), null);
    await settle();
    assert.deepEqual(app.posts().map(p => [p.event_type, p.schema_version, p.user]), [["triage_aborted_level1", 2, null]]);
    app.click(app.action("replayStepVideo"));
    assert.match(app.one("video").src, /08-safety-stop\.mp4$/);
  });
}

test("checkout identifies the first invalid field and clears only corrected errors", async t => {
  const app = await quiz(t, { saved: { step: "checkout", user: { name: "陳太", email: "invalid" } } });
  assert.deepEqual(app.all("fieldset legend").map(el => el.textContent), ["聯絡資料", "報告資料"]);
  const email = app.one("#inpEmail");
  const described = el => el.getAttribute("aria-describedby").split(/\s+/).map(id => app.doc.getElementById(id));
  assert.ok(described(email).some(el => el.textContent === "電郵會用作報告及預約跟進；健康資訊同活動電郵只會喺你另外勾選同意後寄出。"));
  assert.equal(email.required, true);
  const consent = app.one("#inpMarketing");
  assert.equal(consent.required, false);
  assert.equal(consent.checked, false);
  app.click(app.one("#unlockBtn"));
  const phone = app.one("#inpPhone");
  assert.equal(app.doc.activeElement, phone);
  assert.equal(app.all('[aria-invalid="true"]').length, 6);
  assert.ok(described(phone).some(el => el.textContent.trim()));
  assert.match(app.one('[role="alert"]').textContent, /WhatsApp/);
  phone.value = "61234567";
  phone.dispatchEvent(new app.win.Event("input", { bubbles: true }));
  assert.equal(phone.hasAttribute("aria-invalid"), false);
  assert.ok(described(phone).every(el => !el.textContent.trim()));
  assert.equal(email.getAttribute("aria-invalid"), "true");
  assert.equal(app.one("#inpName").value, "陳太");
  assert.equal(email.value, "invalid");
  app.click(app.one("#unlockBtn"));
  assert.equal(app.doc.activeElement, email);
  assert.equal(app.posts().length, 0);
});

for (const signal of [false, true]) {
  test("report distinguishes priorities, health evidence and zero signal: " + signal, async t => {
    let allow = false;
    const evidence = "體檢有脂肪肝／血脂超標";
    const record = { ...answers, q2: [signal ? evidence : "以上皆無"] };
    const app = await quiz(t, {
      saved: { step: "checkout", answers: record, user, textFirst: true },
      submit: () => allow ? validResponse() : Response.json({ error: "unavailable" }, { status: 503 }),
    });
    app.click(app.one("#unlockBtn"));
    await settle();
    app.panel("checkout");
    assert.deepEqual(app.events().map(e => e.event), ["landing", "checkout"]);
    allow = true;
    app.click(app.one("#unlockBtn"));
    await settle();
    app.panel("report1");
    assert.deepEqual(app.events().map(e => e.event), ["landing", "checkout", "report_unlocked"]);
    assert.equal(app.one("#panelTitle").textContent, signal ? "你今次嘅自評重點：三高糖脂代謝軸" : "暫未見明顯自評重點");
    const content = app.one("#panelBody").textContent;
    assert.match(content, /你一開始想了解/);
    assert.ok(content.includes(answers.q1));
    assert.match(content, /第一次見面最想優先傾/);
    assert.ok(content.includes(answers.q7));
    assert.match(content, /BMI/);
    assert.match(content, /PDF/);
    assert.doesNotMatch(content, /主要火頭|主因|👑/);
    if (signal) {
      assert.match(content, /較多相關訊號/);
      assert.match(content, /支持呢個自評重點嘅答案/);
      assert.ok(content.includes(evidence));
    } else {
      assert.ok(content.includes(neutralCopy));
      assert.doesNotMatch(content, /較多相關訊號/);
      assert.deepEqual(app.all(".ratio-head > :last-child").map(el => el.textContent), ["0%", "0%", "0%", "0%"]);
    }
    assert.equal(app.posts().at(-1).schema_version, 2);
    assert.equal(app.posts().at(-1).user.email, user.email);
    app.click(app.one('[data-arg1="offline_flow"]'));
    app.panel("offline_flow");
    assert.equal(app.all(".flow-node").length, 6);
    app.click(app.one('[data-arg1="report1"]'));
    app.click(app.one("#panelFooter .btn-primary"));
    app.panel("booking");
  });
}

test("booking requires store, date, time and a durable submit, then explicit WhatsApp confirmation survives reload", async t => {
  let allow = false;
  let app = await quiz(t, { search: "?platform=fb", saved: { step: "booking", user, paidLocked: true }, submit: () => allow ? validResponse() : Response.json({ error: "unavailable" }, { status: 503 }) });
  assert.deepEqual([app.win.state.hmcs.loc, app.win.state.hmcs.date, app.win.state.hmcs.time], ["", "", ""]);
  assert.equal(app.all('[data-click="selectBookingStore"]').length, 4);
  assert.equal(app.action("selectBookingDate"), null);
  assert.equal(app.action("selectBookingSlot"), null);
  const submit = () => app.one("#bookingSubmitBtn");
  assert.ok(submit().disabled);
  app.click(app.action("selectBookingStore"));
  assert.equal(app.action("selectBookingSlot"), null);
  app.click(app.action("selectBookingDate"));
  app.click(app.action("selectBookingSlot"));
  assert.equal(submit().disabled, false);
  app.click(app.all('[data-click="selectBookingDate"]')[1]);
  assert.ok(submit().disabled);
  assert.equal(app.win.state.hmcs.time, "");
  assert.ok(app.all(".slot-btn").every(el => ["true", "false"].includes(el.getAttribute("aria-pressed"))));
  app.click(app.action("selectBookingSlot"));
  app.click(submit());
  await settle();
  app.panel("booking");
  assert.deepEqual(app.events().map(e => e.event), ["landing"]);
  allow = true;
  app.click(submit());
  await settle();
  app.panel("booking_done");
  assert.equal(app.posts().at(-1).schema_version, 2);
  assert.ok(app.one("#glassPanel").textContent.includes("開啟後請喺 WhatsApp 按「傳送」，等團隊回覆確認。"));
  const link = app.one('a[href^="https://wa.me/85298788564?"]');
  assert.ok(link);
  assert.equal(link.dispatchEvent(new app.win.MouseEvent("click", { bubbles: true, cancelable: true })), true);
  await new Promise(resolve => setTimeout(resolve, 325));
  app.panel("booking_done");
  assert.deepEqual(app.events().map(e => e.event), ["landing", "booking_intent", "whatsapp_opened"]);
  const [first] = app.events();
  for (const e of app.events()) {
    assert.deepEqual(Object.keys(e).sort(), ["analytics_id", "event", "platform", "reel"]);
    assert.equal(e.analytics_id, first.analytics_id);
    assert.match(e.analytics_id, /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/);
    assert.equal(e.platform, "fb");
    assert.equal(e.reel, "01");
  }
  const post = app.posts().at(-1);
  assert.notEqual(first.analytics_id, post.submission_id);
  assert.notEqual(first.analytics_id, post.submission_token);
  assert.equal(Object.hasOwn(post, "analytics_id"), false);
  app = await quiz(t, { search: "?platform=fb", storage: app.snapshot() });
  app.panel("booking_done");
  assert.match(app.one('a[href^="https://wa.me/"]').textContent, /重新打開 WhatsApp/);
  const confirm = app.action("confirmWhatsAppSent");
  assert.equal(confirm.textContent, "我已喺 WhatsApp 按「傳送」");
  app.click(confirm);
  app.panel("post_whatsapp");
  assert.ok(app.one('a[href^="https://chat.whatsapp.com/"]'));
  assert.ok(app.one('a[href^="https://www.facebook.com/"]'));
  app = await quiz(t, { storage: app.snapshot() });
  app.panel("post_whatsapp");
});

test("booking revalidates the date at submit time", async t => {
  const app = await quiz(t, { saved: { step: "booking", user, paidLocked: true } });
  app.click(app.action("selectBookingStore"));
  app.click(app.action("selectBookingDate"));
  app.click(app.action("selectBookingSlot"));
  // A restored selection or a tab left open beyond the booking window.
  app.win.state.hmcs.date = "2001-01-01";
  app.click(app.one("#bookingSubmitBtn"));
  await settle();
  app.panel("booking");
  assert.ok(app.one("#bookingSubmitBtn").disabled);
  assert.equal(app.posts().length, 0);
});

test("legacy group page without explicit confirmation returns to WhatsApp", async t => {
  const app = await quiz(t, { saved: { step: "post_whatsapp", user, paidLocked: true } });
  app.panel("booking_done");
  assert.ok(app.one('a[href^="https://wa.me/"]'));
});

test("failed anonymous analytics never obstruct answering and never copy URL parameters", async t => {
  const app = await quiz(t, { search: "?src=personal%40example.com&day=unknown", event: () => { throw new TypeError("offline"); } });
  app.click(app.all("#videoControls button").find(el => el.textContent === directCopy));
  app.panel("q1");
  await settle();
  assert.deepEqual(app.events().map(e => [e.event, e.platform, e.reel]), [["landing", "unknown", "01"], ["start", "unknown", "01"]]);
  assert.equal(JSON.stringify(app.events()).includes("example.com"), false);
  for (const { request } of app.requests) {
    assert.equal(request.referrerPolicy, "no-referrer");
    assert.equal(request.credentials, "omit");
  }
});
