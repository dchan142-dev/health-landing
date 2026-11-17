import { test } from "node:test";
import assert from "node:assert/strict";
import { validateAnswers, progress } from "../intake/schema.mjs";

test("unknown answer keys including inherited JavaScript property names are rejected", () => {
  for (const answers of [
    { toString: "text" },
    { constructor: "text" },
    JSON.parse('{"__proto__":"text"}'),
    { role: "admin" },
  ])
    assert.equal(validateAnswers(answers), false);
});
test("blank tables do not inflate the number of groups with answers", () => {
  assert.deepEqual(progress({ foodDiary: [["", "", ""]] }), {
    filled: 0,
    total: 22,
  });
  assert.deepEqual(
    progress({ foodDiary: [["午餐", "半碗飯", ""]], clientName: "測試" }),
    { filled: 2, total: 22 },
  );
});
