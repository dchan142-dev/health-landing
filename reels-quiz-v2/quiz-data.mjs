export const DAY_TO_AXIS = {
  "01":"metabolic","02":"metabolic","03":"metabolic","04":"metabolic","05":"dual",
  "06":"mito","07":"metabolic","08":"metabolic","09":"mito","10":"gut",
  "11":"gut","12":"dual","13":"mito","14":"gut","15":"dual",
  "16":"mito","17":"metabolic","18":"gut","19":"gut","20":"metabolic",
  "21":"mito","22":"metabolic","23":"gut","24":"mito","25":"dual",
  "26":"metabolic","27":"metabolic","28":"mito","29":"mito","30":"gut"
};
export const AXES_META = {
  metabolic: {
    id: "metabolic", name: "三高糖脂代謝軸", color: "#0D9488", clip: "02a-q1-metabolic",
    q1Title: "講到血糖、血脂、血壓或脂肪肝，你依家最想搞清楚邊一項？",
    q1Opts: [
      { val: "手腳瘦肚腩大／驗出脂肪肝", short: "肚腩／脂肪肝", label: "手腳瘦肚腩大／驗出脂肪肝" },
      { val: "戒油食得清淡，血糖或血脂依然超標", short: "糖脂超標", label: "戒油食得清淡，血糖或血脂依然超標" },
      { val: "煮飯落極少鹽，血壓仍然時高時低", short: "血壓波動", label: "煮飯落極少鹽，血壓仍然時高時低" },
      { val: "睇嘢矇／小傷口慢好／擔心血管再塞", short: "微血管警號", label: "睇嘢矇／小傷口慢好／擔心血管再塞" },
      { val: "唔肯定", short: "唔肯定", label: "唔肯定", isNone: true }
    ],
    why: "飲食結構、糖脂代謝負荷同血管微循環互相牽動，單靠戒口未必解決底層負荷。"
  },
  mito: {
    id: "mito", name: "線粒體能量與肌力軸", color: "#F59E0B", clip: "02b-q1-mito",
    q1Title: "成日覺得唔夠電、或者行得多都無效，以下邊種情況最困擾你？",
    q1Opts: [
      { val: "瞓足八個鐘，起身依然散晒無精神", short: "瞓醒無神", label: "瞓足八個鐘，起身依然散晒無精神" },
      { val: "日日行公園萬步，肚腩同三高一啲無減", short: "行極唔瘦", label: "日日行公園萬步，肚腩同三高一啲無減" },
      { val: "過馬路越行越慢、扭樽蓋無力、行幾步就喘", short: "肌力下降", label: "過馬路越行越慢、扭樽蓋無力、行幾步就喘" },
      { val: "長新冠後成日攰／一入冷氣房手腳冰凍", short: "易攰手腳凍", label: "長新冠後成日攰／一入冷氣房手腳冰凍" },
      { val: "唔肯定", short: "唔肯定", label: "唔肯定", isNone: true }
    ],
    why: "細胞發電效率同肌肉儲備下降，令體力恢復變慢，亦令糖份同脂肪更難被消耗。"
  },
  gut: {
    id: "gut", name: "心腸軸與慢性發炎軸", color: "#8B5CF6", clip: "02c-q1-gut",
    q1Title: "腸胃、皮膚敏感或者關節痛成日翻發，呢類問題維持咗幾耐？",
    q1Opts: [
      { val: "少於 3 個月（近期先開始）", short: "少於3個月", label: "少於 3 個月（近期先開始）" },
      { val: "3 至 12 個月（時好時壞、反覆發作）", short: "3至12個月", label: "3 至 12 個月（時好時壞、反覆發作）" },
      { val: "超過 1 年（長年斷唔到尾）", short: "超過1年", label: "超過 1 年（長年斷唔到尾）" },
      { val: "照過腸胃鏡話無事，身體依然成日唔妥", short: "鏡檢無事仍唔妥", label: "照過腸胃鏡話無事，身體依然成日唔妥" },
      { val: "唔肯定", short: "唔肯定", label: "唔肯定", isNone: true }
    ],
    why: "腸道屏障同全身慢性發炎連成一線，單靠外塗藥膏或食胃藥只能暫時壓住表面反應。"
  },
  dual: {
    id: "dual", name: "雙軌用藥與安全配合軸", color: "#10B981", clip: "02d-q1-dual",
    q1Title: "講到長期食緊嘅處方西藥，你目前最想搞清楚邊一點？",
    q1Opts: [
      { val: "由最初一粒藥越加越多，唔想越食越虛", short: "藥越加越多", label: "由最初一粒藥越加越多，唔想越食越虛" },
      { val: "見指數食到正常，想知點先有本錢同醫生傾減藥", short: "想知點減藥", label: "見指數食到正常，想知點先有本錢同醫生傾減藥" },
      { val: "食降膽固醇藥後，大髀小腿成日痠軟無力", short: "膽固醇藥痠軟", label: "食降膽固醇藥後，大髀小腿成日痠軟無力" },
      { val: "長年食三高藥配胃藥，個胃依然唔妥兼無力", short: "長期配胃藥", label: "長年食三高藥配胃藥，個胃依然唔妥兼無力" },
      { val: "唔肯定", short: "唔肯定", label: "唔肯定", isNone: true }
    ],
    why: "藥物幫手穩住即時數字，同時要留意藥物對身體養份嘅消耗，絕不建議自行停藥。"
  }
};
export const QUESTIONS = {
  q2: {
    id: "q2", mode: "multi", clip: "03-q2-metabolic", badge: "問題 2 / 7",
    title: "除咗啱啱嗰樣，平時有冇以下血糖血脂或血管訊號？",
    opts: [
      { val: "肚腩明顯／四肢偏瘦", short: "肚腩四肢瘦", label: "肚腩明顯／四肢偏瘦" },
      { val: "體檢有脂肪肝／血脂超標", short: "脂肪肝／血脂", label: "體檢有脂肪肝／血脂超標" },
      { val: "血糖偏高／餐後好易眼瞓", short: "血糖／眼瞓", label: "血糖偏高／餐後好易眼瞓" },
      { val: "血壓偏高／時高時低唔穩", short: "血壓唔穩", label: "血壓偏高／時高時低唔穩" },
      { val: "靠節食降完三高好快反彈", short: "節食反彈", label: "靠節食降完三高好快反彈" },
      { val: "小傷口好慢埋口／睇嘢轉矇", short: "傷口慢／眼矇", label: "小傷口好慢埋口／睇嘢轉矇" },
      { val: "以上皆無", short: "以上皆無", label: "以上皆無", isNone: true },
      { val: "唔肯定", short: "唔肯定", label: "唔肯定", isNone: true }
    ]
  },
  q3: {
    id: "q3", mode: "multi", clip: "04-q3-mito", badge: "問題 3 / 7",
    title: "日常體力同肌肉表現，有冇出現以下變化？",
    opts: [
      { val: "瞓足八個鐘起身依然無電", short: "瞓醒無電", label: "瞓足八個鐘起身依然無電" },
      { val: "未夠鐘食飯就心慌手震腳軟", short: "飯前手震", label: "未夠鐘食飯就心慌手震腳軟" },
      { val: "入冷氣房／轉涼手腳長凍似冰", short: "手腳冰凍", label: "入冷氣房／轉涼手腳長凍似冰" },
      { val: "過馬路行慢咗／扭樽蓋無力", short: "行慢無力", label: "過馬路行慢咗／扭樽蓋無力" },
      { val: "行街旅行行幾步就腳軟氣喘", short: "行幾步氣喘", label: "行街旅行行幾步就腳軟氣喘" },
      { val: "長新冠後成日攰、氣促或腦霧", short: "長新冠腦霧", label: "長新冠後成日攰、氣促或腦霧" },
      { val: "以上皆無", short: "以上皆無", label: "以上皆無", isNone: true },
      { val: "唔肯定", short: "唔肯定", label: "唔肯定", isNone: true }
    ]
  },
  q4: {
    id: "q4", mode: "multi", clip: "05-q4-gut", badge: "問題 4 / 7",
    title: "腸胃同全身發炎方面，邊幾項同你平時情況吻合？",
    opts: [
      { val: "成日胃脹／排便唔暢順", short: "胃脹便秘", label: "成日胃脹／排便唔暢順" },
      { val: "照腸鏡話無事，腸胃依然唔妥", short: "鏡檢無事唔妥", label: "照腸鏡話無事，腸胃依然唔妥" },
      { val: "肚腩大兼濕疹皮膚痕斷唔到尾", short: "濕疹皮膚痕", label: "肚腩大兼濕疹皮膚痕斷唔到尾" },
      { val: "長年鼻敏感、打噴嚏流鼻水", short: "長年鼻敏感", label: "長年鼻敏感、打噴嚏流鼻水" },
      { val: "朝早手指僵硬屈唔埋／關節痛", short: "手指僵關節痛", label: "朝早手指僵硬屈唔埋／關節痛" },
      { val: "無跌無扭親，肩頸腰背陰陰痛", short: "周身陰陰痛", label: "無跌無扭親，肩頸腰背陰陰痛" },
      { val: "以上皆無", short: "以上皆無", label: "以上皆無", isNone: true },
      { val: "唔肯定", short: "唔肯定", label: "唔肯定", isNone: true }
    ]
  },
  q5: {
    id: "q5", mode: "multi", clip: "06-q5-meds", badge: "問題 5 / 7",
    title: "目前每日固定食緊邊類醫生處方西藥？",
    opts: [
      { val: "降血壓藥", short: "血壓藥", label: "降血壓藥" },
      { val: "降血糖藥／胰島素針", short: "血糖藥", label: "降血糖藥／胰島素針" },
      { val: "降膽固醇藥（他汀類等）", short: "膽固醇藥", label: "降膽固醇藥（他汀類等）" },
      { val: "薄血藥／抗凝血藥", short: "薄血藥", label: "薄血藥／抗凝血藥" },
      { val: "長期胃藥（抑制胃酸）", short: "長期胃藥", label: "長期胃藥（抑制胃酸）" },
      { val: "同時固定食緊三種或以上", short: "3種或以上", label: "同時固定食緊三種或以上" },
      { val: "沒有食長期處方西藥", short: "無食西藥", label: "沒有食長期處方西藥", isNone: true },
      { val: "唔清楚藥名", short: "唔清楚藥名", label: "唔清楚藥名", isNone: true }
    ]
  },
  q6: {
    id: "q6", mode: "multi", clip: "07-q6-safety", badge: "問題 6 / 7",
    title: "過去三個月內，有冇出現過以下突發或惡化不適？",
    opts: [
      { val: "靜止或行一層樓梯即胸痛心翳氣促", short: "胸痛氣促", label: "靜止或行一層樓梯即胸痛心翳氣促", isDanger: true },
      { val: "起身突然一陣暈險跌倒或口齒不清", short: "突暈口齒不清", label: "起身突然一陣暈險跌倒或口齒不清", isDanger: true },
      { val: "大便帶血、黑便、吞嚥困難或劇痛", short: "便血劇痛", label: "大便帶血、黑便、吞嚥困難或劇痛", isDanger: true },
      { val: "視力突然驟變／無故體重急跌", short: "視力驟變急瘦", label: "視力突然驟變／無故體重急跌", isDanger: true },
      { val: "以上全部沒有", short: "以上皆無", label: "以上全部沒有", isNone: true },
      { val: "唔肯定", short: "唔肯定", label: "唔肯定", isNone: true }
    ]
  },
  q7: {
    id: "q7", mode: "single", clip: "09-q7-goal", badge: "問題 7 / 7",
    title: "如果線下同 Duncan 第一次見面傾，你最希望優先搞掂邊一件事？",
    opts: [
      { val: "搵出肚腩、三高或脂肪肝嘅真正火頭，唔再反彈", short: "搞掂三高脂肪肝", label: "搵出肚腩、三高或脂肪肝嘅真正火頭，唔再反彈" },
      { val: "幫身體細胞叉返電，改善易攰、手腳冰凍同肌力流失", short: "細胞叉電抗疲勞", label: "幫身體細胞叉返電，改善易攰、手腳冰凍同肌力流失" },
      { val: "從源頭處理腸胃唔妥、濕疹敏感或周身慢性痛症", short: "處理腸胃發炎", label: "從源頭處理腸胃唔妥、濕疹敏感或周身慢性痛症" },
      { val: "喺安全唔衝突前提下配合長期西藥，養好身體底氣", short: "配合西藥養底氣", label: "喺安全唔衝突前提下配合長期西藥，養好身體底氣" },
      { val: "想幫屋企人（父母／伴侶）一齊梳理情況", short: "幫屋企人梳理", label: "想幫屋企人（父母／伴侶）一齊梳理情況" }
    ]
  }
};

