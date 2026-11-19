import { createHash, timingSafeEqual } from "node:crypto";
import { application } from "./runtime.mjs";

const mainOrigin = "https://health-decoder.com";
const axisKeys = ["metabolic", "mito", "gut", "dual"];
const answerKeys = ["q1", "q2", "q3", "q4", "q5", "q6", "q7"];
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const hkTimestamp = new Intl.DateTimeFormat("sv-SE", {
  dateStyle: "short",
  timeStyle: "medium",
  timeZone: "Asia/Hong_Kong",
});
const csvHeaders = [
  "版本", "紀錄編號", "提交時間（香港）", "提交時間（UTC）", "事件", "稱呼",
  "WhatsApp 電話", "電郵地址", "年齡範圍", "性別", "身高（cm）", "體重（kg）", "同意接收推廣資訊",
  "來源 Day", "來源 Axis", "BMI", "BMI 分類", "BMI 提示", "自評重點",
  "糖脂代謝（%）", "體力與肌力（%）", "腸胃與發炎（%）", "用藥配合（%）", "相關訊號數量",
  "第1題", "第2題", "第3題", "第4題", "第5題", "第6題", "第7題",
  "意向門市", "意向日期", "星期", "意向時段", "客戶版報告 PDF 下載連結",
];
const privateHeaders = {
  "cache-control": "private, no-store, max-age=0",
  "x-content-type-options": "nosniff",
  "x-robots-tag": "noindex, nofollow, noarchive",
  "referrer-policy": "no-referrer",
  vary: "Cookie, Authorization",
};

function json(body, status, headers = {}) {
  return Response.json(body, {
    status,
    headers: { ...privateHeaders, "content-type": "application/json; charset=utf-8", ...headers },
  });
}

function download(body, type, filename) {
  return new Response(body, {
    headers: {
      ...privateHeaders,
      "content-type": type,
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });
}

function bearerMatches(header, secret) {
  const bearer = header?.match(/^Bearer ([^\s]+)$/i)?.[1];
  if (!bearer || !secret) return false;
  const hash = value => createHash("sha256").update(value).digest();
  return timingSafeEqual(hash(bearer), hash(secret));
}

function reportAvailable(record) {
  if (!record || record.scoring_version !== "v2" ||
      !["quiz_unlocked", "booking_intent"].includes(record.event_type) ||
      !record.user?.name || !Number.isFinite(record.bmi?.bmi)) return false;
  return axisKeys.every(key => {
    const ratio = record.ratios?.[key];
    return Number.isFinite(ratio) && ratio >= 0 && ratio <= 100;
  });
}

function reportLink(record, origin) {
  if (!reportAvailable(record)) return null;
  const url = new URL("/api/report-v2-pdf", origin);
  url.searchParams.set("id", record.submission_id.toLowerCase());
  return url.href;
}

function csvCell(value) {
  let text = String(value ?? "");
  // Spreadsheet formula detection can ignore whitespace and formatting characters.
  if (/^[\s\p{Cf}]*[\t\r\n=+\-@＝＋－＠]/u.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}

function csvRow(record, origin) {
  const { user, bmi, ratios, answers, booking } = record;
  const date = new Date(record.submitted_at);
  const time = Number.isFinite(date.getTime()) ? hkTimestamp.format(date) : "";
  const consent = typeof user?.marketingConsent === "boolean"
    ? (user.marketingConsent ? "同意" : "未同意") : "";
  return [
    "V2", record.submission_id, time, record.submitted_at, record.event_type,
    user?.name, user?.phone, user?.email, user?.ageRange, user?.gender, user?.heightCm, user?.weightKg, consent,
    record.day_entry, record.axis_entry, bmi?.bmi, bmi?.status, bmi?.risk, record.top_axis,
    ...axisKeys.map(key => ratios?.[key]), record.evidence_count,
    ...answerKeys.map(key => Array.isArray(answers?.[key]) ? answers[key].join("；") : answers?.[key]),
    booking?.store, booking?.date, booking?.weekday, booking?.timeSlot, reportLink(record, origin),
  ];
}

function recordSummary(record, origin) {
  return {
    submission_id: record.submission_id,
    submitted_at: record.submitted_at,
    event_type: record.event_type,
    name: record.user?.name ?? null,
    phone: record.user?.phone ?? null,
    email: record.user?.email ?? null,
    day_entry: record.day_entry,
    axis_entry: record.axis_entry,
    top_axis: record.top_axis ?? null,
    evidence_count: record.evidence_count ?? null,
    booking: record.booking ?? null,
    report_url: reportLink(record, origin),
  };
}

export function createReelsV2Admin({ getStore, getSession, exportKey, origin = mainOrigin }) {
  function secure(handler) {
    return async request => {
      if (request.method !== "GET") return json({ error: "不支援此操作" }, 405, { allow: "GET" });
      try {
        if (!bearerMatches(request.headers.get("authorization"), exportKey)) {
          const session = request.headers.has("cookie") ? await getSession(request.headers) : null;
          if (!session?.user) return json({ error: "請登入管理員帳戶" }, 401);
          if (session.user.role !== "admin") return json({ error: "你沒有管理員權限" }, 403);
        }
        return await handler(new URL(request.url));
      } catch {
        return json({ error: "暫時未能讀取紀錄，請稍後再試。" }, 503);
      }
    };
  }

  return {
    exportCsv: secure(async url => {
      const store = await getStore();
      const records = await store.list();
      if (url.searchParams.get("format") === "json") {
        return json({ records: records.map(record => recordSummary(record, origin)) }, 200);
      }
      const rows = [csvHeaders, ...records.map(record => csvRow(record, origin))];
      const csv = "\uFEFF" + rows.map(row => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
      return download(csv, "text/csv; charset=utf-8", "health-decoder-reels-v2.csv");
    }),
    reportPdf: secure(async url => {
      const id = url.searchParams.get("id")?.toLowerCase() ?? "";
      if (!uuidPattern.test(id)) return json({ error: "紀錄編號格式有誤" }, 400);
      const store = await getStore();
      const record = await store.find(id);
      if (!reportAvailable(record)) return json({ error: "未有可下載嘅問卷報告" }, 404);
      const { renderReelsV2Report } = await import("./reels-v2-report-pdf.mjs");
      const pdf = await renderReelsV2Report(record);
      return download(pdf, "application/pdf", `health-decoder-v2-report-${id}.pdf`);
    }),
  };
}

export async function sendReelsV2AdminResponse(req, res, handler, origin) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    const separator = name.toLowerCase() === "cookie" ? "; " : ", ";
    headers.set(name, Array.isArray(value) ? value.join(separator) : value);
  }
  const request = new Request(new URL(req.url, origin), { headers, method: req.method });
  const response = await handler(request);
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}

export function serveProductionReelsV2Admin(req, res, operation) {
  const origin = process.env.APP_ORIGIN || mainOrigin;
  const handlers = createReelsV2Admin({
    origin,
    exportKey: process.env.ADMIN_EXPORT_KEY,
    getSession: headers => application().auth.api.getSession({ headers }),
    getStore: async () => (await import("./reels-v2-store.mjs")).productionReelsV2Store(),
  });
  return sendReelsV2AdminResponse(req, res, handlers[operation], origin);
}
