import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AXES_META,
  DAY_TO_AXIS,
  QUESTIONS,
  buildBookingDates,
  computeBMI,
  evaluateAxes,
  hasRedFlags,
} from "../reels-quiz-v2/quiz-data.mjs";

test("changing a locked Day mapping breaks its filmed entry", () => {
  assert.equal(Object.keys(DAY_TO_AXIS).length, 30);
  assert.deepEqual([...new Set(Object.values(DAY_TO_AXIS))].sort(), ["dual", "gut", "metabolic", "mito"]);
  assert.deepEqual(DAY_TO_AXIS, {
    "01": "metabolic", "02": "metabolic", "03": "metabolic", "04": "metabolic", "05": "dual",
    "06": "mito", "07": "metabolic", "08": "metabolic", "09": "mito", "10": "gut",
    "11": "gut", "12": "dual", "13": "mito", "14": "gut", "15": "dual",
    "16": "mito", "17": "metabolic", "18": "gut", "19": "gut", "20": "metabolic",
    "21": "mito", "22": "metabolic", "23": "gut", "24": "mito", "25": "dual",
    "26": "metabolic", "27": "metabolic", "28": "mito", "29": "mito", "30": "gut",
  });
});

test("changing a question clip key breaks playback from the existing media directory", () => {
  assert.deepEqual(Object.fromEntries(Object.entries(AXES_META).map(([id, { clip }]) => [id, clip])), {
    metabolic: "02a-q1-metabolic",
    mito: "02b-q1-mito",
    gut: "02c-q1-gut",
    dual: "02d-q1-dual",
  });
  assert.deepEqual(Object.fromEntries(Object.entries(QUESTIONS).map(([id, { clip }]) => [id, clip])), {
    q2: "03-q2-metabolic",
    q3: "04-q3-mito",
    q4: "05-q4-gut",
    q5: "06-q5-meds",
    q6: "07-q6-safety",
    q7: "09-q7-goal",
  });
});

test("entry axis cannot change the scores, winner, or evidence for identical answers", () => {
  const answers = {
    q1: "少於 3 個月（近期先開始）",
    q2: ["肚腩明顯／四肢偏瘦"],
    q7: "從源頭處理腸胃唔妥、濕疹敏感或周身慢性痛症",
  };
  const result = evaluateAxes("gut", answers);
  assert.deepEqual(evaluateAxes("mito", answers), result);
  assert.equal(result.winnerId, "metabolic");
  assert.deepEqual(result.ratios, { metabolic: 100, mito: 0, gut: 0, dual: 0 });
});

test("an unknown entry axis cannot manufacture an extra scoring axis", () => {
  assert.throws(() => evaluateAxes("unknown", {}), RangeError);
  assert.throws(() => evaluateAxes("constructor", {}), RangeError);
});

test("none and uncertain answers do not create a winner or override canonical ordering", () => {
  const result = evaluateAxes("dual", {
    q1: "由最初一粒藥越加越多，唔想越食越虛",
    q2: ["以上皆無", "唔肯定"],
    q3: ["以上皆無", "唔肯定"],
    q4: ["以上皆無", "唔肯定"],
    q5: ["沒有食長期處方西藥", "唔清楚藥名"],
    q7: "喺安全唔衝突前提下配合長期西藥，養好身體底氣",
  });
  assert.deepEqual(result, {
    winnerId: null,
    winner: null,
    ratios: { metabolic: 0, mito: 0, gut: 0, dual: 0 },
    sortedIds: ["metabolic", "mito", "gut", "dual"],
    evidenceCount: 0,
    evidence: { metabolic: [], mito: [], gut: [], dual: [] },
  });
});

test("a real choice in each of Q2–Q5 contributes equally and keeps the original evidence text", () => {
  const result = evaluateAxes("mito", {
    q2: ["肚腩明顯／四肢偏瘦"],
    q3: ["瞓足八個鐘起身依然無電"],
    q4: ["成日胃脹／排便唔暢順"],
    q5: ["薄血藥／抗凝血藥"],
  });
  assert.deepEqual(result, {
    winnerId: "metabolic",
    winner: AXES_META.metabolic,
    ratios: { metabolic: 25, mito: 25, gut: 25, dual: 25 },
    sortedIds: ["metabolic", "mito", "gut", "dual"],
    evidenceCount: 4,
    evidence: {
      metabolic: ["肚腩明顯／四肢偏瘦"],
      mito: ["瞓足八個鐘起身依然無電"],
      gut: ["成日胃脹／排便唔暢順"],
      dual: ["薄血藥／抗凝血藥"],
    },
  });
  assert.equal(result.winner, AXES_META.metabolic);
});