const AXIS_IDS = Object.keys(AXES_META);
const EVIDENCE_QUESTIONS = { metabolic: "q2", mito: "q3", gut: "q4", dual: "q5" };
const MEDICINE_AXES = new Map([
  ["降血壓藥", "metabolic"],
  ["降血糖藥／胰島素針", "metabolic"],
  ["降膽固醇藥（他汀類等）", "mito"],
  ["長期胃藥（抑制胃酸）", "gut"],
]);

export function evaluateAxes(axis, answers) {
  if (!AXIS_IDS.includes(axis)) throw new RangeError("Unknown entry axis");

  const scores = {};
  const evidence = {};
  let evidenceCount = 0;
  for (const id of AXIS_IDS) {
    const questionId = EVIDENCE_QUESTIONS[id];
    const options = QUESTIONS[questionId].opts;
    const selected = (answers[questionId] || []).filter(value =>
      !options.some(({ val, isNone }) => val === value && isNone),
    );
    scores[id] = selected.length * 2;
    evidence[id] = selected;
    evidenceCount += selected.length;
  }

  for (const medicine of evidence.dual) {
    const linkedAxis = MEDICINE_AXES.get(medicine);
    if (linkedAxis) {
      scores[linkedAxis] += 1;
      evidence[linkedAxis].push(medicine);
    }
  }

  const total = Object.values(scores).reduce((sum, score) => sum + score, 0);
  const ratios = Object.fromEntries(AXIS_IDS.map(id => [id, 0]));
  if (total > 0) {
    const remainders = {};
    let pointsLeft = 100;
    for (const id of AXIS_IDS) {
      const numerator = scores[id] * 100;
      ratios[id] = Math.floor(numerator / total);
      remainders[id] = numerator % total;
      pointsLeft -= ratios[id];
    }
    const remainderOrder = [...AXIS_IDS].sort((a, b) => remainders[b] - remainders[a]);
    for (const id of remainderOrder.slice(0, pointsLeft)) ratios[id] += 1;
  }

  const sortedIds = [...AXIS_IDS].sort((a, b) => ratios[b] - ratios[a]);
  const winnerId = total > 0 ? sortedIds[0] : null;
  const winner = winnerId === null ? null : AXES_META[winnerId];
  return { winnerId, winner, ratios, sortedIds, evidenceCount, evidence };
}

