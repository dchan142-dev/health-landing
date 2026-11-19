import { readFile } from "node:fs/promises";
import PDFDocument from "pdfkit";
import { AXES_META, OFFLINE_STEPS } from "../reels-quiz-v2/quiz-data.mjs";

const fontPath = new URL("./fonts/NotoSansCJKhk-Regular.otf", import.meta.url);
const title = "Health Decoder 個人自評報告";
const neutralMessage = "你喺第 2 至第 5 題未有揀到明確相關訊號，暫時未能分出重點。第一次見面可以由你最想了解嘅方向開始梳理。";
const ink = "#14333C";
const muted = "#52646B";
const accent = "#126662";
const surface = "#E5EFEF";
const margin = 48;
const groupLabels = {
  metabolic: "糖脂代謝",
  mito: "體力與肌力",
  gut: "腸胃與發炎",
  dual: "用藥與安全配合",
};
const answerLabels = [
  "一開始想了解嘅情況", "血糖、血脂同血管訊號", "體力與肌力", "腸胃與發炎",
  "長期處方藥", "近期突發或惡化不適", "第一次見面最想傾嘅事",
];
const meetingSummaries = [
  "了解檢測項目，記錄測量結果。",
  OFFLINE_STEPS[1].s,
  OFFLINE_STEPS[2].s,
  "一齊睇返記錄同問卷答案，整理下一步想了解嘅方向。",
  OFFLINE_STEPS[4].s,
  "一對一傾返整理結果同你想跟進嘅方向。",
];
const hkDate = new Intl.DateTimeFormat("zh-HK", {
  year: "numeric", month: "long", day: "numeric", timeZone: "Asia/Hong_Kong",
});
let fontBytes;

function text(doc, value, { size = 11, color = ink, ...options } = {}) {
  doc.fontSize(size).fillColor(color).text(value, { lineGap: 2, ...options });
}

function section(doc, label) {
  doc.moveDown(0.65);
  text(doc, label, { size: 16, color: accent });
  doc.moveDown(0.25);
}

function rule(doc) {
  const y = doc.y + 8;
  doc.strokeColor(surface).lineWidth(1).moveTo(margin, y).lineTo(doc.page.width - margin, y).stroke();
  doc.y = y + 12;
}

function ratioBar(doc, group, ratio, highlighted) {
  const y = doc.y;
  const width = doc.page.width - 2 * margin;
  const label = groupLabels[group] + (highlighted ? "　較多相關訊號" : "");
  text(doc, label, { color: highlighted ? accent : ink });
  doc.text(`${ratio}%`, margin, y, { width, align: "right" });
  doc.roundedRect(margin, y + 23, width, 5, 2.5).fill(surface);
  if (ratio > 0) {
    const filled = width * ratio / 100;
    doc.roundedRect(margin, y + 23, filled, 5, Math.min(2.5, filled / 2)).fill(AXES_META[group].color);
  }
  doc.x = margin;
  doc.y = y + 37;
}

function labeledText(doc, label, value) {
  doc.fontSize(11);
  const height = doc.heightOfString(value, { lineGap: 2 });
  if (doc.y + height + 24 > doc.page.maxY()) doc.addPage();
  text(doc, label, { color: accent });
  text(doc, value);
  doc.moveDown(0.45);
}

function writeReport(doc, record) {
  const { user, bmi, ratios, top_axis: topGroup, booking, answers } = record;
  const submitted = new Date(record.submitted_at);
  text(doc, title, { size: 25 });
  const reportDate = Number.isFinite(submitted.getTime()) ? hkDate.format(submitted) : "";
  text(doc, [user.name, reportDate].filter(Boolean).join("　｜　"), { color: muted });
  text(doc, `年齡範圍 ${user.ageRange}　　性別 ${user.gender}`, { color: muted });
  rule(doc);

  section(doc, `BMI ${bmi.bmi}　${bmi.status}`);
  text(doc, `身高 ${user.heightCm} cm　　體重 ${user.weightKg} kg`, { color: muted });
  text(doc, bmi.risk);

  section(doc, "自評結果");
  if (Object.hasOwn(groupLabels, topGroup)) {
    labeledText(doc, "今次自評重點", groupLabels[topGroup]);
  } else {
    text(doc, neutralMessage);
    doc.moveDown(0.55);
  }
  for (const group of Object.keys(groupLabels)) ratioBar(doc, group, ratios[group], group === topGroup);

  if (booking) {
    section(doc, "預約意向");
    text(doc, [booking.store, booking.date, booking.weekday, booking.timeSlot].filter(Boolean).join("　"));
    text(doc, "日期同時段以團隊透過 WhatsApp 確認為準。", { color: muted });
  }
  rule(doc);
  text(doc, "呢份自評只供健康交流參考，並非醫療診斷。", { size: 10, color: muted });

  doc.addPage();
  text(doc, "你嘅問卷答案", { size: 23 });
  rule(doc);
  answerLabels.forEach((label, index) => {
    const number = index + 1;
    const answer = answers?.[`q${number}`];
    labeledText(doc, `第 ${number} 題　${label}`, (Array.isArray(answer) ? answer.join("；") : answer) || "—");
  });

  if (doc.y + 115 > doc.page.maxY()) doc.addPage();
  section(doc, "第一次見面流程");
  OFFLINE_STEPS.forEach(({ t: step }, index) => {
    labeledText(doc, `${index + 1}. ${step}`, meetingSummaries[index]);
  });
}

export async function renderReelsV2Report(record) {
  const font = await (fontBytes ??= readFile(fontPath).catch(error => {
    fontBytes = undefined;
    throw error;
  }));
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin,
      lang: "zh-HK",
      info: { Title: title, Author: "Health Decoder" },
    });
    const chunks = [];
    doc.on("data", chunk => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.font(font);
    writeReport(doc, record);
    doc.end();
  });
}
