import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { submitReels } from "../api/submit.js";
import { createReelsStore } from "../server/reels-store.mjs";

const origin = "https://health-decoder.example";
const encryptionKey = Buffer.alloc(32, 13).toString("base64");
let db, store;

before(() => {
  db = new PGlite();
  store = createReelsStore({
    pool: db,
    encryptionKey,
    now: () => new Date("2026-11-18T02:00:30.000Z"),
  });
});

after(async () => {
  await db?.close();
});

const noDanger = "以上全部沒有";
const redFlag = "靜止或行一層樓梯即胸痛心翳氣促";
const booking = {
  store: "灣仔",
  date: "2026-11-20",
  weekday: "星期五",
  timeSlot: "11am-1pm",
};

function unlock(overrides = {}) {
  return {
    submission_id: randomUUID(),
    submission_token: randomUUID(),
    submitted_at: "2026-11-18T02:00:00.000Z",
    event_type: "quiz_unlocked",
    day_entry: "01",
    axis_entry: "metabolic",
    user: {
      name: "問卷測試",
      phone: "98760001",
      email: "quiz-person@example.test",
      ageRange: "55-64",
      gender: "女",
      heightCm: "165",
      weightKg: "65",
      marketingConsent: true,
    },
    answers: {
      q1: "唔肯定",
      q2: ["以上皆無"],
      q3: ["以上皆無"],
      q4: ["以上皆無"],
      q5: ["沒有食長期處方西藥"],
      q6: [noDanger],
      q7: "想幫屋企人（父母／伴侶）一齊梳理情況",
    },
    bmi: null,
    top_axis: null,
    ratios: null,
    booking: null,
    ...overrides,
  };
}

function request(body, requestOrigin = origin, method = "POST") {
  return submitReels(
    new Request(origin + "/api/submit", {
      method,
      headers: { origin: requestOrigin, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    { store, origin },
  );
}

test("public submission persists the server-calculated result and keeps sensitive fields encrypted", async () => {
  const payload = unlock();
  const response = await request(payload);
  assert.equal(response.status, 200, await response.clone().text());
  assert.deepEqual(await response.json(), { ok: true });
  assert.match(response.headers.get("cache-control"), /no-store/);
  const saved = await store.find(payload.submission_id);
  assert.equal(saved.user.email, payload.user.email);
  assert.equal(saved.user.marketingConsent, true);
  assert.equal(saved.top_axis, "metabolic");
  assert.deepEqual(saved.ratios, { metabolic: 55, mito: 18, gut: 18, dual: 9 });
  assert.equal(saved.bmi.bmi, 23.9);
  assert.equal(saved.booking, null);
  assert.equal(Object.hasOwn(saved, "submission_token"), false);
  const raw = await db.query("SELECT * FROM hd_reels_submissions WHERE id = $1", [payload.submission_id]);
  const text = JSON.stringify(raw.rows);
  for (const privateValue of [payload.submission_token, payload.user.email, payload.user.phone, payload.answers.q7]) {
    assert.equal(text.includes(privateValue), false);
  }
});

test("booking retries and out-of-order requests preserve the newest booking", async () => {
  const payload = unlock();
  const first = {
    ...payload,
    submitted_at: "2026-11-18T02:00:10.000Z",
    event_type: "booking_intent",
    booking,
  };
  const latest = {
    ...first,
    submitted_at: "2026-11-18T02:00:20.000Z",
    booking: { ...booking, store: "觀塘", timeSlot: "4pm-6pm" },
  };
  assert.equal((await request(first)).status, 409);
  assert.equal(await store.find(payload.submission_id), null);
  for (const update of [payload, first, latest, latest, first, payload]) {
    assert.equal((await request(update)).status, 200);
  }
  const saved = await store.find(payload.submission_id);
  assert.equal(saved.event_type, "booking_intent");
  assert.equal(saved.submitted_at, latest.submitted_at);
  assert.deepEqual(saved.booking, latest.booking);
  assert.equal((await store.list()).filter(row => row.submission_id === payload.submission_id).length, 1);
});

test("an already saved booking retry stays successful after its booking window closes", async () => {
  const payload = unlock();
  const booked = { ...payload, event_type: "booking_intent", booking };
  await store.save(payload);
  await store.save(booked);
  const laterStore = createReelsStore({
    pool: db,
    encryptionKey,
    now: () => new Date("2026-11-20T12:00:00.000Z"),
  });
  await laterStore.save(booked);
  await assert.rejects(
    laterStore.save({ ...booked, submitted_at: "2026-11-18T02:00:10.000Z" }),
    { status: 400 },
  );
  assert.deepEqual((await laterStore.find(payload.submission_id)).booking, booking);
});

test("triage retains just the red-flag answer and can be corrected before unlock", async () => {
  const payload = unlock();
  const triage = {
    ...payload,
    event_type: "triage_aborted_level1",
    answers: { ...payload.answers, q6: [redFlag] },
  };
  assert.equal((await request(triage)).status, 200);
  const saved = await store.find(payload.submission_id);
  assert.deepEqual(saved.answers, { q6: [redFlag] });
  assert.equal(saved.user, null);
  assert.equal(saved.bmi, null);
  assert.equal(saved.booking, null);
  assert.equal(saved.top_axis, null);
  assert.equal(saved.ratios, null);
  assert.equal((await request(payload)).status, 200);
  assert.equal((await store.find(payload.submission_id)).event_type, "quiz_unlocked");
});

test("a different browser token cannot replace a submission", async () => {
  const payload = unlock();
  assert.equal((await request(payload)).status, 200);
  const other = { ...payload, submission_token: randomUUID(), submitted_at: "2026-11-18T02:00:10.000Z" };
  assert.equal((await request(other)).status, 403);
  assert.equal((await store.find(payload.submission_id)).submitted_at, payload.submitted_at);
});

test("the public API rejects invalid contacts, answers and cross-origin visitors", async () => {
  const payload = unlock();
  for (const malformed of [
    { ...payload, submission_token: "invalid" },
    { ...payload, user: { ...payload.user, phone: "1234567a" } },
    { ...payload, user: { ...payload.user, phone: "85298760001" } },
    { ...payload, user: { ...payload.user, email: "" } },
    { ...payload, answers: { ...payload.answers, q6: [redFlag] } },
    { ...payload, answers: { ...payload.answers, q2: ["invalid"] } },
    { ...payload, event_type: "triage_aborted_level1", answers: { q6: [noDanger] } },
  ]) {
    assert.equal((await request(malformed)).status, 400);
  }
  assert.equal((await request(payload, "https://foreign.example")).status, 403);
  assert.equal((await request(undefined, origin, "GET")).status, 405);
  assert.equal(await store.find(payload.submission_id), null);
});

test("booking keeps the original completed answers and email permission", async () => {
  const payload = unlock();
  assert.equal((await request(payload)).status, 200);
  const changed = {
    ...payload,
    event_type: "booking_intent",
    booking,
    submitted_at: "2026-11-18T02:00:15.000Z",
    user: { ...payload.user, email: "different@example.test", marketingConsent: false },
  };
  assert.equal((await request(changed)).status, 200);
  const saved = await store.find(payload.submission_id);
  assert.equal(saved.user.email, payload.user.email);
  assert.equal(saved.user.marketingConsent, true);
  assert.deepEqual(saved.booking, booking);
});
