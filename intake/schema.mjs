const t = (id, label, placeholder = "") => ({
  id,
  label,
  type: "text",
  placeholder,
});
const a = (id, label, placeholder = "") => ({
  ...t(id, label, placeholder),
  type: "textarea",
});
const c = (id, label, options, multiple = false) => ({
  id,
  label,
  type: multiple ? "multi" : "select",
  options,
});
const b = (id, label, columns, rows = 3) => ({
  id,
  label,
  type: "table",
  columns,
  rows,
});
const g = (title, fields, hint = "") => ({ title, fields, hint });
const s = (title, short, intro, groups) => ({ title, short, intro, groups });
export const bowelTypes = [
  "1 硬粒",
  "2 結塊條狀",
  "3 條狀有裂紋",
  "4 柔軟光滑成條",
  "5 柔軟小塊",
  "6 糊狀稀爛",
  "7 水狀",
  "不清楚",
];
export const sections = [
  s(
    "認識你與改善目標",
    "基本與目標",
    "從你最在意的事情開始。不確定的資料，可以稍後補充。",
    [
      g("01 現在最希望改善甚麼？", [
        t("clientName", "你的稱呼", "例如：陳女士"),
        { ...t("recordDate", "填寫日期"), type: "date" },
        c("filledBy", "由誰填寫？", ["本人", "家人協助", "面談記錄"]),
        a("concerns", "最困擾的三件事，請按重要程度排列"),
        a(
          "goal",
          "未來幾星期，最希望能做到哪件日常事情？",
          "例如：排便舒服些、走路較有力",
        ),
      ]),
      g(
        "02 核實身體資料",
        [
          t("height", "身高（cm）"),
          t("age", "年齡（歲）"),
          c("sex", "生理性別（可選填）", ["女", "男", "其他／不願提供"]),
          t("currentWeight", "現在體重（kg）"),
          { ...t("weightDate", "量體重日期"), type: "date" },
          t("bloodPressure", "最近血壓、脈搏及量度日期"),
          a("currentChanges", "最近一星期最明顯的身體變化"),
        ],
        "請填實際量度值，不需要猜測。這是資料收集，不會自動作診斷。",
      ),
    ],
  ),
  s(
    "排便與腸胃情況",
    "排便與腸胃",
    "先描述實際感受；你認為的原因，我們會分開記錄。",
    [
      g("03 排便具體有甚麼改變？", [
        c(
          "bowelChanges",
          "可複選",
          [
            "次數減少",
            "乾硬／粒狀",
            "需要用力",
            "有便意但排不出",
            "排不清",
            "軟便／稀爛",
            "水便／腹瀉",
            "便秘稀便交替",
            "急便",
            "沒有明顯改變",
            "不清楚",
          ],
          true,
        ),
        a("bowelFrequency", "以前與現在多久排一次？最長幾天沒有排便？"),
        c("bowelType", "最近大便形態", bowelTypes),
      ]),
      g(
        "04 排便時有沒有其他情況？",
        [
          c(
            "stoolWarnings",
            "可複選",
            [
              "鮮血",
              "黑色黏稠像柏油",
              "黏液",
              "油膩難沖走",
              "經常浮水",
              "顏色明顯變淡",
              "疼痛",
              "發燒",
              "沒有以上情況",
              "不清楚",
            ],
            true,
          ),
          a("stoolDetails", "出現日期、次數及程度"),
        ],
        "浮水本身不能判定吸收不良。黑色柏油便、血便，或反覆水便伴發燒、腹痛、虛弱，請及時聯絡醫護。",
      ),
      g("05 問題何時開始？", [
        a("bowelTimeline", "開始日期，以及與開始／更改藥物的時間關係"),
        a("suspectedCause", "你覺得可能與甚麼有關？"),
        a("clinicalExplanation", "是否曾向醫護反映？當時的解釋或處理？"),
      ]),
      g("06 最近一星期的腸胃感受", [
        c(
          "digestiveSymptoms",
          "可複選",
          [
            "吃少許就飽",
            "飯後腹脹",
            "多屁／肚鳴",
            "噁心／嘔吐",
            "胃痛／反酸",
            "吞嚥困難",
            "牙齒／口腔問題",
            "沒有明顯不適",
            "不清楚",
          ],
          true,
        ),
        a("digestiveDetails", "甚麼時間、吃甚麼後出現？偶爾還是經常？"),
      ]),
      g("07 已試過甚麼方法？", [
        a(
          "bowelRemedies",
          "通便藥、止瀉藥、益生菌、酵素、纖維、草藥或其他方法",
          "填名稱、份量、頻率、效果及不適；沒有便填「沒有」",
        ),
        a("gutHistory", "過往有沒有確診腸道感染或腸胃疾病？"),
      ]),
    ],
  ),
  s(
    "體重、食量與飲食",
    "飲食與體重",
    "記錄真正吃下的食物。可用碗、片、隻、湯匙表示，不需要計卡路里。",
    [
      g("08 體重過去怎樣變化？", [
        b(
          "weightHistory",
          "現在、1／3／6個月前及生病前",
          ["時間", "體重kg", "水腫／去水藥變動"],
          5,
        ),
        a("weightContext", "是否刻意減重？衣服有沒有變鬆？水腫是否曾消退？"),
      ]),
      g("09 最近一星期吃得怎樣？", [
        c("appetite", "胃口", ["正常", "較以前差", "時好時壞", "不清楚"]),
        c("foodAmount", "實際食量約是平時的", [
          "全部",
          "四分之三",
          "一半",
          "少於一半",
          "不清楚",
        ]),
        c("minimalIntake", "過去兩星期，有沒有連續5天或以上幾乎沒進食？", [
          "沒有",
          "有",
          "不清楚",
        ]),
        a("intakeReasons", "吃得少的原因，以及幾乎沒進食的日數（如有）"),
      ]),
      g("10 昨天實際吃下甚麼？", [
        b(
          "foodDiary",
          "食物與份量",
          ["餐次／時間", "食物飲品份量", "剩食／吃後不適"],
          6,
        ),
        a("nutritionDrinks", "營養奶完整名稱、版本、每次份量及每日次數"),
      ]),
      g("11 過敏、不耐受與戒口", [
        a("foodAllergies", "甚麼食物會引起甚麼反應？", "沒有便填「沒有」"),
        a(
          "foodRestrictions",
          "刻意不吃甚麼？是醫護指示、吃後不適，還是自己擔心？",
        ),
      ]),
      g(
        "12 飲水與流質安排",
        [
          t(
            "fluidLimit",
            "目前每日限水量（如有）",
            "例如：900mL／沒有限制／不清楚",
          ),
          a("fluidAdvice", "由誰、何時提出？原因及湯、奶、送藥用水如何計算？"),
          b(
            "fluidDiary",
            "昨天大約飲用量",
            ["清水／茶／奶／湯／送藥用水等", "份量mL／碗"],
            4,
          ),
          c(
            "fluidSymptoms",
            "最近有沒有以下情況？",
            ["口乾", "站起時暈眩", "尿量明顯減少", "沒有以上情況", "不清楚"],
            true,
          ),
        ],
        "填寫期間照原醫囑安排流質，不需要自行增減。",
      ),
    ],
  ),
  s(
    "體力、活動與身體變化",
    "體力與活動",
    "按平常情況回答，不需要為填表做任何體力測試。",
    [
      g("13 日常事情是否變困難？", [
        b(
          "dailyFunction",
          "椅子起身、在家走動、穿衣洗澡、外出；填自己做到／要休息或扶物／需人幫忙",
          ["日常事情", "現在情況與一個月前比較"],
          4,
        ),
        t("walking", "平常可舒服走多久／多遠？"),
        c(
          "activityLimit",
          "主要因為甚麼需要停下？",
          ["腳無力", "疲倦", "喘氣", "暈眩", "疼痛", "沒有", "不清楚"],
          true,
        ),
        a("falls", "最近半年有沒有跌倒／差點跌倒？"),
      ]),
      g(
        "14 最近一星期有沒有新出現或加重的症狀？",
        [
          c(
            "heartSymptoms",
            "可複選",
            [
              "走相同距離更喘",
              "休息時氣促",
              "躺平不舒服／需要更多枕頭",
              "半夜喘醒",
              "胸口痛／壓迫感",
              "心悸",
              "暈眩／昏厥",
              "腳腫加重",
              "幾天內體重快速增加",
              "沒有以上變化",
              "不清楚",
            ],
            true,
          ),
          a("heartDetails", "何時開始、多久一次、與以前有甚麼不同？"),
        ],
        "如現正胸痛、嚴重氣促或昏厥，請先尋求緊急醫療協助。",
      ),
      g("15 小腿皮膚與水腫", [
        a("legColour", "是否變深／變黑？一邊或兩邊？位置、開始時間及變化"),
        c(
          "legSymptoms",
          "有沒有以下情況？",
          [
            "痕癢",
            "脫皮",
            "皮膚變硬",
            "冰冷",
            "疼痛",
            "麻痺",
            "傷口／潰瘍",
            "沒有以上情況",
            "不清楚",
          ],
          true,
        ),
        a("legSwelling", "現在是否水腫？早晚有甚麼分別？"),
        a("legAssessment", "醫護有沒有檢查或解釋原因？"),
      ]),
    ],
  ),
  s(
    "已知病歷與治療",
    "病歷與治療",
    "記錄醫護曾確認的事情。記不起醫學名稱，可填「不清楚」。",
    [
      g("16 心臟病與感染", [
        a("heartDiagnosis", "心臟病名稱，是否有心衰竭、瓣膜問題？"),
        a("heartProcedures", "支架／心臟手術的時間及種類"),
        a("infectionHistory", "感染名稱、位置、日期及目前是否受控？"),
        a("antibioticPurpose", "長期抗生素的目的、開始時間及預計療程"),
      ]),
      g("17 其他疾病與近期治療", [
        a("thyroid", "甲狀腺疾病及最近是否穩定"),
        a("steroidPurpose", "類固醇（如Prednisolone）的用途及服用多久"),
        a("otherConditions", "腎病、糖尿病、肝病、免疫疾病或其他病歷"),
        a("recentAdmissions", "最近住院、手術、感染的日期及原因"),
      ]),
    ],
  ),
  s(
    "目前用藥與營養品",
    "用藥與營養品",
    "請照最新藥袋填寫，不要因填表而停藥或改份量。",
    [
      g("18 現在真正服用的藥物", [
        b(
          "medicines",
          "藥袋資料，可稍後補齊",
          ["藥名", "每次份量／每天次數", "時間", "變動／不適"],
          5,
        ),
        a("medicationChanges", "哪些已停用、改量或新增？"),
        a("medicationDifficulties", "有沒有漏服、難吞或服後不適？"),
      ]),
      g("19 保健品、營養品、草藥及茶飲", [
        b(
          "supplements",
          "請分清已使用，還是只是考慮",
          ["完整名稱／版本", "已用／考慮中", "份量與頻率", "開始日期／反應"],
          4,
        ),
        a("drugAllergies", "過往藥物或保健品過敏／不良反應"),
      ]),
    ],
  ),
  s(
    "檢查、生活支援與三天記錄",
    "檢查與記錄",
    "收集已有資料便可以，不用為填表自行做新檢查。",
    [
      g(
        "20 有哪些近期正式報告？",
        [
          c(
            "availableReports",
            "可複選",
            [
              "血常規／血紅素",
              "腎功能／eGFR",
              "鈉／鉀／鎂／磷／鈣",
              "甲狀腺TSH／FT4／FT3",
              "肝功能／白蛋白",
              "血糖／HbA1c",
              "鐵／B12／葉酸／維他命D",
              "心臟超聲波／射血分數",
              "BNP／NT-proBNP",
              "糞便／腸胃檢查",
              "未有／不清楚",
            ],
            true,
          ),
          a("reportValues", "報告日期、項目、結果、單位及參考範圍"),
          a("reportFollowup", "哪些資料會稍後提供？"),
        ],
        "本版收集文字及報告清單。照片請透過與跟進者原有的私密渠道提供，遮蓋不必要的身份資料。",
      ),
      g("21 日常支援與改善安排", [
        a("support", "誰買餸、煮食、協助服藥及覆診？有沒有照顧或經濟困難？"),
        a("sleepMood", "睡眠時間、主要困擾，以及情緒／壓力是否影響進食或活動"),
        a("easyChange", "最容易持續做到的改變，以及最不想增加的負擔"),
        t("nextAppointment", "下次覆診日期及專科"),
      ]),
      g("22 三天簡單記錄（可稍後續填）", [
        b(
          "threeDayDiary",
          "維持平常生活及處方安排，不用刻意測試身體",
          [
            "日期",
            "晨重kg",
            "食物與份量",
            "流質總量",
            "排便次數／形態1–7",
            "不適／體力／腳腫／喘氣／藥物變動",
          ],
          3,
        ),
        a("extraNotes", "其他想讓跟進者知道的事情"),
      ]),
    ],
  ),
];
export const allFields = Object.fromEntries(
  sections
    .flatMap((s) => s.groups.flatMap((g) => g.fields))
    .map((f) => [f.id, f]),
);
allFields.consent = { id: "consent", type: "boolean" };
export function hasValue(v) {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return v.trim().length > 0;
  if (Array.isArray(v)) return v.some(hasValue);
  if (v && typeof v === "object") return Object.values(v).some(hasValue);
  return false;
}
export function progress(answers = {}) {
  const groups = sections.flatMap((s) => s.groups);
  return {
    filled: groups.filter((g) => g.fields.some((f) => hasValue(answers[f.id])))
      .length,
    total: groups.length,
  };
}
export function validateAnswers(answers) {
  if (!answers || typeof answers !== "object" || Array.isArray(answers))
    return false;
  for (const [id, v] of Object.entries(answers)) {
    if (!Object.hasOwn(allFields, id)) return false;
    const f = allFields[id];
    if (f.type === "boolean") {
      if (typeof v !== "boolean") return false;
    } else if (f.type === "multi") {
      if (
        !Array.isArray(v) ||
        v.length > f.options.length ||
        new Set(v).size !== v.length ||
        v.some((o) => !f.options.includes(o))
      )
        return false;
    } else if (f.type === "table") {
      if (!Array.isArray(v) || v.length > 60) return false;
      for (const row of v)
        if (
          !Array.isArray(row) ||
          row.length !== f.columns.length ||
          row.some((cell) => typeof cell !== "string" || cell.length > 2000)
        )
          return false;
    } else if (
      typeof v !== "string" ||
      v.length > 10000 ||
      (f.type === "select" && v !== "" && !f.options.includes(v))
    )
      return false;
  }
  return true;
}