export function computeBMI(heightCm, weightKg) {
  const h = Number(heightCm);
  const w = Number(weightKg);
  if (!isFinite(h) || !isFinite(w) || h < 130 || h > 210 || w < 30 || w > 180) return null;
  const bmi = Math.round((w / Math.pow(h / 100, 2)) * 10) / 10;
  if (bmi < 18.5) {
    return { bmi, status: "體重過輕", color: "#F59E0B", risk: "BMI 過低風險：肌肉儲備與營養底氣可能偏低，容易出現易攰、肌力下降或免疫力偏弱。" };
  }
  if (bmi < 23.0) {
    return { bmi, status: "體重正常", color: "#10B981", risk: "體重屬香港華人標準正常範圍（18.5–22.9）；如仍有肚腩或三高訊號，需留意隱性內臟脂肪（TOFI）與代謝負荷。" };
  }
  if (bmi < 25.0) {
    return { bmi, status: "體重過重", color: "#F59E0B", risk: "BMI 超標風險（過重 23.0–24.9）：糖脂代謝負荷、血壓波動同脂肪肝風險開始上升，建議及早從源頭調整。" };
  }
  return { bmi, status: "屬於肥胖", color: "#EF4444", risk: "BMI 超標風險（肥胖 ≥ 25.0）：二型糖尿病、高血壓、血脂異常、脂肪肝及心血管負荷風險顯著偏高，宜盡快梳理核心火頭。" };
}

