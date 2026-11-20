import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { submitReelsV2 } from "../api/submit-v2.js";
import { createReelsV2Store } from "../server/reels-v2-store.mjs";
import { createReelsV2Admin } from "../server/reels-v2-admin.mjs";
import { JSDOM } from "jsdom";

const root = new URL("../reels-quiz-v2/", import.meta.url);
async function openPage(path = "index.html", search = "", origin = "https://example.test") {
  const file = new URL(path, root);
  assert.ok(existsSync(file), `Missing V2 page: ${path}`);
  return new JSDOM(await readFile(file, "utf8"), { url: origin + "/reels-quiz-v2/" + path + search });
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

const origin = "https://example.test";
const encryptionKey = Buffer.alloc(32, 47).toString("base64");
let db, store;
before(async () => {
  db = new PGlite();
  store = createReelsV2Store({ pool: db, encryptionKey });
  await store.initialize();
});
after(async () => db?.close());

function realSubmit(body, request) {
  return submitReelsV2(request, { store, origin });
}

async function unlockedDraft(submittedAt = new Date().toISOString(), booking = null) {
  const submissionId = crypto.randomUUID();
  const submissionToken = crypto.randomUUID();
  const seed = createReelsV2Store({ pool: db, encryptionKey, now: () => new Date(submittedAt) });
  const payload = {
    schema_version: 2, submission_id: submissionId, submission_token: submissionToken,
    submitted_at: submittedAt, event_type: "quiz_unlocked", day_entry: "01", axis_entry: "metabolic",
    user, answers,
  };
  await seed.save(payload);
  if (booking) await seed.save({ ...payload, event_type: "booking_intent", booking });
  return { step: "booking", submissionId, submissionToken, user, answers, paidLocked: true };
}

async function quiz(t, options = {}) {
  const { origin, search = "", storage = {}, saved, submit = realSubmit, event = validResponse, mediaFails = false } = options;
  const dom = await openPage("index.html", search, origin);
  const win = dom.window;
  const doc = win.document;
  if (options.connectedTabs) {
    win.BroadcastChannel = class extends BroadcastChannel {
      constructor(name) {
        super(name);
        t.after(() => this.close());
      }
      postMessage(message) {
        if (options.blockTabMessages) throw new win.DOMException("Tab messaging blocked", "InvalidStateError");
        super.postMessage(message);
      }
    };
  }
  t.after(() => dom.window.close());
  for (const [key, value] of Object.entries(storage)) win.sessionStorage.setItem(key, value);
  if (saved) win.sessionStorage.setItem(draftKey, JSON.stringify({ ts: Date.now(), phase: "panel", answers, ...saved }));
  const requests = [];
  const inFlight = new Set();
  async function fetchResponse(path, init) {
    const request = new Request(new URL(path, win.location.href), init);
    request.headers.set("origin", win.location.origin);
    const body = await request.clone().json();
    requests.push({ path, body, request });
    if (path === "/api/submit-v2") return submit(body, request);
    if (path === "/api/event-v2") return event(body);
    throw new Error("Unexpected endpoint " + path);
  };
  win.fetch = (...args) => {
    const response = fetchResponse(...args);
    inFlight.add(response);
    response.then(() => inFlight.delete(response), () => inFlight.delete(response));
    return response;
  };
  async function idle() {
    do {
      await Promise.allSettled(inFlight);
      await settle();
    } while (inFlight.size);
  }
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
  await idle();
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
  return { win, doc, one, all, click, panel, requests, action, idle,
    events: () => requests.filter(r => r.path === "/api/event-v2").map(r => r.body),
    posts: () => requests.filter(r => r.path === "/api/submit-v2" && r.body.event_type).map(r => r.body),
    snapshot: () => Object.fromEntries(Object.keys(win.sessionStorage).map(k => [k, win.sessionStorage.getItem(k)])),
  };
}

function activateFocusedOption(app, name, index = 0, pressed = "true") {
  const options = () => app.all(`[data-click="${name}"]`);
  const option = options()[index];
  option.focus();
  assert.equal(app.doc.activeElement, option);
  // jsdom lacks the keyboard default action. A focused button's click activates the same handler as Space.
  app.click(option);
  assert.equal(app.doc.activeElement, options()[index], `Focus stays on ${name}`);
  assert.equal(app.doc.activeElement.getAttribute("aria-pressed"), pressed);
}

test("direct answers survive video failure, persist across reload, replay the current clip and return to Welcome", async t => {
  const legacy = JSON.stringify({ ts: Date.now(), step: "booking_done", paidLocked: true });
  let app = await quiz(t, { storage: { [v1Key]: legacy }, mediaFails: true });
  const direct = () => app.all("#videoControls button").find(el => el.textContent === directCopy);
  assert.equal(app.win.state.step, "welcome");
  app.click(app.action("manualStartVideo"));
  await app.idle();
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
  await app.idle();
  assert.deepEqual(app.events().map(e => [e.event, e.platform, e.reel]), [["landing", "ig", "30"], ["start", "ig", "30"]]);
});

test("single-answer options retain focus and expose the updated pressed state", async t => {
  const app = await quiz(t, { saved: { step: "q1", answers: {}, textFirst: true } });
  activateFocusedOption(app, "pickSingle", 1);
});

test("multi-answer options retain focus as they are selected and deselected", async t => {
  const app = await quiz(t, { saved: { step: "q2", answers: {}, textFirst: true } });
  activateFocusedOption(app, "pickMulti", 1);
  activateFocusedOption(app, "pickMulti", 1, "false");
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
    await app.idle();
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

test("checkout focuses a native-invalid email address without submitting", async t => {
  const app = await quiz(t, { saved: { step: "checkout", user: { ...user, email: "qa@-example.test" } } });
  const email = app.one("#inpEmail");
  assert.equal(email.validity.typeMismatch, true);
  app.click(app.one("#unlockBtn"));
  await app.idle();
  app.panel("checkout");
  assert.equal(app.doc.activeElement, email);
  assert.equal(email.getAttribute("aria-invalid"), "true");
  assert.equal(app.posts().length, 0);
});

test("review discards stale literal answer text and preserves known labels", async t => {
  const literal = "<em>Legacy answer label</em>";
  const record = { ...answers, q2: ["體檢有脂肪肝／血脂超標", literal], q7: literal };
  const app = await quiz(t, { saved: { step: "review", answers: record } });
  const chips = id => app.all(`[data-arg1="${id}"] .ans-chip`).map(el => el.textContent);
  assert.equal(app.one(".ans-chip em"), null);
  assert.deepEqual(chips("q2"), ["脂肪肝／血脂"]);
  assert.deepEqual(chips("q7"), ["未選"]);
  assert.deepEqual(app.win.state.answers.q2, ["體檢有脂肪肝／血脂超標"]);
  assert.equal(app.win.state.answers.q7, "");
});

test("restored wrong-type and duplicate answers cannot drive question navigation", async t => {
  const record = { ...answers, q1: [answers.q1], q2: "體檢有脂肪肝／血脂超標", q3: ["唔肯定", "以上皆無", "唔肯定"] };
  const app = await quiz(t, { saved: { step: "q2", answers: record, textFirst: true } });
  assert.equal(app.action("submitQuestion").disabled, true);
  assert.equal(app.one('[data-click="pickMulti"][aria-pressed="true"]'), null);
  assert.equal(app.win.state.answers.q1, "");
  assert.deepEqual(app.win.state.answers.q2, []);
  assert.deepEqual(app.win.state.answers.q3, ["唔肯定"]);
});

for (const signal of [false, true]) {
  test("report distinguishes priorities, health evidence and zero signal: " + signal, async t => {
    let allow = false;
    const evidence = "體檢有脂肪肝／血脂超標";
    const record = { ...answers, q2: [signal ? evidence : "以上皆無"] };
    const app = await quiz(t, {
      saved: { step: "checkout", answers: record, user, textFirst: true },
      submit: (body, request) => allow || body.action === "resume" ? realSubmit(body, request) : Response.json({ error: "unavailable" }, { status: 503 }),
    });
    app.click(app.one("#unlockBtn"));
    await app.idle();
    app.panel("checkout");
    assert.deepEqual(app.events().map(e => e.event), ["landing", "checkout"]);
    allow = true;
    app.click(app.one("#unlockBtn"));
    await app.idle();
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
  let app = await quiz(t, { search: "?platform=fb", saved: await unlockedDraft(), submit: (body, request) => allow || body.action === "resume" ? realSubmit(body, request) : Response.json({ error: "unavailable" }, { status: 503 }) });
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
  await app.idle();
  app.panel("booking");
  assert.deepEqual(app.events().map(e => e.event), ["landing"]);
  allow = true;
  app.click(submit());
  await app.idle();
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
  const app = await quiz(t, { saved: await unlockedDraft() });
  app.click(app.action("selectBookingStore"));
  app.click(app.action("selectBookingDate"));
  app.click(app.action("selectBookingSlot"));
  // A restored selection or a tab left open beyond the booking window.
  app.win.state.hmcs.date = "2001-01-01";
  app.click(app.one("#bookingSubmitBtn"));
  await app.idle();
  app.panel("booking");
  assert.ok(app.one("#bookingSubmitBtn").disabled);
  assert.equal(app.posts().length, 0);
});

test("progressive booking options retain focus after keyboard-style activation", async t => {
  const app = await quiz(t, { saved: await unlockedDraft() });
  for (const action of ["selectBookingStore", "selectBookingDate", "selectBookingSlot"]) {
    activateFocusedOption(app, action, 1);
  }
  assert.equal(app.one("#bookingSubmitBtn").disabled, false);
});

test("a hosted dev query cannot skip durable quiz unlock or booking", async t => {
  let bookingAvailable = false;
  const saved = { step: "checkout", user, textFirst: true };
  const app = await quiz(t, {
    search: "?dev=1", saved,
    storage: { [`${draftKey}:dev`]: JSON.stringify({ ts: Date.now(), phase: "panel", answers, ...saved }) },
    submit: (body, request) => body.event_type === "quiz_unlocked" || bookingAvailable
      ? realSubmit(body, request) : Response.json({ error: "unavailable" }, { status: 503 }),
  });
  app.click(app.one("#unlockBtn"));
  await app.idle();
  app.panel("report1");
  app.click(app.one("#panelFooter .btn-primary"));
  for (const name of ["selectBookingStore", "selectBookingDate", "selectBookingSlot"]) app.click(app.action(name));
  app.click(app.one("#bookingSubmitBtn"));
  await app.idle();
  app.panel("booking");
  assert.deepEqual(app.posts().map(post => post.event_type), ["quiz_unlocked", "booking_intent"]);
  assert.equal(app.one('a[href^="https://wa.me/"]'), null);
  assert.equal(app.doc.body.classList.contains("dev-mode"), false);
  const jump = app.one("#quickJumpSel");
  jump.value = "booking_done";
  jump.dispatchEvent(new app.win.Event("change", { bubbles: true }));
  app.panel("booking");
  bookingAvailable = true;
  app.click(app.one("#bookingSubmitBtn"));
  await app.idle();
  app.panel("booking_done");
  assert.deepEqual(app.posts().map(post => post.event_type), ["quiz_unlocked", "booking_intent", "booking_intent"]);
});

test("localhost keeps the questionnaire developer preview and simulated unlock", async t => {
  const app = await quiz(t, {
    origin: "http://localhost:3010", search: "?dev=1",
    storage: { [`${draftKey}:dev`]: JSON.stringify({ ts: Date.now(), phase: "panel", step: "checkout", user, textFirst: true }) },
  });
  assert.equal(app.doc.body.classList.contains("dev-mode"), true);
  app.click(app.one("#unlockBtn"));
  await app.idle();
  app.panel("report1");
  assert.equal(app.posts().length, 0);
  const jump = app.one("#quickJumpSel");
  jump.value = "q2";
  jump.dispatchEvent(new app.win.Event("change", { bubbles: true }));
  app.panel("q2");
});

test("legacy confirmation without both original credentials recovers at checkout without a lookup link", async t => {
  for (const identity of [{}, { submissionId: crypto.randomUUID() }, { submissionToken: crypto.randomUUID() }]) {
    const app = await quiz(t, { saved: { ...identity, step: "post_whatsapp", user, paidLocked: true } });
    app.panel("checkout");
    assert.equal(app.one('a[href^="https://wa.me/"]'), null);
    assert.equal(app.one("#inpEmail").value, user.email);
    assert.equal(app.posts().length, 0);
  }
});

test("legacy confirmation with a real unlock but no accepted booking returns to booking", async t => {
  const saved = { ...await unlockedDraft(), step: "booking_done", whatsappOpened: true };
  const app = await quiz(t, { saved });
  app.panel("booking");
  assert.equal(app.one('a[href^="https://wa.me/"]'), null);
  assert.equal(app.one("#bookingSubmitBtn").disabled, true);
  assert.equal((await store.find(saved.submissionId)).booking, null);
});

test("an intact legacy booking reopens the original accepted past slot and lookup number", async t => {
  const booking = { store: "觀塘", date: "2024-05-04", weekday: "星期六", timeSlot: "2pm-4pm" };
  const saved = {
    ...await unlockedDraft("2024-05-01T02:00:00.000Z", booking),
    step: "post_whatsapp", whatsappOpened: true,
    hmcs: { loc: "觀塘", date: "2024-05-04", weekday: "星期六", dateLabel: "5/4 (六)", time: "2pm-4pm" },
  };
  const app = await quiz(t, { saved });
  app.panel("booking_done");
  const text = new URL(app.one("#bookingWhatsAppLink").href).searchParams.get("text");
  for (const value of [saved.submissionId, booking.store, booking.date, booking.timeSlot]) assert.ok(text.includes(value));
  assert.equal(app.one("#confirmWhatsAppBtn").disabled, false);
  const absent = await quiz(t, { saved: { ...saved, submissionId: crypto.randomUUID() } });
  absent.panel("checkout");
  assert.equal(absent.one("#bookingWhatsAppLink"), null);
});

test("a retained Q6 review edit shows safety before Back and Continue can reach contact fields", async t => {
  const app = await quiz(t, { saved: { step: "review", user, textFirst: true } });
  app.click(app.one('[data-click="editFromReview"][data-arg1="q6"]'));
  app.click(app.one('[data-click="pickMulti"][data-arg2="靜止或行一層樓梯即胸痛心翳氣促"]'));
  app.click(app.action("stepBack"));
  app.one('[data-click="goStep"][data-arg1="checkout"]')?.click();
  app.panel("safety_stop");
  assert.match(app.one("#panelTitle").textContent, /請優先搵醫生/);
  assert.equal(app.one("#inpName"), null);
  await app.idle();
  assert.deepEqual(app.posts().map(p => p.event_type), ["triage_aborted_level1"]);
  assert.equal(app.events().some(e => e.event === "checkout"), false);
});

test("a pasted control character in a name gets a focused inline error before any submission", async t => {
  const app = await quiz(t, { saved: { step: "checkout", user } });
  const name = app.one("#inpName");
  name.value = "陳\t小明";
  name.dispatchEvent(new app.win.Event("input", { bubbles: true }));
  app.click(app.one("#unlockBtn"));
  await app.idle();
  assert.equal(app.doc.activeElement, name);
  assert.equal(name.getAttribute("aria-invalid"), "true");
  assert.ok(app.one("#inpNameError").textContent);
  assert.equal(app.posts().length, 0);
});

test("a lost unlock reply followed by corrected contact, consent and Q2 matches the real Admin CSV", async t => {
  let loseReply = true;
  const submit = async (body, request) => {
    const response = await realSubmit(body, request);
    if (loseReply && response.ok) {
      loseReply = false;
      throw new TypeError("Response lost after database commit");
    }
    return response;
  };
  let app = await quiz(t, { saved: { step: "checkout", user: { ...user, marketingConsent: true }, textFirst: true }, submit });
  app.click(app.one("#unlockBtn"));
  await app.idle();
  app.panel("checkout");
  const [original] = app.posts();
  assert.equal((await store.find(original.submission_id)).evidence_count, 0);
  app = await quiz(t, { storage: app.snapshot(), submit });
  const email = app.one("#inpEmail");
  email.value = "corrected@example.test";
  email.dispatchEvent(new app.win.Event("input", { bubbles: true }));
  app.click(app.one("#inpMarketing"));
  app.click(app.one('[data-click="goStep"][data-arg1="review"]'));
  app.click(app.one('[data-click="editFromReview"][data-arg1="q2"]'));
  app.click(app.one('[data-click="pickMulti"][data-arg2="體檢有脂肪肝／血脂超標"]'));
  app.click(app.action("submitQuestion"));
  app.click(app.one('[data-click="goStep"][data-arg1="checkout"]'));
  app.click(app.one("#unlockBtn"));
  await app.idle();
  app.panel("report1");
  assert.match(app.one("#panelTitle").textContent, /三高糖脂代謝軸/);
  assert.equal(app.one(".ratio-head > :last-child").textContent, "100%");
  const admin = createReelsV2Admin({ origin, exportKey: "test-key", getStore: () => store });
  const csv = await admin.exportCsv(new Request(origin + "/api/export-v2", { headers: { authorization: "Bearer test-key" } }));
  const row = (await csv.text()).split("\r\n").find(line => line.includes(original.submission_id));
  assert.match(row, /"corrected@example.test".*"未同意"/);
  assert.match(row, /"metabolic","100","0","0","0","1"/);
  assert.ok(row.includes("體檢有脂肪肝／血脂超標"));
});

test("an unchanged unlock retry after reload replays the exact request", async t => {
  const lost = async (body, request) => {
    await realSubmit(body, request);
    throw new TypeError("Response lost");
  };
  let app = await quiz(t, { saved: { step: "checkout", user, textFirst: true }, submit: lost });
  app.click(app.one("#unlockBtn"));
  await app.idle();
  const [original] = app.posts();
  app = await quiz(t, { storage: app.snapshot() });
  app.click(app.one("#unlockBtn"));
  await app.idle();
  app.panel("report1");
  assert.deepEqual(app.posts(), [original]);
});

test("a bare success without an accepted record keeps checkout recoverable", async t => {
  const app = await quiz(t, { saved: { step: "checkout", user, textFirst: true }, submit: validResponse });
  app.click(app.one("#unlockBtn"));
  await app.idle();
  app.panel("checkout");
  assert.ok(app.one("#submissionStatus").textContent);
  assert.equal(app.events().some(e => e.event === "report_unlocked"), false);
});

test("a stale unlock loads the accepted answers and contact into checkout for an explicit correction", async t => {
  let supersede = true;
  const app = await quiz(t, { saved: { step: "checkout", user, textFirst: true }, submit: async (body, request) => {
    if (supersede && body.event_type === "quiz_unlocked") {
      supersede = false;
      await store.save({
        ...body, submitted_at: new Date(Date.parse(body.submitted_at) + 2000).toISOString(),
        answers: { ...body.answers, q2: ["體檢有脂肪肝／血脂超標"] },
        user: { ...body.user, email: "other-tab@example.test", marketingConsent: true },
      });
    }
    return realSubmit(body, request);
  } });
  app.click(app.one("#unlockBtn"));
  await app.idle();
  app.panel("checkout");
  assert.match(app.one("#submissionStatus").textContent, /另一個分頁/);
  assert.equal(app.one("#inpEmail").value, "other-tab@example.test");
  assert.equal(app.one("#inpMarketing").checked, true);
  app.click(app.one("#inpMarketing"));
  app.click(app.one("#unlockBtn"));
  await app.idle();
  app.panel("report1");
  assert.match(app.one("#panelTitle").textContent, /三高糖脂代謝軸/);
  const saved = await store.find(app.posts()[0].submission_id);
  assert.equal(saved.user.marketingConsent, false);
  assert.equal(saved.user.email, "other-tab@example.test");
});

test("a superseded booking displays the stored store, contact and WhatsApp message", async t => {
  const saved = await unlockedDraft();
  const app = await quiz(t, { saved, submit: async (body, request) => {
    if (body.event_type === "booking_intent") {
      const newer = { ...body, booking: { ...body.booking, store: "觀塘" }, submitted_at: new Date(Date.parse(body.submitted_at) + 1).toISOString() };
      await store.save(newer);
    }
    return realSubmit(body, request);
  } });
  for (const name of ["selectBookingStore", "selectBookingDate", "selectBookingSlot"]) app.click(app.action(name));
  app.click(app.one("#bookingSubmitBtn"));
  await app.idle();
  app.panel("booking_done");
  const text = new URL(app.one("#bookingWhatsAppLink").href).searchParams.get("text");
  assert.equal((await store.find(saved.submissionId)).booking.store, "觀塘");
  assert.match(text, /意向門市：觀塘/);
  assert.doesNotMatch(text, /灣仔/);
  assert.match(app.one("#panelBody").textContent, /另一個分頁/);
});

for (const delayReply of [false, true]) {
  test("both live tabs keep the newest WhatsApp selection with a delayed first reply: " + delayReply, async t => {
    const saved = await unlockedDraft();
    const committed = Promise.withResolvers();
    const deliver = Promise.withResolvers();
    const first = await quiz(t, { saved, connectedTabs: true, submit: async (body, request) => {
      const response = await realSubmit(body, request);
      if (body.event_type === "booking_intent") {
        committed.resolve();
        if (delayReply) await deliver.promise;
      }
      return response;
    } });
    const later = await quiz(t, { saved, connectedTabs: true });
    for (const [app, selection] of [[first, "灣仔"], [later, "觀塘"]]) {
      app.click(app.one(`[data-click="selectBookingStore"][data-arg1="${selection}"]`));
      app.click(app.action("selectBookingDate"));
      app.click(app.action("selectBookingSlot"));
    }
    first.click(first.one("#bookingSubmitBtn"));
    await committed.promise;
    if (!delayReply) await first.idle();
    later.click(later.one("#bookingSubmitBtn"));
    await later.idle();
    deliver.resolve();
    await first.idle();
    const message = app => new URL(app.one("#bookingWhatsAppLink")?.href ?? origin).searchParams.get("text") ?? "";
    for (let i = 0; i < 30 && !message(first).includes("意向門市：觀塘"); i++) {
      await new Promise(resolve => setTimeout(resolve, 10));
      await first.idle();
    }
    for (const app of [first, later]) {
      app.panel("booking_done");
      assert.match(message(app), /意向門市：觀塘/);
    }
    assert.match(first.one("#panelBody").textContent, /另一個分頁/);
    assert.equal((await store.find(saved.submissionId)).booking.store, "觀塘");
  });
}

test("a late successful booking response without tab messaging reconciles before exposing WhatsApp", async t => {
  const saved = await unlockedDraft();
  const app = await quiz(t, { saved, submit: async (body, request) => {
    const response = await realSubmit(body, request);
    if (body.event_type === "booking_intent") {
      assert.equal(response.status, 200);
      await store.save({
        ...body, submitted_at: new Date(Date.parse(body.submitted_at) + 1).toISOString(),
        booking: { ...body.booking, store: "荃灣" },
      });
    }
    return response;
  } });
  for (const name of ["selectBookingStore", "selectBookingDate", "selectBookingSlot"]) app.click(app.action(name));
  app.click(app.one("#bookingSubmitBtn"));
  await app.idle();
  app.panel("booking_done");
  assert.match(new URL(app.one("#bookingWhatsAppLink").href).searchParams.get("text"), /意向門市：荃灣/);
  assert.match(app.one("#panelBody").textContent, /另一個分頁/);
});

test("blocked tab notifications leave successful unlock and booking usable", async t => {
  const app = await quiz(t, { saved: { step: "checkout", user, textFirst: true }, connectedTabs: true, blockTabMessages: true });
  app.click(app.one("#unlockBtn"));
  await app.idle();
  app.panel("report1");
  app.click(app.one("#panelFooter .btn-primary"));
  for (const name of ["selectBookingStore", "selectBookingDate", "selectBookingSlot"]) app.click(app.action(name));
  app.click(app.one("#bookingSubmitBtn"));
  await app.idle();
  app.panel("booking_done");
  assert.ok(app.one("#bookingWhatsAppLink"));
});

test("an accepted booking whose response was lost can be retried after its slot expires", async t => {
  const actualDate = Date;
  let time = Date.now();
  class BrowserDate extends actualDate {
    constructor(...args) { super(...(args.length ? args : [time])); }
    static now() { return time; }
  }
  globalThis.Date = BrowserDate;
  t.after(() => { globalThis.Date = actualDate; });
  let drop = true;
  const app = await quiz(t, { saved: await unlockedDraft(), submit: async (body, request) => {
    const response = await realSubmit(body, request);
    if (body.event_type === "booking_intent" && drop) {
      drop = false;
      throw new TypeError("Response lost");
    }
    return response;
  } });
  for (const action of ["selectBookingStore", "selectBookingDate", "selectBookingSlot"]) app.click(app.action(action));
  app.click(app.one("#bookingSubmitBtn"));
  await app.idle();
  app.panel("booking");
  const [original] = app.posts();
  time += 15 * 86400000;
  app.click(app.one("#bookingSubmitBtn"));
  await app.idle();
  app.panel("booking_done");
  assert.deepEqual(app.posts(), [original, original]);
  assert.ok(new URL(app.one("#bookingWhatsAppLink").href).searchParams.get("text").includes(original.booking.date));
});

test("the original credentials reopen a stored legacy booking when the local unlock flag is missing", async t => {
  const booking = { store: "灣仔", date: "2024-05-04", weekday: "星期六", timeSlot: "11am-1pm" };
  const saved = { ...await unlockedDraft("2024-05-01T02:00:00.000Z", booking), step: "booking_done", paidLocked: false };
  const app = await quiz(t, { saved });
  app.panel("booking_done");
  const text = new URL(app.one("#bookingWhatsAppLink").href).searchParams.get("text");
  assert.ok(text.includes(saved.submissionId));
  assert.ok(text.includes(booking.date));
});

test("failed anonymous analytics never obstruct answering and never copy URL parameters", async t => {
  const app = await quiz(t, { search: "?src=personal%40example.com&day=unknown", event: () => { throw new TypeError("offline"); } });
  app.click(app.all("#videoControls button").find(el => el.textContent === directCopy));
  app.panel("q1");
  await app.idle();
  assert.deepEqual(app.events().map(e => [e.event, e.platform, e.reel]), [["landing", "unknown", "01"], ["start", "unknown", "01"]]);
  assert.equal(JSON.stringify(app.events()).includes("example.com"), false);
  for (const { request } of app.requests) {
    assert.equal(request.referrerPolicy, "no-referrer");
    assert.equal(request.credentials, "omit");
  }
});