test("Q5 medicine links to its named axis and dual without inflating the number of selected answers", () => {
  const result = evaluateAxes("gut", {
    q5: ["降血壓藥", "降血糖藥／胰島素針", "降膽固醇藥（他汀類等）", "長期胃藥（抑制胃酸）"],
  });
  assert.equal(result.winnerId, "dual");
  assert.deepEqual(result.ratios, { metabolic: 17, mito: 8, gut: 8, dual: 67 });
  assert.deepEqual(result.sortedIds, ["dual", "metabolic", "mito", "gut"]);
  assert.equal(result.evidenceCount, 4);
  assert.deepEqual(result.evidence, {
    metabolic: ["降血壓藥", "降血糖藥／胰島素針"],
    mito: ["降膽固醇藥（他汀類等）"],
    gut: ["長期胃藥（抑制胃酸）"],
    dual: ["降血壓藥", "降血糖藥／胰島素針", "降膽固醇藥（他汀類等）", "長期胃藥（抑制胃酸）"],
  });
});

test("rounding cannot exceed 100 or assign points to an axis with no score", () => {
  const result = evaluateAxes("dual", {
    q2: ["肚腩明顯／四肢偏瘦"],
    q3: ["瞓足八個鐘起身依然無電"],
    q4: ["成日胃脹／排便唔暢順", "照腸鏡話無事，腸胃依然唔妥", "肚腩大兼濕疹皮膚痕斷唔到尾", "長年鼻敏感、打噴嚏流鼻水"],
  });
  assert.deepEqual(result.ratios, { metabolic: 17, mito: 17, gut: 66, dual: 0 });
});

test("BMI keeps the Hong Kong category boundaries after rounding to one decimal place", () => {
  const cases = [
    [73.6, 18.4, "體重過輕"],
    [74, 18.5, "體重正常"],
    [91.6, 22.9, "體重正常"],
    [92, 23.0, "體重過重"],
    [99.6, 24.9, "體重過重"],
    [100, 25.0, "屬於肥胖"],
  ];
  for (const [weight, expectedBmi, expectedStatus] of cases) {
    const { bmi, status } = computeBMI(200, weight);
    assert.deepEqual([bmi, status], [expectedBmi, expectedStatus]);
  }
});

test("BMI rejects heights and weights just outside the existing input limits", () => {
  assert.equal(computeBMI(130, 30).bmi, 17.8);
  assert.equal(computeBMI(210, 180).bmi, 40.8);
  assert.equal(computeBMI(129, 30), null);
  assert.equal(computeBMI(211, 180), null);
  assert.equal(computeBMI(130, 29), null);
  assert.equal(computeBMI(210, 181), null);
});

test("only a danger choice in Q6 raises the red flag", () => {
  assert.equal(hasRedFlags({ q6: ["晚上唔舒服", "靜止或行一層樓梯即胸痛心翳氣促"] }), true);
  assert.equal(hasRedFlags({ q6: ["以上全部沒有", "唔肯定"] }), false);
  assert.equal(hasRedFlags({ q5: ["薄血藥／抗凝血藥"] }), false);
});

test("Hong Kong booking accepts a slot at exactly 36 hours and drops it one millisecond later", () => {
  const dates = buildBookingDates(new Date("2026-11-19T15:00:00.000Z"));
  assert.deepEqual(dates[0], {
    iso: "2026-11-21",
    weekday: "星期六",
    label: "11/21 (六)",
    slots: ["11am-1pm", "2pm-4pm", "4pm-6pm"],
  });
  assert.deepEqual(buildBookingDates(new Date("2026-11-19T15:00:00.001Z"))[0], {
    iso: "2026-11-21",
    weekday: "星期六",
    label: "11/21 (六)",
    slots: ["2pm-4pm", "4pm-6pm"],
  });
});

test("booking skips Sunday after the last eligible Saturday slot expires", () => {
  const dates = buildBookingDates(new Date("2026-11-19T20:30:00.000Z"));
  assert.deepEqual(dates.map(({ iso }) => iso), [
    "2026-11-23", "2026-11-24", "2026-11-25", "2026-11-26", "2026-11-27", "2026-11-28",
    "2026-11-30", "2026-12-01", "2026-12-02",
  ]);
  assert.deepEqual(dates[0], {
    iso: "2026-11-23",
    weekday: "星期一",
    label: "11/23 (一)",
    slots: ["11am-1pm", "2pm-4pm", "4pm-6pm"],
  });
});
