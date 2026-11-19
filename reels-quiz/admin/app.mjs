const status = document.querySelector("#status");
const signIn = document.querySelector("#sign-in");
const signInForm = signIn.querySelector("form");
const signInButton = signInForm.querySelector("button");
const refresh = document.querySelector("#refresh");
const downloadCsv = document.querySelector("#download-csv");
const table = document.querySelector("#table");
const recordsList = document.querySelector("#records");
const search = document.querySelector("#record-search");
const searchWrap = document.querySelector("#search-wrap");
let records = [];
const timestamp = new Intl.DateTimeFormat("zh-HK", {
  dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Hong_Kong",
});
const progressLabels = {
  booking_intent: "已記錄預約意向",
  quiz_unlocked: "已解鎖報告",
  triage_aborted_level1: "已顯示安全提醒",
};

function cell(row, label, content) {
  const td = row.insertCell();
  td.dataset.label = label;
  if (content instanceof Node) td.append(content);
  else td.textContent = content;
}

function recordRow(record) {
  const row = document.createElement("tr");
  const submitted = new Date(record.submitted_at);
  cell(row, "提交時間", Number.isFinite(submitted.getTime()) ? timestamp.format(submitted) : "—");
  cell(row, "稱呼", record.name || "—");
  cell(row, "進度", progressLabels[record.event_type] || "—");
  const booking = record.booking;
  cell(row, "預約意向", booking
    ? [booking.store, booking.date, booking.weekday, booking.timeSlot].filter(Boolean).join(" · ")
    : "—");

  if (record.report_url) {
    const link = document.createElement("a");
    link.href = "/api/report-pdf?" + new URLSearchParams({ id: record.submission_id });
    link.download = "";
    link.textContent = "下載 PDF";
    cell(row, "客人報告", link);
  } else {
    cell(row, "客人報告", "—");
  }
  return row;
}

function renderRecords() {
  const term = search.value.trim().toLowerCase();
  const matches = records.filter(record => !term ||
    record.submission_id.toLowerCase().includes(term) ||
    record.name?.toLowerCase().includes(term),
  );
  recordsList.replaceChildren(...matches.map(recordRow));
  table.hidden = matches.length === 0;
  status.textContent = matches.length
    ? `共 ${matches.length} 筆紀錄。時間以香港時間顯示。`
    : term ? "搵唔到符合條件嘅紀錄。" : "暫未有問卷紀錄。";
}

async function load() {
  refresh.disabled = true;
  signIn.hidden = true;
  downloadCsv.hidden = true;
  searchWrap.hidden = true;
  table.hidden = true;
  recordsList.replaceChildren();
  status.textContent = "正在載入紀錄…";
  try {
    const response = await fetch("/api/export?format=json", { credentials: "same-origin", cache: "no-store" });
    if (response.status === 401 || response.status === 403) {
      signIn.hidden = false;
      status.textContent = response.status === 401 ? "請先登入管理員帳戶。" : "目前帳戶未有管理員權限。";
      return;
    }
    if (!response.ok) throw new Error("Unable to load records");
    ({ records } = await response.json());
    downloadCsv.hidden = false;
    searchWrap.hidden = records.length === 0;
    renderRecords();
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
  if (signInButton.disabled) return;
  signInButton.disabled = true;
  signInButton.textContent = "登入中…";
  status.textContent = "正在驗證管理員帳戶…";
  const { email, password } = signInForm.elements;
  try {
    const response = await fetch("/api/health-intake/auth/sign-in/email", {
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
    signInButton.textContent = "登入 Reels 問卷管理";
  }
});
load();
