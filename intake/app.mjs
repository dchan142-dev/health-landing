import { sections, hasValue, progress } from "./schema.mjs";

const root = document.querySelector("#root"),
  account = document.querySelector("#account");
const apiBase = "/api/health-intake";
let user,
  record,
  answers = {},
  step = 0,
  revision = 0,
  savedRevision = 0,
  saving = null,
  timer,
  leaving = false,
  conflict = false,
  saveError = "";
const el = (tag, cls, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
};
const button = (label, action, cls = "secondary") => {
  const node = el("button", "btn " + cls, label);
  node.type = "button";
  node.addEventListener("click", action);
  return node;
};
const heading = (tag, text) => el(tag, "", text);
const date = (value) =>
  value ? new Date(value).toLocaleString("zh-HK") : "尚未儲存";
const dirty = () => revision !== savedRevision;
async function api(path, { method = "GET", body } = {}) {
  const controller = new AbortController(),
    timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(apiBase + path, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      headers: body === undefined ? {} : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    let data;
    try {
      data = await response.json();
    } catch {
      throw new Error("伺服器回覆不完整，未確認儲存。請保留這頁，再重試。");
    }
    if (!response.ok) {
      const error = new Error(
        data.error?.message ||
          data.error ||
          (response.status === 401
            ? "登入已過期，請重新登入"
            : "連線未能完成，請稍後重試"),
      );
      error.status = response.status;
      throw error;
    }
    return data;
  } catch (error) {
    if (controller.signal.aborted)
      throw new Error("連線逾時，未確認儲存。請保留這頁，再重試。");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
function toast(message) {
  const node = document.querySelector("#toast");
  node.textContent = message;
  node.hidden = false;
  setTimeout(() => {
    node.hidden = true;
  }, 4500);
}
function field(label, type = "text", autocomplete = "off") {
  const wrap = el("div", "field"),
    id = "input-" + crypto.randomUUID(),
    input = el("input");
  input.id = id;
  input.type = type;
  input.autocomplete = autocomplete;
  const title = el("label", "", label);
  title.htmlFor = id;
  if (type === "email") {
    input.inputMode = "email";
    input.setAttribute("autocapitalize", "none");
    input.spellcheck = false;
  }
  if (type === "password") {
    const control = el("div", "password-control");
    const toggle = button(
      "顯示密碼",
      () => {
        const visible = input.type === "password";
        input.type = visible ? "text" : "password";
        toggle.textContent = visible ? "隱藏密碼" : "顯示密碼";
        toggle.setAttribute("aria-pressed", String(visible));
      },
      "quiet password-toggle",
    );
    toggle.setAttribute("aria-pressed", "false");
    toggle.setAttribute("aria-controls", id);
    control.append(input, toggle);
    wrap.append(title, control);
  } else wrap.append(title, input);
  return { wrap, input };
}
function errorBox(parent) {
  const node = el("p", "error");
  node.setAttribute("role", "alert");
  node.hidden = true;
  parent.append(node);
  return (message) => {
    node.textContent = message;
    node.hidden = !message;
  };
}
function modal(title) {
  const overlay = el("div", "modal-wrap"),
    panel = el("section", "modal"),
    top = el("div", "modal-head");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  const titleNode = heading("h2", title);
  titleNode.id = "dialog-" + crypto.randomUUID();
  panel.setAttribute("aria-labelledby", titleNode.id);
  const previous = document.activeElement,
    close = () => {
      overlay.remove();
      previous?.focus();
    };
  top.append(titleNode, button("關閉", close, "quiet"));
  panel.append(top);
  overlay.append(panel);
  document.body.append(overlay);
  const onKey = (event) => {
    if (event.key === "Escape") {
      close();
    }
    if (event.key === "Tab") {
      const nodes = [
        ...panel.querySelectorAll("button,input,select,textarea,a[href]"),
      ].filter((n) => !n.disabled);
      if (event.shiftKey && document.activeElement === nodes[0]) {
        event.preventDefault();
        nodes.at(-1).focus();
      } else if (!event.shiftKey && document.activeElement === nodes.at(-1)) {
        event.preventDefault();
        nodes[0].focus();
      }
    }
  };
  overlay.addEventListener("keydown", onKey);
  setTimeout(() => panel.querySelector("input,button")?.focus(), 0);
  return { panel, close };
}
function loginForm(parent, onSuccess) {
  const form = el("form"),
    email = field("登入電郵", "email", "username"),
    password = field("密碼", "password", "current-password");
  email.input.required = password.input.required = true;
  const submit = el("button", "btn primary full", "登入");
  submit.type = "submit";
  form.append(email.wrap, password.wrap, submit);
  const showError = errorBox(form);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    submit.disabled = true;
    submit.textContent = "登入中…";
    showError("");
    try {
      await api("/auth/sign-in/email", {
        method: "POST",
        body: {
          email: email.input.value.trim(),
          password: password.input.value,
        },
      });
      password.input.value = "";
      await onSuccess();
    } catch (error) {
      showError(
        error.status === 401 ? "電郵或密碼不正確，請重試。" : error.message,
      );
    } finally {
      submit.disabled = false;
      submit.textContent = "登入";
    }
  });
  parent.append(
    form,
    button(
      "忘記密碼？",
      () => {
        const { panel } = modal("重設登入密碼");
        panel.append(
          el("p", "", "請透過原有聯絡方法，私下聯絡提供帳號的跟進者。"),
          el(
            "p",
            "help",
            "跟進者核實身份後，會提供新密碼；你不需要交出舊密碼。重設後其他裝置會登出，已儲存的問卷仍會保留。",
          ),
        );
      },
      "quiet forgot-password",
    ),
    el(
      "p",
      "help",
      "帳號由跟進者提供。如忘記密碼，請私下聯絡跟進者重設。請勿共用帳號。",
    ),
  );
}
function showLogin(message = "") {
  user = null;
  account.replaceChildren();
  const layout = el("div", "login-layout"),
    welcome = el("section", "welcome"),
    card = el("section", "login-card");
  welcome.append(
    el("p", "eyebrow", "YOUR HEALTH, STEP BY STEP"),
    heading("h1", "按你的步伐，慢慢填。"),
    el(
      "p",
      "muted",
      "可以分次填寫。每次離開前儲存，下次登入便可接續原來的部分。",
    ),
  );
  const steps = el("ol", "welcome-steps");
  for (const text of [
    "用專屬帳號登入",
    "分段填寫，進度自動儲存",
    "確認提交，方便跟進",
  ])
    steps.append(el("li", "", text));
  welcome.append(
    steps,
    el(
      "p",
      "note",
      "不清楚的問題可留空或填「不清楚」。照原有醫囑服藥及飲食，毋須為填表改變安排。",
    ),
  );
  card.append(
    el("p", "eyebrow", "PRIVATE CLIENT AREA"),
    heading("h2", "登入你的記錄"),
  );
  if (message) card.append(el("p", "note", message));
  loginForm(card, load);
  card.append(
    el(
      "p",
      "note",
      "這份記錄用於 HealthDecoder 健康情況整理及跟進。開始儲存草稿後，指定管理員便可查看答案；資料會儲存在本站及其資料庫服務。若需查閱、更正、撤回或刪除，請聯絡提供帳號的跟進者。",
    ),
  );
  layout.append(card, welcome);
  root.replaceChildren(layout);
}
function reauthenticate() {
  const { panel, close } = modal("重新登入，保留這頁未儲存答案");
  panel.append(
    el(
      "p",
      "help",
      "請使用同一帳號登入。這頁的答案會保留在目前畫面；完成登入後按「重試儲存」。",
    ),
  );
  loginForm(panel, async () => {
    const current = await api("/session");
    if (current.user.id !== user.id) {
      await api("/auth/sign-out", { method: "POST", body: {} });
      throw new Error("請使用原本的帳號登入，避免儲存到其他人的記錄。");
    }
    close();
    toast("已重新登入，可重試儲存。");
  });
}
function renderAccount() {
  const menu = el("details", "account-menu"),
    summary = el("summary", "", "帳號"),
    items = el("div", "account-menu-items");
  items.append(
    el("p", "help", user.name),
    button("更改密碼", changePassword, "quiet"),
    button("登出", logout, "quiet"),
  );
  menu.append(summary, items);
  account.replaceChildren(menu);
}
async function saveAndExit() {
  if (leaving) return;
  leaving = true;
  root.inert = account.inert = true;
  try {
    if (record.version === 0 && !dirty()) revision++;
    await flush();
    await endSession("進度已儲存。下次用同一帳號登入，即可繼續填寫。");
  } catch (error) {
    toast("尚未儲存，請保留這頁。" + error.message);
  } finally {
    leaving = false;
    root.inert = account.inert = false;
  }
}
async function logout() {
  if (record && dirty()) {
    try {
      await flush();
    } catch (error) {
      const { panel, close } = modal("還有答案未儲存");
      panel.append(
        el("p", "error", error.message),
        el(
          "p",
          "help",
          "可先下載目前答案私下保存。捨棄後只會保留伺服器最後成功儲存的版本。",
        ),
        button("下載目前答案", () => download(answers), "secondary"),
        button(
          "捨棄未儲存內容並登出",
          async () => {
            if (await endSession()) close();
          },
          "primary",
        ),
      );
      return;
    }
  }
  await endSession();
}
async function endSession(message = "") {
  try {
    await api("/auth/sign-out", { method: "POST", body: {} });
    clearTimeout(timer);
    record = null;
    answers = {};
    revision = savedRevision = 0;
    showLogin(message);
    return true;
  } catch (error) {
    toast("未能登出：" + error.message);
    return false;
  }
}
function changePassword() {
  const { panel, close } = modal("更改登入密碼"),
    form = el("form"),
    old = field("目前密碼", "password", "current-password"),
    next = field("新密碼（最少12字元）", "password", "new-password"),
    repeat = field("再次輸入新密碼", "password", "new-password");
  for (const item of [old, next, repeat]) item.input.required = true;
  next.input.minLength = repeat.input.minLength = 12;
  next.input.maxLength = repeat.input.maxLength = 128;
  const submit = el("button", "btn primary", "儲存新密碼");
  submit.type = "submit";
  form.append(old.wrap, next.wrap, repeat.wrap, submit);
  const showError = errorBox(form);
  form.onsubmit = async (event) => {
    event.preventDefault();
    if (next.input.value !== repeat.input.value)
      return showError("兩次新密碼不一致。");
    submit.disabled = true;
    try {
      await api("/auth/change-password", {
        method: "POST",
        body: {
          currentPassword: old.input.value,
          newPassword: next.input.value,
          revokeOtherSessions: true,
        },
      });
      close();
      toast("密碼已更新，其他裝置需要重新登入。");
    } catch (error) {
      showError(error.message);
    } finally {
      submit.disabled = false;
    }
  };
  panel.append(form);
}
function mark() {
  revision++;
  if (!conflict) saveError = "";
  updateStatus();
  clearTimeout(timer);
  if (!conflict) timer = setTimeout(() => flush().catch(() => {}), 900);
}
async function flush() {
  clearTimeout(timer);
  if (conflict) throw new Error("版本有衝突，請先下載未儲存答案，再重新載入。");
  if (saving) return saving;
  saving = (async () => {
    while (dirty()) {
      const target = revision,
        snapshot = structuredClone(answers),
        currentStep = step;
      updateStatus("saving");
      try {
        const result = await api("/record", {
          method: "PUT",
          body: {
            accountId: user.id,
            version: record.version,
            step: currentStep,
            answers: snapshot,
          },
        });
        record = { ...result, answers };
        savedRevision = target;
        saveError = "";
      } catch (error) {
        saveError = error.message;
        conflict = error.status === 409 || error.status === 423;
        updateStatus("error");
        throw error;
      }
    }
  })();
  try {
    await saving;
  } finally {
    saving = null;
    updateStatus();
  }
}
function updateStatus(force) {
  document.querySelectorAll(".save-status").forEach((node) => {
    const state =
      force ||
      (saveError ? "error" : saving ? "saving" : dirty() ? "pending" : "saved");
    node.dataset.state = state;
    node.textContent =
      state === "error"
        ? "未確認儲存：" + saveError
        : state === "saving"
          ? "正在儲存…"
          : state === "pending"
            ? "有更改，等候儲存…"
            : record?.updatedAt
              ? "已儲存 · " + date(record.updatedAt)
              : "未開始填寫";
  });
  const p = progress(answers);
  document
    .querySelectorAll("[data-count]")
    .forEach((n) => (n.textContent = `${p.filled} / ${p.total}`));
  document.querySelectorAll("progress").forEach((n) => (n.value = p.filled));
  document
    .querySelectorAll("[data-retry]")
    .forEach((n) => (n.hidden = !saveError || conflict));
  document
    .querySelectorAll("[data-login]")
    .forEach((n) => (n.hidden = !saveError || conflict));
}
function saveTools() {
  const box = el("div", "hero-tools"),
    state = el("p", "save-status");
  state.setAttribute("role", "status");
  const retry = button(
    "重試儲存",
    async () => {
      try {
        await flush();
        toast("已儲存。");
      } catch {}
    },
    "quiet",
  );
  retry.dataset.retry = "";
  retry.hidden = true;
  const login = button("重新登入", reauthenticate, "quiet");
  login.dataset.login = "";
  login.hidden = true;
  const extra = el("details", "extra-tools"),
    summary = el("summary", "", "其他功能");
  extra.append(
    summary,
    button("下載目前答案", () => download(answers), "quiet"),
  );
  box.append(
    state,
    retry,
    login,
    button("儲存並離開", saveAndExit, "secondary save-exit"),
    extra,
  );
  return box;
}
function download(value) {
  const url = URL.createObjectURL(
    new Blob(
      [
        JSON.stringify(
          {
            format: "health-decoder-intake-v1",
            exportedAt: new Date().toISOString(),
            saveConfirmed: !dirty() && !saveError,
            answers: value,
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    ),
  );
  const a = el("a");
  a.href = url;
  a.download =
    "health-record-" + new Date().toISOString().slice(0, 10) + ".json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast("下載內容包含健康資料，請存放在私人裝置。");
}
async function navigate(next) {
  if (next === step) return;
  try {
    await flush();
    step = next;
    revision++;
    renderForm();
    root.querySelector("h2")?.focus();
    window.scrollTo({ top: 0, behavior: "smooth" });
    await flush();
  } catch (error) {
    toast(error.message);
  }
}
function renderForm() {
  root.replaceChildren();
  const hero = el("section", "hero");
  hero.append(
    el("p", "eyebrow", "MY HEALTH RECORD"),
    heading(
      "h1",
      record.status === "submitted" ? "你的健康記錄已提交" : "我的健康記錄",
    ),
    el("p", "muted", "可分次填寫。離開前請確認「已儲存」，下次登入便可續填。"),
  );
  if (record.status === "draft") hero.append(saveTools());
  root.append(hero);
  if (record.status === "submitted") {
    const note = el("div", "submitted");
    note.append(
      el("span", "mark", "✓"),
      heading("h2", "已收到，謝謝你的記錄。"),
      el(
        "p",
        "",
        `提交時間：${date(record.submittedAt)}。如需修正或繼續三天記錄，請聯絡跟進者重開。`,
      ),
    );
    root.append(
      note,
      review(answers),
      button("列印／另存PDF", () => window.print(), "secondary"),
    );
    return;
  }
  const workspace = el("div", "workspace"),
    sidebar = el("aside", "sidebar"),
    sheet = el("section", "sheet");
  const card = el("div", "progress-card"),
    p = progress(answers),
    count = el("span", "progress-count", `${p.filled} / ${p.total}`);
  count.dataset.count = "";
  const bar = el("progress");
  bar.max = 22;
  bar.value = p.filled;
  bar.setAttribute("aria-label", "有填寫的題組");
  card.append(
    el("p", "help", "有填寫的題組"),
    count,
    bar,
    el("p", "help", "未填／不清楚也可提交。"),
  );
  const nav = el("div", "chapter-picker"),
    pickerLabel = el("label", "", "跳到其他部分"),
    picker = el("select", "chapter-select");
  picker.id = "chapter-select";
  pickerLabel.htmlFor = picker.id;
  [...sections.map((s) => s.short), "確認與提交"].forEach((label, index) => {
    picker.append(new Option(index + 1 + " / 8 · " + label, String(index)));
  });
  picker.value = String(step);
  picker.addEventListener("change", async () => {
    await navigate(Number(picker.value));
    picker.value = String(step);
  });
  nav.append(pickerLabel, picker);
  sidebar.append(
    card,
    nav,
    el(
      "p",
      "help",
      "現正胸痛、嚴重氣促或昏厥，請先尋求緊急醫療協助。這份問卷不提供即時監察。",
    ),
  );
  const title = heading("h2", step < 7 ? sections[step].title : "確認你的記錄");
  title.tabIndex = -1;
  const sheetHeading = el("div", "sheet-heading");
  sheetHeading.append(el("p", "eyebrow", `STEP ${step + 1} OF 8`), title);
  sheet.append(sheetHeading);
  if (step < 7) {
    const section = sections[step];
    sheetHeading.append(el("p", "muted", section.intro));
    section.groups.forEach((group) => {
      const box = el("section", "question");
      box.append(heading("h3", group.title));
      if (group.hint) box.append(el("p", "note", group.hint));
      for (const f of group.fields) box.append(renderField(f));
      sheet.append(box);
    });
  } else {
    sheetHeading.append(
      el(
        "p",
        "muted",
        "確認稱呼及內容後提交。未填的項目會保留空白，跟進者可再與你核實。",
      ),
    );
    sheet.append(review(answers));
    const label = el("label", "consent"),
      check = el("input");
    check.type = "checkbox";
    check.checked = answers.consent === true;
    check.addEventListener("change", () => {
      answers.consent = check.checked;
      mark();
    });
    label.append(
      check,
      el(
        "span",
        "",
        "我同意將本問卷的健康、用藥及生活資料交予 HealthDecoder 指定跟進者，用於了解情況及後續跟進。資料會由本站及其資料庫服務供應商儲存；如需查閱、更正、撤回同意或刪除，請聯絡提供帳號的跟進者。我明白問卷不作診斷，也不會自動改變醫療安排。",
      ),
    );
    sheet.append(
      label,
      el(
        "p",
        "help",
        "從開始儲存草稿起，指定管理員可查看已儲存的答案。請勿填身份證、完整住址、付款資料，或其他人的健康資料。",
      ),
    );
  }
  const controls = el("div", "sheet-nav"),
    next = el("div", "nav-next");
  if (step > 0) {
    const previous = button("←", () => navigate(step - 1), "quiet previous");
    previous.setAttribute("aria-label", "上一部分");
    controls.append(previous);
  }
  controls.append(
    button(
      "儲存進度",
      async () => {
        try {
          await flush();
          toast("進度已儲存。");
        } catch (error) {
          toast(error.message);
        }
      },
      "secondary",
    ),
  );
  if (step < 7)
    next.append(
      button(
        step === 6 ? "檢查並提交 →" : "下一部分 →",
        () => navigate(step + 1),
        "primary",
      ),
    );
  else next.append(button("確認提交", submitRecord, "primary"));
  controls.append(next);
  sheet.append(controls);
  workspace.append(sidebar, sheet);
  root.append(workspace);
  updateStatus();
}
function renderField(f) {
  const wrap = el(f.type === "multi" ? "fieldset" : "div", "field"),
    id = "field-" + f.id;
  let input;
  const label = el(f.type === "multi" ? "legend" : "label", "", f.label);
  if (f.type !== "multi" && f.type !== "table") label.htmlFor = id;
  wrap.append(label);
  if (f.type === "multi") {
    const options = el("div", "option-grid");
    for (const value of f.options) {
      const item = el("label", "option"),
        check = el("input");
      check.type = "checkbox";
      check.value = value;
      check.checked = (answers[f.id] || []).includes(value);
      check.onchange = () => {
        let values = [...(answers[f.id] || [])].filter((x) => x !== value);
        const exclusive = (x) => /^(沒有|不清楚|未有)/.test(x);
        if (check.checked)
          values = exclusive(value)
            ? [value]
            : [...values.filter((x) => !exclusive(x)), value];
        answers[f.id] = values;
        options
          .querySelectorAll("input")
          .forEach((n) => (n.checked = values.includes(n.value)));
        mark();
      };
      item.append(check, el("span", "", value));
      options.append(item);
    }
    wrap.append(options);
    return wrap;
  }
  if (f.type === "table") {
    const rows = el("div");
    let values = answers[f.id] || [f.columns.map(() => "")];
    const redraw = () => {
      rows.replaceChildren();
      values.forEach((row, index) => {
        const card = el("div", "row-card"),
          top = el("div", "row-head");
        top.append(
          el("strong", "", `第 ${index + 1} 筆`),
          button(
            "移除",
            () => {
              values.splice(index, 1);
              answers[f.id] = values;
              mark();
              redraw();
            },
            "quiet",
          ),
        );
        const fields = el("div", "row-fields");
        f.columns.forEach((column, i) => {
          const cell = field(column);
          cell.input.value = row[i];
          cell.input.maxLength = 2000;
          cell.input.oninput = () => {
            values[index][i] = cell.input.value;
            answers[f.id] = values;
            mark();
          };
          fields.append(cell.wrap);
        });
        card.append(top, fields);
        rows.append(card);
      });
    };
    redraw();
    wrap.append(
      rows,
      button(
        "＋ 新增一筆",
        () => {
          if (values.length >= 60) return toast("每組最多60筆。");
          values.push(f.columns.map(() => ""));
          answers[f.id] = values;
          mark();
          redraw();
        },
        "quiet table-add",
      ),
    );
    return wrap;
  }
  if (f.type === "select") {
    input = el("select");
    input.append(new Option("請選擇／稍後補充", ""));
    for (const value of f.options) input.append(new Option(value, value));
  } else if (f.type === "textarea") {
    input = el("textarea");
    input.rows = 3;
    input.maxLength = 10000;
  } else {
    input = el("input");
    input.type = f.type;
    input.maxLength = 10000;
  }
  input.id = id;
  if (["height", "age", "currentWeight"].includes(f.id))
    input.inputMode = "decimal";
  input.value = answers[f.id] || "";
  if (f.placeholder) input.placeholder = f.placeholder;
  input.addEventListener(f.type === "select" ? "change" : "input", () => {
    answers[f.id] = input.value;
    mark();
  });
  wrap.append(input);
  return wrap;
}
function review(value) {
  const container = el("div", "review");
  container.append(heading("h2", "健康資料記錄"));
  for (const section of sections) {
    const block = el("section", "review-section");
    block.append(heading("h3", section.title));
    for (const group of section.groups) {
      for (const f of group.fields) {
        const row = el("div", "review-row"),
          answer = value[f.id];
        row.append(el("div", "review-label", f.label));
        let text = "未填寫";
        if (hasValue(answer)) {
          if (f.type === "table")
            text = answer
              .filter(hasValue)
              .map(
                (cells, i) =>
                  `${i + 1}. ` +
                  cells
                    .map((cell, k) => `${f.columns[k]}：${cell || "—"}`)
                    .join(" ／ "),
              )
              .join("\n");
          else if (Array.isArray(answer)) text = answer.join("、");
          else text = answer;
        }
        row.append(
          el("div", "review-value" + (hasValue(answer) ? "" : " blank"), text),
        );
        block.append(row);
      }
    }
    container.append(block);
  }
  return container;
}
async function submitRecord() {
  if (!answers.clientName?.trim())
    return toast("請先在「基本與目標」填寫你的稱呼。");
  if (!answers.consent) return toast("請先閱讀及勾選資料使用確認。");
  root.inert = true;
  try {
    await flush();
    record = await api("/submit", {
      method: "POST",
      body: { accountId: user.id, version: record.version },
    });
    answers = record.answers;
    renderForm();
    window.scrollTo(0, 0);
  } catch (error) {
    toast(error.message);
  } finally {
    root.inert = false;
  }
}
async function renderAdmin() {
  root.replaceChildren(el("p", "loading", "載入客人記錄…"));
  try {
    const { records } = await api("/admin/records"),
      head = el("section", "hero");
    head.append(
      el("p", "eyebrow", "CLIENT RECORDS"),
      heading("h1", "客人健康記錄"),
      el(
        "p",
        "muted",
        "每位客人使用獨立帳號。已儲存草稿也可查看，提交後需重開才可修改。",
      ),
    );
    const tools = el("div", "admin-head");
    tools.append(
      button("＋ 建立客人帳號", () => clientModal(), "primary"),
      button("更新列表", renderAdmin, "secondary"),
    );
    const list = el("div", "admin-list");
    if (!records.length)
      list.append(
        el("p", "empty", "還沒有客人帳號。先建立帳號，再把登入網址交給客人。"),
      );
    for (const row of records) {
      const card = el("article", "client-card"),
        info = el("div");
      info.append(
        heading("h3", row.name),
        el("p", "help", row.email),
        el(
          "p",
          "help",
          `有填寫 ${row.progress.filled} / ${row.progress.total} 題組 · ${date(row.updatedAt)}`,
        ),
      );
      const actions = el("div", "client-actions");
      actions.append(
        el(
          "span",
          "badge",
          { submitted: "已提交", draft: "草稿", not_started: "未開始" }[
            row.status
          ],
        ),
      );
      if (row.id)
        actions.append(button("查看記錄", () => viewClient(row), "secondary"));
      actions.append(button("重設密碼", () => clientModal(row), "quiet"));
      card.append(info, actions);
      list.append(card);
    }
    root.replaceChildren(head, tools, list);
  } catch (error) {
    root.replaceChildren(
      el("p", "error", error.message),
      button("重試", renderAdmin, "primary"),
    );
  }
}
function clientModal(client) {
  const { panel, close } = modal(client ? "重設客人密碼" : "建立客人帳號"),
    form = el("form"),
    name = field("稱呼"),
    email = field("登入電郵", "email"),
    password = field("設定密碼（12–128字元）", "password", "new-password");
  password.input.required = true;
  password.input.minLength = 12;
  password.input.maxLength = 128;
  if (!client) {
    name.input.required = email.input.required = true;
    name.input.maxLength = 100;
    form.append(name.wrap, email.wrap);
  } else form.append(el("p", "", client.name + " · " + client.email));
  form.append(
    password.wrap,
    el(
      "p",
      "help",
      "請透過私密渠道把密碼交給客人，並提醒登入後更改。重設密碼會登出客人的其他裝置。",
    ),
  );
  const submit = el("button", "btn primary", client ? "重設密碼" : "建立帳號");
  submit.type = "submit";
  form.append(submit);
  const showError = errorBox(form);
  form.onsubmit = async (event) => {
    event.preventDefault();
    submit.disabled = true;
    try {
      await api(client ? "/admin/reset-password" : "/admin/clients", {
        method: "POST",
        body: client
          ? { userId: client.userId, password: password.input.value }
          : {
              name: name.input.value,
              email: email.input.value,
              password: password.input.value,
            },
      });
      password.input.value = "";
      close();
      await renderAdmin();
      toast(
        client
          ? "密碼已重設。"
          : "帳號已建立。客人登入網址：" + location.origin + "/intake/",
      );
    } catch (error) {
      showError(error.message);
    } finally {
      submit.disabled = false;
    }
  };
  panel.append(form);
}
async function viewClient(client) {
  try {
    const detail = await api("/admin/records/" + client.id),
      hero = el("section", "hero");
    hero.append(
      el(
        "p",
        "eyebrow",
        detail.status === "submitted" ? "SUBMITTED RECORD" : "SAVED DRAFT",
      ),
      heading("h1", client.name + "的記錄"),
      el("p", "muted", "最後儲存：" + date(detail.updatedAt)),
    );
    const actions = el("div", "hero-tools");
    actions.append(
      button("← 返回列表", renderAdmin, "quiet"),
      button("列印／另存PDF", () => window.print(), "secondary"),
    );
    if (detail.status === "submitted")
      actions.append(
        button(
          "重開讓客人修改",
          async () => {
            try {
              await api("/admin/records/" + detail.id + "/reopen", {
                method: "POST",
                body: { version: detail.version },
              });
              await renderAdmin();
              toast("已重開，客人可登入續填。");
            } catch (error) {
              toast(error.message);
            }
          },
          "primary",
        ),
      );
    root.replaceChildren(hero, actions, review(detail.answers));
  } catch (error) {
    toast(error.message);
  }
}
async function load() {
  try {
    const current = await api("/session");
    user = current.user;
    renderAccount();
    if (user.role === "admin") {
      record = null;
      return renderAdmin();
    }
    record = await api("/record");
    answers = record.answers;
    step = record.step;
    revision = savedRevision = 0;
    conflict = false;
    saveError = "";
    renderForm();
  } catch (error) {
    if (error.status === 401) showLogin();
    else
      root.replaceChildren(
        el("p", "error", "目前未能連接記錄服務。" + error.message),
        button("重新連線", load, "primary"),
      );
  }
}
window.addEventListener("beforeunload", (event) => {
  if (dirty()) {
    event.preventDefault();
    event.returnValue = "";
  }
});
document.addEventListener("visibilitychange", () => {
  if (
    document.visibilityState === "hidden" &&
    record?.status === "draft" &&
    dirty()
  )
    flush().catch(() => {});
});
await load();
