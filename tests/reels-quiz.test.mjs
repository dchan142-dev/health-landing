import { test } from "node:test";
import assert from "node:assert/strict";
import { DAY_TO_AXIS, AXES_META, QUESTIONS, evaluateAxes, computeBMI, buildBookingDates, hasRedFlags } from "../reels-quiz/quiz-data.mjs";

test("all 30 reels use the four filmed entry variants", () => {
  assert.equal(Object.keys(DAY_TO_AXIS).length, 30);
  assert.deepEqual([...new Set(Object.values(DAY_TO_AXIS))].sort(), Object.keys(AXES_META).sort());
  assert.equal(DAY_TO_AXIS["05"], "dual");
  assert.equal(DAY_TO_AXIS["16"], "mito");
});

test("the report preserves Gemini's source and symptom weights", () => {
  const answers = { q1: AXES_META.gut.q1Opts[0].val, q2: [QUESTIONS.q2.opts[0].val] };
  const result = evaluateAxes("gut", answers);
  assert.equal(result.winnerId, "gut");
  assert.deepEqual(result.ratios, { metabolic: 25, mito: 13, gut: 56, dual: 6 });
  assert.equal(computeBMI(170, 70).bmi, 24.2);
  assert.equal(computeBMI(95, 70), null);
});

test("red flags are detected independently of the current step", () => {
  assert.equal(hasRedFlags({ q6: [QUESTIONS.q6.opts[0].val] }), true);
  assert.equal(hasRedFlags({ q6: [QUESTIONS.q6.opts.at(-1).val] }), false);
});

test("booking is based on Hong Kong time with 36 hours lead and no Sundays", () => {
  const dates = buildBookingDates(new Date("2026-11-19T20:30:00.000Z"));
  assert.equal(dates.length, 9);
  assert.equal(dates[0].iso, "2026-11-23");
  assert.ok(dates.every(({ weekday }) => weekday !== "星期日"));
});
