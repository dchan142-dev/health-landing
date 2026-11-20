const status = document.querySelector("#status");
const signIn = document.querySelector("#sign-in");
const signInForm = signIn.querySelector("form");
const signInButton = signInForm.querySelector("button");
const signInLabel = signInButton.textContent;
const refresh = document.querySelector("#refresh");
const downloadCsv = document.querySelector("#download-csv");
const table = document.querySelector("#table");
const recordsList = document.querySelector("#records");
const search = document.querySelector("#record-search");
const searchWrap = document.querySelector("#search-wrap");
const timestamp = new Intl.DateTimeFormat("zh-HK", {
  dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Hong_Kong", hourCycle: "h23",
});
const progressLabels = {
  booking_intent: "已記錄預約意向",
  quiz_unlocked: "已解鎖報告",
  triage_aborted_level1: "已顯示安全提醒",
};
let records = [];

// Preserve table navigation for screen readers when mobile CSS displays rows as cards.
for (const [selector, role] of Object.entries({
  table: "table", thead: "rowgroup", tbody: "rowgroup", "thead tr": "row", th: "columnheader",
})) {
  for (const element of table.querySelectorAll(selector)) element.setAttribute("role", role);
}

function cell(row, label, content) {
  const td = row.insertCell();
  td.setAttribute("role", "cell");
  td.dataset.label = label;
  if (content instanceof Node) td.append(content);
  else td.textContent = content;
  return td;
}

function recordRow(record) {
  const row = document.createElement("tr");
  row.setAttribute("role", "row");
  const submitted = new Date(record.submitted_at);
  cell(row, "提交時間", Number.isFinite(submitted.getTime()) ? timestamp.format(submitted) : "—");
  cell(row, "稱呼", record.name || "—");

  const contact = document.createElement("div");
  for (const value of [record.email, record.phone].filter(Boolean)) {
    const line = document.createElement("span");
    line.textContent = value;
    contact.append(line);
  }
  cell(row, "電郵／WhatsApp", contact.childElementCount ? contact : "—").classList.add("contact");
  cell(row, "Reel Day", record.day_entry || "—");
  cell(row, "進度", progressLabels[record.event_type] || "—");

  const booking = record.booking;
  cell(row, "預約意向", booking
    ? [booking.store, booking.date, booking.weekday, booking.timeSlot].filter(Boolean).join(" · ")
    : "—");

  if (record.report_url) {
    const link = document.createElement("a");
    link.href = "/api/report-v2-pdf?" + new URLSearchParams({ id: record.submission_id.toLowerCase() });
    link.download = "";
    link.textContent = "下載 PDF";
    if (record.name) link.setAttribute("aria-label", `下載 PDF 報告（${record.name}）`);
    cell(row, "客人報告", link);
  } else {
    cell(row, "客人報告", "—");
  }
  return row;
}

function renderRecords() {
  const term = search.value.trim().toLowerCase();
  const matches = records.filter(({ submission_id, name, email, phone }) =>
    [submission_id, name, email, phone].some(value => value?.toLowerCase().includes(term)),
  );
  const rows = document.createDocumentFragment();
  for (const record of matches) rows.append(recordRow(record));
  recordsList.replaceChildren(rows);
  table.hidden = matches.length === 0;
  status.textContent = matches.length
    ? `共 ${matches.length} 筆紀錄。時間以香港時間顯示。`
    : records.length ? "搵唔到符合條件嘅紀錄。" : "暫未有 V2 問卷紀錄。";
}

async function load() {
  refresh.disabled = true;
  signIn.hidden = true;
  downloadCsv.hidden = true;
  searchWrap.hidden = true;
  table.hidden = true;
  records = [];
  recordsList.replaceChildren();
  status.textContent = "正在載入紀錄…";
  try {
    const response = await fetch("/api/export-v2?format=json", { credentials: "same-origin", cache: "no-store" });
    if (response.status === 401 || response.status === 403) {
      signIn.hidden = false;
      status.textContent = response.status === 401 ? "請先登入管理員帳戶。" : "目前帳戶未有管理員權限。";
      return;
    }
    if (!response.ok) throw new Error("Unable to load records");
    const payload = await response.json();
    if (!Array.isArray(payload.records)) throw new Error("Invalid records response");
    records = payload.records;
    renderRecords();
    downloadCsv.hidden = false;
    searchWrap.hidden = records.length === 0;
  } catch {
    status.textContent = "暫時未能載入紀錄，請重新載入。";
  } finally {
    refresh.disabled = false;
  }
}

refresh.addEventListener("click", load);
search.addEventListener("input", renderRecords);
signInForm.addEventListener("submit", async event => {
  event.preventDefault();
  if (signInButton.disabled || refresh.disabled) return;
  signInButton.disabled = true;
  refresh.disabled = true;
  signInButton.textContent = "登入中…";
  status.textContent = "正在驗證管理員帳戶…";
  const { email, password } = signInForm.elements;
  try {
    const response = await fetch(signInForm.getAttribute("action"), {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: email.value.trim(), password: password.value }),
    });
    if (response.status === 401) {
      status.textContent = "電郵或密碼不正確，請重試。";
      password.focus();
      return;
    }
    if (!response.ok) throw new Error("Unable to sign in");
    password.value = "";
    await load();
  } catch {
    status.textContent = "暫時未能登入，請稍後再試。";
  } finally {
    signInButton.disabled = false;
    refresh.disabled = false;
    signInButton.textContent = signInLabel;
  }
});
load();
