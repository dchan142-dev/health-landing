import { readFile } from "node:fs/promises";
import PDFDocument from "pdfkit";
import { AXES_META, OFFLINE_STEPS } from "../reels-quiz/quiz-data.mjs";

const fontPath = new URL("./fonts/NotoSansCJKhk-Regular.otf", import.meta.url);
const ink = "#173532";
const mutedInk = "#46635F";
const green = "#187565";
const surface = "#E6F2EE";
const margin = 48;
const answerSections = [
  "最關注嘅情況", "糖脂負荷", "體力與肌力", "腸胃與發炎", "長期處方藥", "安全排查", "首次會面目標",
];
const hkDate = new Intl.DateTimeFormat("zh-HK", {
  year: "numeric", month: "long", day: "numeric", timeZone: "Asia/Hong_Kong",
});
let fontBytes;

function width(doc) {
  return doc.page.width - 2 * margin;
}

function text(doc, value, { size = 11, color = ink, ...options } = {}) {
  doc.fontSize(size).fillColor(color).text(String(value), { lineGap: 2, ...options });
}

function section(doc, title) {
  doc.moveDown(0.8);
  text(doc, title, { size: 16, color: green });
  doc.moveDown(0.35);
}

function rule(doc) {
  const top = doc.y + 7;
  doc.strokeColor(surface).lineWidth(1).moveTo(margin, top).lineTo(doc.page.width - margin, top).stroke();
  doc.y = top + 13;
}

function heading(doc, title, detail) {
  text(doc, "HEALTH DECODER", { size: 10, color: green, characterSpacing: 1.5 });
  doc.moveDown(0.65);
  text(doc, title, { size: 28 });
  text(doc, detail, { size: 11, color: mutedInk });
  rule(doc);
}

function axisBar(doc, meta, value) {
  const y = doc.y;
  const barWidth = width(doc);
  const percent = Math.max(0, Math.min(100, Number(value) || 0));
  text(doc, meta.name, { size: 12 });
  doc.text(`${percent}%`, margin, y, { width: barWidth, align: "right", lineBreak: false });
  doc.roundedRect(margin, y + 23, barWidth, 6, 3).fill(surface);
  if (percent > 0) doc.roundedRect(margin, y + 23, barWidth * percent / 100, 6, 3).fill(meta.color);
  doc.x = margin;
  doc.y = y + 38;
}

function labeledText(doc, label, value) {
  const valueText = String(value);
  doc.fontSize(11);
  const bodyHeight = doc.heightOfString(valueText, { width: width(doc), lineGap: 2 });
  if (doc.y + bodyHeight + 38 > doc.page.height - margin) doc.addPage();
  text(doc, label, { size: 11, color: green });
  text(doc, valueText, { size: 11 });
  doc.moveDown(0.45);
}

function writeReport(doc, record) {
  const { user, bmi, ratios, top_axis: topAxis, booking, answers } = record;
  const submitted = new Date(record.submitted_at);
  const reportDate = Number.isFinite(submitted.getTime()) ? hkDate.format(submitted) : "";
  heading(doc, "個人問卷分析報告", [user.name, reportDate].filter(Boolean).join("　|　"));

  section(doc, "四軸自評結果");
  for (const axis of Object.keys(AXES_META)) axisBar(doc, AXES_META[axis], ratios[axis]);
  if (Object.hasOwn(AXES_META, topAxis)) {
    labeledText(doc, "會面時可優先討論", AXES_META[topAxis].name);
  }
  text(doc, "以上比例反映今次自評嘅相對重點，只供會面參考。", { color: mutedInk });

  section(doc, "身高、體重與 BMI");
  text(doc, `身高 ${user.heightCm} cm　　體重 ${user.weightKg} kg`, { color: mutedInk });
  text(doc, `BMI ${bmi.bmi}　${bmi.status}`, { size: 17 });
  text(doc, bmi.risk);

  section(doc, "意向預約");
  if (booking) {
    const slot = [booking.store, booking.date, booking.weekday, booking.timeSlot].filter(Boolean).join("　");
    text(doc, slot, { size: 12 });
    text(doc, "日期同時段以團隊透過 WhatsApp 確認為準。", { color: mutedInk });
  } else {
    text(doc, "暫未選擇門市、日期或時段。", { color: mutedInk });
  }
  rule(doc);
  text(doc, "呢份自評報告只供健康對話參考。身體不適、病情或處方藥問題，請向醫生或其他合資格醫護人員查詢。", { size: 10, color: mutedInk });

  doc.addPage();
  heading(doc, "問卷答案與會面安排", user.name);
  answerSections.forEach((label, index) => {
    const number = index + 1;
    const answer = answers?.[`q${number}`];
    labeledText(doc, `第 ${number} 題　${label}`, (Array.isArray(answer) ? answer.join("；") : answer) || "—");
  });
  if (doc.y + 225 > doc.page.height - margin) doc.addPage();
  section(doc, "首次線下會面流程");
  OFFLINE_STEPS.forEach(({ t: title, s: summary }, index) => {
    labeledText(doc, `${index + 1}. ${title}`, summary);
  });
}

export async function renderReelsReport(record) {
  const font = await (fontBytes ??= readFile(fontPath));
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margins: { top: margin, right: margin, bottom: margin, left: margin },
      lang: "zh-HK",
      info: { Title: "Health Decoder 個人問卷分析報告", Author: "Health Decoder" },
    });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.font(font);
    writeReport(doc, record);
    doc.end();
  });
}