export const OFFLINE_STEPS = [
  { t: "微電流檢測", s: "即時評估身體各部份功能及健康狀況" },
  { t: "身體成份分析", s: "掌握內臟脂肪、肌肉與水分分佈" },
  { t: "深入聆聽處境與訴求", s: "了解生活習慣、困擾與最想改善目標" },
  { t: "初步分析結果及見解", s: "即場梳理背後核心火頭與方向" },
  { t: "一週深入分析方案（自願）", s: "若同意，交低醫院報告及藥單做詳細評估" },
  { t: "再約下一次見面詳細解讀", s: "一對一講解專屬深度改善計劃" }
];

export const STORES = ["灣仔", "荃灣", "屯門", "觀塘"];
export const AGE_RANGES = ["45以下", "45-54", "55-64", "65-74", "75以上"];
export const GENDERS = ["男", "女"];

const SLOT_DEFS = [
  { label: "11am-1pm", startHour: 11 },
  { label: "2pm-4pm", startHour: 14 },
  { label: "4pm-6pm", startHour: 16 },
];
const HOUR_MS = 60 * 60 * 1000;
const HK_UTC_OFFSET = 8;
const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

export function buildBookingDates(now = new Date()) {
  const earliest = now.getTime() + 36 * HOUR_MS;
  const hkNow = new Date(now.getTime() + HK_UTC_OFFSET * HOUR_MS);
  const midnight = Date.UTC(hkNow.getUTCFullYear(), hkNow.getUTCMonth(), hkNow.getUTCDate());
  const dates = [];
  for (let i = 0; i <= 21 && dates.length < 9; i++) {
    const date = new Date(midnight + i * 24 * HOUR_MS);
    const dayOfWeek = date.getUTCDay();
    if (dayOfWeek === 0) continue;
    const slots = SLOT_DEFS
      .filter(({ startHour }) => date.getTime() + (startHour - HK_UTC_OFFSET) * HOUR_MS >= earliest)
      .map(({ label }) => label);
    if (!slots.length) continue;
    const day = WEEKDAYS[dayOfWeek];
    dates.push({
      iso: date.toISOString().slice(0, 10),
      weekday: `星期${day}`,
      label: `${date.getUTCMonth() + 1}/${date.getUTCDate()} (${day})`,
      slots,
    });
  }
  return dates;
}

export function hasRedFlags(answers) {
  return Array.isArray(answers.q6) && QUESTIONS.q6.opts.some(
    ({ val, isDanger }) => isDanger && answers.q6.includes(val),
  );
}
