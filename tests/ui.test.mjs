import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import { PGlite } from "@electric-sql/pglite";
import { createApplication } from "../server/app.mjs";

// DOM integration tests, not a substitute for mobile/browser visual QA.
test("client interface: real authentication, reload, network failure, recovery, tables, and submission", async () => {
  const origin = "http://localhost:3010",
    db = new PGlite();
  let dom,
    cookie = "",
    offline = false,
    invalidResponse = false;
  const query = async (text, params) => {
    const r = await db.query(
      typeof text === "string" ? text : text.text,
      params || text.values,
    );
    return { ...r, rowCount: r.affectedRows ?? r.rows.length };
  };
  const app = createApplication({
    pool: { query, connect: async () => ({ query, release() {} }) },
    origin,
    secret: "dom-tests-only-not-production-secret-12345",
    production: false,
  });
  await app.initialize();
  await app.bootstrapAdmin({
    name: "介面測試管理員",
    email: "ui-admin@example.test",
    password: "Ui-admin-test-password!",
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (path, options = {}) => {
    if (offline) throw new TypeError("測試斷線，請重試");
    if (invalidResponse && options.method === "PUT")
      return new Response("<html>connection interrupted</html>", {
        status: 200,
      });
    const headers = new Headers(options.headers);
    headers.set("origin", origin);
    if (cookie) headers.set("cookie", cookie);
    const response = await app.fetch(
      new Request(origin + path, { ...options, headers }),
    );
    for (const value of response.headers.getSetCookie()) {
      const [keyval] = value.split(";"),
        index = keyval.indexOf("="),
        name = keyval.slice(0, index);
      const jar = Object.fromEntries(
        cookie
          .split("; ")
          .filter(Boolean)
          .map((x) => {
            const i = x.indexOf("=");
            return [x.slice(0, i), x.slice(i + 1)];
          }),
      );
      if (/max-age=0/i.test(value) || !keyval.slice(index + 1))
        delete jar[name];
      else jar[name] = keyval.slice(index + 1);
      cookie = Object.entries(jar)
        .map(([k, v]) => k + "=" + v)
        .join("; ");
    }
    return response;
  };
  async function open() {
    dom?.window.close();
    dom = new JSDOM(
      await readFile(new URL("../intake/index.html", import.meta.url), "utf8"),
      { url: origin + "/intake/" },
    );
    globalThis.window = dom.window;
    globalThis.document = dom.window.document;
    globalThis.location = dom.window.location;
    globalThis.Option = dom.window.Option;
    dom.window.scrollTo = () => {};
    await import("../intake/app.mjs?run=" + Math.random());
  }
  const text = () => document.querySelector("#root").textContent;
  const wait = async (predicate) => {
    for (let i = 0; i < 120; i++) {
      if (predicate()) return;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error("Timed out. UI text: " + text().slice(-250));
  };
  const click = (label) => {
    const node = [...document.querySelectorAll("button")].find(
      (n) => n.textContent === label && !n.hidden,
    );
    assert.ok(node, "button " + label);
    node.click();
  };
  const set = (node, value) => {
    assert.ok(node);
    node.value = value;
    node.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  };
  const submit = (form) =>
    form.dispatchEvent(
      new dom.window.Event("submit", { bubbles: true, cancelable: true }),
    );
  async function login(email, password) {
    set(document.querySelector("input[type=email]"), email);
    set(document.querySelector("input[type=password]"), password);
    submit(document.querySelector("form"));
  }
  async function saved() {
    await wait(
      () => document.querySelector(".save-status")?.dataset.state === "saved",
    );
  }
  try {
    await open();
    assert.match(text(), /登入你的記錄/);
    assert.equal(
      document
        .querySelector("input[type=email]")
        .getAttribute("autocapitalize"),
      "none",
    );
    click("顯示密碼");
    assert.equal(
      document.querySelector('input[autocomplete="current-password"]').type,
      "text",
    );
    click("隱藏密碼");
    await login("ui-admin@example.test", "Ui-admin-test-password!");
    await wait(() => text().includes("客人健康記錄"));
    click("＋ 建立客人帳號");
    const form = document.querySelector(".modal form");
    set(form.querySelector("input[type=text]"), "介面測試客人");
    set(form.querySelector("input[type=email]"), "ui-client@example.test");
    set(form.querySelector("input[type=password]"), "Ui-client-test-password!");
    submit(form);
    await wait(
      () =>
        !document.querySelector(".modal") &&
        text().includes("ui-client@example.test"),
    );
    click("登出");
    await wait(() => text().includes("登入你的記錄"));
    await login("ui-client@example.test", "Ui-client-test-password!");
    await wait(() => !!document.querySelector("#field-clientName"));
    set(
      document.querySelector("#field-clientName"),
      "<img src=x onerror=alert(1)> 測試",
    );
    click("儲存進度");
    await saved();
    assert.equal(document.querySelectorAll("#root img").length, 0);
    click("下一部分 →");
    await wait(() => !!document.querySelector("#field-bowelFrequency"));
    await saved();
    const checkbox = [...document.querySelectorAll(".option input")].find(
      (n) => n.value === "乾硬／粒狀",
    );
    checkbox.click();
    set(
      document.querySelector("#field-bowelFrequency"),
      "每三天一次（虛構測試）",
    );
    click("儲存進度");
    await saved();
    click("儲存並離開");
    await wait(() => text().includes("登入你的記錄"));
    assert.match(text(), /進度已儲存/);
    await open();
    await login("ui-client@example.test", "Ui-client-test-password!");
    await wait(() => !!document.querySelector("#field-bowelFrequency"));
    await open();
    assert.equal(
      document.querySelector("#field-bowelFrequency").value,
      "每三天一次（虛構測試）",
    );
    assert.equal(
      document.querySelector('input[value="乾硬／粒狀"]').checked,
      true,
    );
    invalidResponse = true;
    set(
      document.querySelector("#field-bowelFrequency"),
      "等待伺服器確認的答案",
    );
    click("儲存並離開");
    await wait(
      () => document.querySelector(".save-status")?.dataset.state === "error",
    );
    assert.equal(
      document.querySelector("#field-bowelFrequency").value,
      "等待伺服器確認的答案",
    );
    assert.doesNotMatch(text(), /登入你的記錄/);
    invalidResponse = false;
    click("重試儲存");
    await saved();
    offline = true;
    set(document.querySelector("#field-bowelFrequency"), "離線未儲存答案");
    click("儲存並離開");
    await wait(
      () => document.querySelector(".save-status")?.dataset.state === "error",
    );
    assert.equal(
      document.querySelector("#field-bowelFrequency").value,
      "離線未儲存答案",
    );
    assert.doesNotMatch(text(), /登入你的記錄/);
    assert.doesNotMatch(
      document.querySelector(".save-status").textContent,
      /^已儲存/,
    );
    offline = false;
    click("重試儲存");
    await saved();
    await open();
    assert.equal(
      document.querySelector("#field-bowelFrequency").value,
      "離線未儲存答案",
    );
    // Expire the server session while retaining the unsaved DOM values.
    await app.fetch(
      new Request(origin + "/api/health-intake/auth/sign-out", {
        method: "POST",
        headers: { origin, cookie, "content-type": "application/json" },
        body: "{}",
      }),
    );
    set(
      document.querySelector("#field-bowelFrequency"),
      "登入過期時保留的答案",
    );
    click("儲存進度");
    await wait(
      () => document.querySelector(".save-status")?.dataset.state === "error",
    );
    click("重新登入");
    const reauth = document.querySelector(".modal form");
    set(reauth.querySelector("input[type=email]"), "ui-client@example.test");
    set(
      reauth.querySelector("input[type=password]"),
      "Ui-client-test-password!",
    );
    submit(reauth);
    await wait(() => !document.querySelector(".modal"));
    click("重試儲存");
    await saved();
    await open();
    assert.equal(
      document.querySelector("#field-bowelFrequency").value,
      "登入過期時保留的答案",
    );
    click("下一部分 →");
    await wait(() => !!document.querySelector("#field-fluidLimit"));
    const first = document.querySelector(".row-card input");
    set(first, "2026-01-01");
    click("儲存進度");
    await saved();
    await open();
    assert.equal(document.querySelector(".row-card input").value, "2026-01-01");
    // Another tab updates the same draft. A stale tab must be able to discard and log out.
    const session = await (await fetch("/api/health-intake/session")).json();
    const current = await (await fetch("/api/health-intake/record")).json();
    const otherTab = await fetch("/api/health-intake/record", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        accountId: session.user.id,
        version: current.version,
        step: current.step,
        answers: current.answers,
      }),
    });
    assert.equal(otherTab.status, 200);
    set(document.querySelector(".row-card input"), "舊分頁未儲存內容");
    click("儲存進度");
    await wait(
      () => document.querySelector(".save-status")?.dataset.state === "error",
    );
    click("登出");
    await wait(() => !!document.querySelector(".modal"));
    assert.match(
      document.querySelector(".modal").textContent,
      /還有答案未儲存/,
    );
    click("捨棄未儲存內容並登出");
    await wait(() => text().includes("登入你的記錄"));
    await login("ui-client@example.test", "Ui-client-test-password!");
    await wait(() => !!document.querySelector(".row-card input"));
    assert.equal(document.querySelector(".row-card input").value, "2026-01-01");
    const picker = document.querySelector(".chapter-select");
    picker.value = "7";
    picker.dispatchEvent(new dom.window.Event("change"));
    await wait(() => !!document.querySelector(".consent input"));
    await saved();
    assert.equal(document.querySelectorAll("#root img").length, 0);
    assert.match(text(), /<img src=x onerror=alert\(1\)> 測試/);
    document.querySelector(".consent input").click();
    click("確認提交");
    await wait(() => text().includes("已收到，謝謝你的記錄。"));
    assert.equal(
      document.querySelectorAll("#root textarea,#root input").length,
      0,
    );
    await open();
    assert.match(text(), /你的健康記錄已提交/);
    click("更改密碼");
    const passwordForm = document.querySelector(".modal form");
    const passwordFields = passwordForm.querySelectorAll("input");
    set(passwordFields[0], "Ui-client-test-password!");
    set(passwordFields[1], "Ui-client-updated-password!");
    set(passwordFields[2], "Ui-client-updated-password!");
    submit(passwordForm);
    await wait(() => !document.querySelector(".modal"));
    click("登出");
    await wait(() => text().includes("登入你的記錄"));
    assert.doesNotMatch(text(), /離線未儲存答案/);
    await login("ui-client@example.test", "Ui-client-updated-password!");
    await wait(() => text().includes("你的健康記錄已提交"));
    click("登出");
    await wait(() => text().includes("登入你的記錄"));
  } finally {
    globalThis.fetch = originalFetch;
    dom?.window.close();
    await db.close();
  }
});
