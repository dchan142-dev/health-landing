import assert from "node:assert/strict";
import { createDecipheriv, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { recordReelsV2Event } from "../api/event-v2.js";
import { submitReelsV2 } from "../api/submit-v2.js";
import { createReelsStore } from "../server/reels-store.mjs";
import { createReelsV2Events } from "../server/reels-v2-events.mjs";
import { createReelsV2Store } from "../server/reels-v2-store.mjs";

const origin = "https://health-decoder.example";
const encryptionKey = Buffer.alloc(32, 19).toString("base64");
const serverTime = "2026-11-18T02:00:30.000Z";
const timestamp = "2026-11-18T02:00:00.000Z";
const now = () => new Date(serverTime);
const redFlag = "靜止或行一層樓梯即胸痛心翳氣促";
const noDanger = "以上全部沒有";
const mitoAnswer = "瞓足八個鐘，起身依然散晒無精神";
const metabolicAnswer = "肚腩明顯／四肢偏瘦";
const metabolismMedicine = "降血壓藥";
const booking = { store: "灣仔", date: "2026-11-20", weekday: "星期五", timeSlot: "11am-1pm" };
let db, store, v1, events;

before(() => {
  db = new PGlite();
  v1 = createReelsStore({ pool: db, encryptionKey, now });
  store = createReelsV2Store({ pool: db, encryptionKey, now });
  events = createReelsV2Events({ pool: db, now });
});

after(async () => {
  await db?.close();
});

function unlock(overrides = {}) {
  return {
    schema_version: 2,
    submission_id: randomUUID(),
    submission_token: randomUUID(),
    submitted_at: timestamp,
    event_type: "quiz_unlocked",
    day_entry: "01",
    axis_entry: "metabolic",
    user: {
      name: "問卷測試",
      phone: "98760001",
      email: "v2-person@example.test",
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
    booking: null,
    ...overrides,
  };
}

function event(overrides = {}) {
  return { analytics_id: randomUUID(), event: "landing", platform: "fb", reel: "01", ...overrides };
}

function publicRequest(path, body, options = {}) {
  const {
    requestOrigin = origin, type = "application/json", method = "POST",
    raw = JSON.stringify(body), headers = {},
  } = options;
  return new Request(origin + path, {
    method,
    headers: { origin: requestOrigin, "content-type": type, ...headers },
    body: raw,
  });
}

function submit(body, options, submissionStore = store) {
  return submitReelsV2(publicRequest("/api/submit-v2", body, options), { store: submissionStore, origin });
}

function track(body, options, eventStore = events) {
  return recordReelsV2Event(publicRequest("/api/event-v2", body, options), { store: eventStore, origin });
}

function decrypt(ciphertext, aad) {
  const bytes = Buffer.from(ciphertext, "base64");
  const decipher = createDecipheriv("aes-256-gcm", Buffer.from(encryptionKey, "base64"), bytes.subarray(0, 12));
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(bytes.subarray(12, 28));
  return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8"));
}

test("V2 unlock stores only server-computed BMI and evidence under V2-specific authenticated encryption", async () => {
  const payload = unlock();
  payload.submission_id = payload.submission_id.toUpperCase();
  payload.axis_entry = "mito";
  payload.answers = { ...payload.answers, q1: mitoAnswer, q2: [metabolicAnswer], q5: [metabolismMedicine] };
  Object.assign(payload, {
    top_axis: "gut",
    ratios: { gut: 100 },
    evidence: { gut: ["client-supplied"] },
    evidenceCount: 100,
    evidence_count: 99,
    bmi: { bmi: 5 },
    analytics_id: randomUUID(),
  });
  const response = await submit(payload);
  assert.equal(response.status, 200, await response.clone().text());
  const acknowledgement = await response.json();
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");

  const id = payload.submission_id.toLowerCase();
  const saved = await store.find(payload.submission_id);
  assert.deepEqual(acknowledgement, { ok: true, record: saved });
  assert.equal(saved.submission_id, id);
  assert.equal(saved.user.email, payload.user.email);
  assert.equal(saved.user.marketingConsent, true);
  assert.equal(saved.day_entry, "01");
  assert.equal(saved.axis_entry, "mito");
  assert.deepEqual(saved.answers, payload.answers);
  assert.equal(saved.bmi.bmi, 23.9);
  assert.equal(saved.scoring_version, "v2");
  assert.equal(saved.top_axis, "metabolic");
  assert.deepEqual(saved.ratios, { metabolic: 60, mito: 0, gut: 0, dual: 40 });
  assert.deepEqual(saved.evidence, { metabolic: [metabolicAnswer, metabolismMedicine], mito: [], gut: [], dual: [metabolismMedicine] });
  assert.equal(saved.evidence_count, 2);
  for (const key of ["evidenceCount", "submission_token", "analytics_id"]) {
    assert.equal(Object.hasOwn(saved, key), false, key);
  }

  const { rows: [raw] } = await db.query("SELECT * FROM hd_reels_v2_submissions WHERE id = $1", [id]);
  const text = JSON.stringify(raw);
  for (const privateValue of [payload.submission_token, payload.analytics_id, payload.user.email, payload.user.phone, mitoAnswer, metabolicAnswer]) {
    assert.equal(text.includes(privateValue), false, privateValue);
  }
  assert.deepEqual(decrypt(raw.payload_ciphertext, `hd_reels_v2_submissions:${id}`), saved);
  assert.throws(() => decrypt(raw.payload_ciphertext, `hd_reels_submissions:${id}`));
  assert.throws(() => decrypt(raw.payload_ciphertext, `hd_reels_v2_submissions:${randomUUID()}`));
});

test("V2 zero-signal unlock stays findable and defaults optional consent", async () => {
  const payload = unlock();
  delete payload.user.marketingConsent;
  await store.save(payload);
  const saved = await store.find(payload.submission_id);
  assert.equal(saved.top_axis, null);
  assert.deepEqual(saved.ratios, { metabolic: 0, mito: 0, gut: 0, dual: 0 });
  assert.deepEqual(saved.evidence, { metabolic: [], mito: [], gut: [], dual: [] });
  assert.equal(saved.evidence_count, 0);
  assert.equal(saved.user.marketingConsent, false);
  assert.equal(await store.find("invalid"), null);
});

test("V2 triage retains only Q6 and cannot be booked without an unlock", async () => {
  const payload = unlock();
  const triage = {
    ...payload,
    event_type: "triage_aborted_level1",
    user: { ...payload.user, injected: "never kept" },
    bmi: { bmi: 23.9 },
    top_axis: "mito",
    ratios: { mito: 100 },
    evidence: { mito: ["never kept"] },
    evidenceCount: 1,
    answers: { q6: [redFlag] },
  };
  assert.equal((await submit({ ...triage, answers: { q6: [redFlag], q7: payload.answers.q7 } })).status, 400);
  assert.equal((await submit({ ...triage, answers: { q6: [noDanger] } })).status, 400);
  assert.equal((await submit(triage)).status, 200);
  const saved = await store.find(payload.submission_id);
  assert.deepEqual(saved.answers, { q6: [redFlag] });
  for (const key of ["user", "bmi", "top_axis", "ratios", "evidence", "evidence_count", "booking"]) {
    assert.equal(saved[key], null, key);
  }
  const newerTriage = { ...triage, submitted_at: "2026-11-18T02:00:10.000Z" };
  await store.save(newerTriage);
  await store.save(triage);
  assert.equal((await store.find(payload.submission_id)).submitted_at, newerTriage.submitted_at);
  assert.equal((await submit({ ...payload, event_type: "booking_intent", booking })).status, 409);
  await store.save(payload);
  await store.save(newerTriage);
  assert.equal((await store.find(payload.submission_id)).event_type, "quiz_unlocked");
});

test("V2 booking preserves the unlock snapshot across retry and out-of-order updates", async () => {
  const payload = unlock();
  const first = {
    ...payload,
    user: { ...payload.user, heightCm: "180", email: "changed@example.test", marketingConsent: false },
    axis_entry: "mito",
    day_entry: "30",
    answers: { ...payload.answers, q1: mitoAnswer, q2: [metabolicAnswer] },
    event_type: "booking_intent",
    submitted_at: "2026-11-18T02:00:10.000Z",
    booking: { ...booking, weekday: "客戶資料" },
  };
  const latest = {
    ...first,
    submitted_at: "2026-11-18T02:00:20.000Z",
    booking: { ...booking, store: "觀塘", timeSlot: "4pm-6pm" },
  };
  assert.equal((await submit(first)).status, 409);
  assert.equal(await store.find(payload.submission_id), null);
  await store.save(payload);
  const unlocked = await store.find(payload.submission_id);
  await Promise.all([store.save(first), store.save(latest)]);
  for (const retry of [latest, first, payload]) await store.save(retry);
  assert.deepEqual(await store.find(payload.submission_id), {
    ...unlocked,
    event_type: "booking_intent",
    submitted_at: latest.submitted_at,
    booking: latest.booking,
  });
  assert.equal((await store.list()).filter(row => row.submission_id === payload.submission_id).length, 1);
});

test("token-authorized resume exposes only the existing V2 snapshot and never creates a record", async () => {
  const payload = unlock();
  const read = { schema_version: 2, action: "resume", submission_id: payload.submission_id, submission_token: payload.submission_token };
  assert.equal((await submit(read)).status, 404);
  assert.equal(await store.find(payload.submission_id), null);
  await store.save(payload);
  const wrong = await submit({ ...read, submission_token: randomUUID() });
  assert.equal(wrong.status, 403);
  assert.deepEqual(Object.keys(await wrong.json()), ["error"]);
  const resumed = await submit(read);
  assert.equal(resumed.status, 200);
  assert.equal(resumed.headers.get("cache-control"), "no-store");
  assert.deepEqual(await resumed.json(), { ok: true, record: await store.find(payload.submission_id) });
});

test("a stale unlock cannot restore withdrawn consent and corrected contact can be saved on a booked record", async () => {
  const original = unlock();
  await store.save(original);
  const corrected = {
    ...original, expected_unlock_revision: original.submitted_at, submitted_at: "2026-11-18T02:00:10.000Z",
    user: { ...original.user, email: "correct@example.test", marketingConsent: false },
    answers: { ...original.answers, q2: [metabolicAnswer] },
  };
  const booked = { ...original, event_type: "booking_intent", booking, submitted_at: "2026-11-18T02:00:20.000Z" };
  await store.save(booked);
  const accepted = await submit(corrected);
  assert.equal(accepted.status, 200);
  const saved = await store.find(original.submission_id);
  assert.equal(saved.user.marketingConsent, false);
  assert.equal(saved.user.email, "correct@example.test");
  assert.equal(saved.top_axis, "metabolic");
  assert.deepEqual(saved.booking, booking);
  assert.equal(saved.submitted_at, booked.submitted_at);
  assert.deepEqual((await accepted.json()).record, saved);
  const stale = await submit(original);
  assert.equal(stale.status, 409);
  assert.deepEqual(await stale.json(), { ok: false, conflict: "superseded_unlock", record: saved });
  const retry = await submit(corrected);
  assert.equal(retry.status, 200);
  assert.deepEqual((await retry.json()).record, saved);
  assert.deepEqual(await store.find(original.submission_id), saved);
});

test("unlock corrections require the exact base even when two pending mutations have the same timestamp", async () => {
  const original = unlock({ unlock_revision: randomUUID(), expected_unlock_revision: null });
  await store.save(original);
  const corrected = {
    ...original, expected_unlock_revision: original.unlock_revision, unlock_revision: randomUUID(),
    submitted_at: "2026-11-18T02:00:10.000Z",
    user: { ...original.user, email: "corrected@example.test", marketingConsent: false },
  };
  const accepted = await submit(corrected);
  assert.equal(accepted.status, 200);
  const { record } = await accepted.json();
  const stale = {
    ...original, unlock_revision: randomUUID(), expected_unlock_revision: original.unlock_revision,
    submitted_at: "2026-11-18T02:00:20.000Z", user: { ...original.user, heightCm: 166 },
  };
  for (const expected_unlock_revision of [original.unlock_revision, null, undefined, randomUUID()]) {
    const response = await submit({ ...stale, expected_unlock_revision });
    assert.equal(response.status, 409);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { ok: false, conflict: "superseded_unlock", record });
  }
  // A lost reply to a competing proposal in the same millisecond cannot name the accepted base.
  const loser = { ...stale, submitted_at: corrected.submitted_at };
  assert.equal((await submit(loser)).status, 409);
  assert.equal((await submit({ ...stale, expected_unlock_revision: loser.unlock_revision })).status, 409);
  assert.deepEqual((await (await submit(corrected)).json()).record, record);
  const reconciled = await submit({
    ...stale, expected_unlock_revision: record.unlock_revision, user: { ...record.user, heightCm: 166 },
  });
  assert.equal(reconciled.status, 200);
  const final = await store.find(original.submission_id);
  assert.equal(final.user.heightCm, 166);
  assert.equal(final.user.email, "corrected@example.test");
  assert.equal(final.user.marketingConsent, false);
});

for (const delayed of ["earlier", "later"]) {
  test("overlapping booking writes acknowledge the canonical intent when the " + delayed + " write is delayed", async () => {
    const unlocked = unlock();
    await store.save(unlocked);
    const earlier = { ...unlocked, event_type: "booking_intent", booking, submitted_at: "2026-11-18T02:00:10.000Z" };
    const later = { ...earlier, booking: { ...booking, store: "觀塘" }, submitted_at: "2026-11-18T02:00:20.000Z" };
    // Hold one real SQL write after its initial read; the other request completes first.
    const atWrite = Promise.withResolvers();
    const release = Promise.withResolvers();
    const waiting = createReelsV2Store({ encryptionKey, now, pool: { query: async (sql, params) => {
      if (/^\s*UPDATE /i.test(sql)) {
        atWrite.resolve();
        await release.promise;
      }
      return db.query(sql, params);
    } } });
    const [queued, immediate] = delayed === "earlier" ? [earlier, later] : [later, earlier];
    const inFlight = submit(queued, undefined, waiting);
    await atWrite.promise;
    const first = await submit(immediate);
    const firstRecord = await store.find(unlocked.submission_id);
    release.resolve();
    const last = await inFlight;
    const saved = await store.find(unlocked.submission_id);
    assert.equal(first.status, 200);
    assert.deepEqual((await first.json()).record?.booking, firstRecord.booking);
    assert.deepEqual(firstRecord.booking, immediate.booking);
    assert.equal(last.status, delayed === "earlier" ? 409 : 200);
    const lastReply = await last.json();
    assert.deepEqual(lastReply.record, saved);
    assert.equal(lastReply.conflict, delayed === "earlier" ? "superseded_booking" : undefined);
    assert.deepEqual(saved.booking, later.booking);
    const retry = await submit(later);
    assert.equal(retry.status, 200);
    assert.deepEqual((await retry.json()).record, saved);
    const superseded = await submit(earlier);
    assert.equal(superseded.status, 409);
    assert.deepEqual(await superseded.json(), { ok: false, conflict: "superseded_booking", record: saved });
  });
}

test("V2 booking checks the request and server Hong Kong slot windows while allowing an accepted expired retry", async () => {
  const payload = unlock();
  const boundary = createReelsV2Store({ pool: db, encryptionKey, now: () => new Date("2026-11-18T15:00:00.000Z") });
  const booked = { ...payload, event_type: "booking_intent", booking };
  const afterWindow = createReelsV2Store({ pool: db, encryptionKey, now: () => new Date("2026-11-20T12:00:00.000Z") });
  await store.save(payload);
  assert.equal((await submit({ ...booked, booking: { ...booking, date: "2026-11-22" } })).status, 400);
  assert.equal((await submit({ ...booked, booking: { ...booking, timeSlot: "10am-12pm" } })).status, 400);
  assert.equal((await submit({ ...booked, submitted_at: "2026-11-18T15:00:00.001Z" }, undefined, boundary)).status, 400);
  assert.equal((await submit(booked, undefined, afterWindow)).status, 400);
  assert.equal((await submit(booked)).status, 200);
  assert.equal((await submit(booked, undefined, afterWindow)).status, 200);
  assert.equal((await submit({ ...booked, submitted_at: "2026-11-18T02:00:10.000Z" }, undefined, afterWindow)).status, 400);
  assert.deepEqual((await afterWindow.find(payload.submission_id)).booking, booking);
});

test("V2 authentication and ciphertext are isolated from V1 at the same UUID and token", async () => {
  const payload = unlock();
  await store.save(payload);
  assert.equal(await v1.find(payload.submission_id), null);
  assert.equal((await submit({ ...payload, submission_token: randomUUID() })).status, 403);
  assert.equal((await submit({ ...payload, event_type: "booking_intent", booking, submission_token: randomUUID() })).status, 403);
  const v1Contact = { ...payload.user, email: "v1-person@example.test" };
  await v1.save({ ...payload, user: v1Contact });
  const v1Only = unlock();
  await v1.save(v1Only);
  assert.equal(await store.find(v1Only.submission_id), null);
  assert.equal((await submit({ ...v1Only, event_type: "booking_intent", booking })).status, 409);
  assert.equal((await v1.find(payload.submission_id)).user.email, v1Contact.email);
  assert.equal((await store.find(payload.submission_id)).user.email, payload.user.email);
  const { rows: [v1Raw] } = await db.query("SELECT payload_ciphertext FROM hd_reels_submissions WHERE id = $1", [payload.submission_id]);
  assert.throws(() => decrypt(v1Raw.payload_ciphertext, `hd_reels_v2_submissions:${payload.submission_id}`));
});

test("V2 submission rejects invalid versions, identity, source, timestamp, answers and contact data", async () => {
  const payload = unlock();
  for (const [description, fields] of [
    ["version missing", { schema_version: undefined }],
    ["version as string", { schema_version: "2" }],
    ["V1 version", { schema_version: 1 }],
    ["ID", { submission_id: "invalid" }],
    ["token", { submission_token: "invalid" }],
    ["identical UUIDs", { submission_token: payload.submission_id.toUpperCase() }],
    ["future time", { submitted_at: "2026-11-18T02:05:30.001Z" }],
    ["invalid date", { submitted_at: "2026-02-30T02:00:00.000Z" }],
    ["event", { event_type: "__proto__" }],
    ["day", { day_entry: "1" }],
    ["axis", { axis_entry: "unknown" }],
    ["Q1 from the wrong axis", { answers: { ...payload.answers, q1: mitoAnswer } }],
    ["unknown answer", { answers: { ...payload.answers, q2: ["unknown"] } }],
    ["duplicate answer", { answers: { ...payload.answers, q2: [metabolicAnswer, metabolicAnswer] } }],
    ["mixed none and signal", { answers: { ...payload.answers, q2: [metabolicAnswer, "以上皆無"] } }],
    ["missing answer", { answers: { ...payload.answers, q7: undefined } }],
    ["danger at unlock", { answers: { ...payload.answers, q6: [redFlag] } }],
    ["invalid telephone", { user: { ...payload.user, phone: "85298760001" } }],
    ["invalid email", { user: { ...payload.user, email: "user@invalid" } }],
    ["nonboolean consent", { user: { ...payload.user, marketingConsent: "false" } }],
    ["invalid height", { user: { ...payload.user, heightCm: "129" } }],
    ["invalid weight", { user: { ...payload.user, weightKg: 181 } }],
  ]) {
    assert.equal((await submit({ ...payload, ...fields })).status, 400, description);
  }
  for (const field of ["name", "phone", "email", "ageRange", "gender", "heightCm", "weightKg"]) {
    assert.equal((await submit({ ...payload, user: { ...payload.user, [field]: undefined } })).status, 400, field);
  }
  assert.equal(await store.find(payload.submission_id), null);
  assert.equal((await submit({ ...payload, submitted_at: "2026-11-18T02:05:30.000Z" })).status, 200);
});

test("V2 submission enforces checkout email syntax and length before writing a row", async () => {
  const longest = `${"a".repeat(64)}@${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(61)}`;
  for (const email of [
    "qa@-example.test",
    "qa@example-.test",
    "qa@example..test",
    "qa:contact@example.test",
    `qa@${"e".repeat(64)}.test`,
    `${longest}e`,
  ]) {
    const payload = unlock();
    payload.user.email = email;
    assert.equal((await submit(payload)).status, 400, email);
    assert.equal(await store.find(payload.submission_id), null, email);
  }
  for (const email of ["qa+health@sub-example.test", longest]) {
    const payload = unlock();
    payload.user.email = email;
    assert.equal((await submit(payload)).status, 200, email);
    assert.equal((await store.find(payload.submission_id)).user.email, email);
  }
});

test("V2 submission normalizes valid HTML number measurements before calculating BMI", async () => {
  for (const [heightCm, weightKg] of [
    ["1.65e2", "6.5E+1"],
    [".165E+3", "650e-1"],
    ["000000000000165", "65.0000000000"],
    [165, 65],
  ]) {
    const payload = unlock({ bmi: { bmi: 5 } });
    Object.assign(payload.user, { heightCm, weightKg });
    assert.equal((await submit(payload)).status, 200, `${heightCm}, ${weightKg}`);
    const saved = await store.find(payload.submission_id);
    assert.equal(saved.user.heightCm, 165);
    assert.equal(saved.user.weightKg, 65);
    assert.equal(saved.bmi.bmi, 23.9);
  }
});

test("V2 submission rejects measurements outside HTML number syntax or BMI limits", async () => {
  for (const [field, values] of [
    ["heightCm", ["0xa5", "+165", "165.", "1e309", "2.11e2"]],
    ["weightKg", ["0x41", "+65", "65.", "1e309", "1.81e2"]],
  ]) {
    for (const value of values) {
      const payload = unlock();
      payload.user[field] = value;
      assert.equal((await submit(payload)).status, 400, `${field} ${value}`);
      assert.equal(await store.find(payload.submission_id), null);
    }
  }
});

test("V2 submission enforces the public HTTP boundary and hides storage errors", async () => {
  const payload = unlock();
  const method = await submit(undefined, { method: "GET" });
  assert.equal(method.status, 405);
  assert.equal(method.headers.get("allow"), "POST");
  assert.equal((await submit(payload, { requestOrigin: origin + "/" })).status, 403);
  assert.equal((await submit(payload, { type: "text/plain" })).status, 415);
  assert.equal((await submit(payload, { raw: "{" })).status, 400);
  assert.equal((await submit([], {})).status, 400);
  const raw = JSON.stringify(payload);
  assert.equal((await submit(payload, { raw: raw.padEnd(raw.length + 12 * 1024 - Buffer.byteLength(raw) + 1) })).status, 413);
  assert.equal(await store.find(payload.submission_id), null);
  assert.equal((await submit(payload, { raw: raw.padEnd(raw.length + 12 * 1024 - Buffer.byteLength(raw)) })).status, 200);

  const unavailable = createReelsV2Store({ pool: { query: async () => { throw new Error("private database detail"); } }, encryptionKey, now });
  const error = await submit(unlock(), undefined, unavailable);
  assert.equal(error.status, 503);
  assert.equal((await error.text()).includes("private database detail"), false);
});

test("V2 submission rejects malformed UTF-8 instead of saving a replacement character", async () => {
  const payload = unlock();
  payload.user.name = "invalid@encoding";
  const raw = Buffer.from(JSON.stringify(payload));
  raw[raw.indexOf("@encoding")] = 0xff;
  assert.equal((await submit(payload, { raw })).status, 400);
  assert.equal(await store.find(payload.submission_id), null);
});

test("V2 submission store rejects sparse answer arrays from direct callers", async () => {
  const payload = unlock();
  payload.answers.q2 = Array(1);
  await assert.rejects(store.save(payload), { status: 400 });
  assert.equal(await store.find(payload.submission_id), null);
});

test("V2 submission encrypts answers as validated even if a caller later mutates its input", async () => {
  const payload = unlock();
  const saving = store.save(payload);
  payload.answers.q2[0] = "unexpected";
  await saving;
  assert.deepEqual((await store.find(payload.submission_id)).answers.q2, ["以上皆無"]);
});

test("anonymous V2 events accept every allowlisted value and use only the original server timestamp", async () => {
  const types = ["landing", "start", "checkout", "report_unlocked", "booking_intent", "whatsapp_opened"];
  const platforms = ["fb", "ig", "unknown"];
  const analyticsId = randomUUID();
  const payloads = Array.from({ length: 30 }, (_, i) => event({
    ...(i < types.length ? { analytics_id: analyticsId } : {}),
    event: types[i % types.length],
    platform: platforms[i % platforms.length],
    reel: String(i + 1).padStart(2, "0"),
  }));
  for (const payload of payloads) {
    const response = await track(payload, { headers: { "x-forwarded-for": "192.0.2.42", referer: "https://example.test/sensitive" } });
    assert.equal(response.status, 200, await response.clone().text());
    assert.deepEqual(await response.json(), { ok: true });
  }
  assert.equal(await store.find(analyticsId), null);
  const later = createReelsV2Events({ pool: db, now: () => new Date("2026-11-19T02:00:30.000Z") });
  const duplicate = await track({ ...payloads[0], analytics_id: analyticsId.toUpperCase(), platform: "ig", reel: "30" }, undefined, later);
  assert.equal(duplicate.status, 200);
  assert.deepEqual(await duplicate.json(), { ok: true });
  const rows = await events.list();
  const { rows: rawRows } = await db.query("SELECT * FROM hd_reels_v2_events");
  for (const source of [rows, rawRows]) {
    assert.equal(source.length, payloads.length);
    for (const payload of payloads) {
      const stored = source.find(row => row.analytics_id === payload.analytics_id && row.event === payload.event);
      assert.deepEqual(stored, { ...payload, created_at: new Date(serverTime) });
    }
  }
});

test("anonymous V2 events reject extra fields, sensitive data and values outside the allowlists", async () => {
  const payload = event();
  for (const field of [
    "created_at", "submitted_at", "timestamp", "url", "referrer", "ip", "headers", "submission_id", "submission_token",
    "name", "email", "phone", "contact", "user", "answers", "bmi", "medicines", "health_details", "__proto__",
  ]) {
    assert.equal((await track({ ...payload, [field]: "unexpected" })).status, 400, field);
  }
  for (const fields of [
    { analytics_id: undefined }, { analytics_id: "invalid" }, { event: "__proto__" }, { event: "quiz_unlocked" },
    { platform: "instagram" }, { reel: 1 }, { reel: "1" }, { reel: "00" }, { reel: "31" }, { reel: "01 " },
  ]) {
    assert.equal((await track({ ...payload, ...fields })).status, 400, JSON.stringify(fields));
  }
  assert.equal((await track([])).status, 400);
  assert.equal((await events.list()).some(row => row.analytics_id === payload.analytics_id), false);
});

test("anonymous V2 event store rejects hidden extra fields from direct callers", async () => {
  const payload = Object.defineProperty(event(), "referrer", { value: "https://example.test/sensitive" });
  await assert.rejects(events.record(payload), { status: 400 });
  assert.equal((await events.list()).some(row => row.analytics_id === payload.analytics_id), false);
});

test("anonymous V2 event HTTP limits and failures return safe status codes", async () => {
  const payload = event();
  const method = await track(undefined, { method: "GET" });
  assert.equal(method.status, 405);
  assert.equal(method.headers.get("allow"), "POST");
  assert.equal((await track(payload, { requestOrigin: origin + ".test" })).status, 403);
  assert.equal((await track(payload, { type: "application/x-www-form-urlencoded" })).status, 415);
  assert.equal((await track(payload, { raw: "{" })).status, 400);
  const raw = JSON.stringify(payload);
  assert.equal((await track(payload, { raw: raw.padEnd(1025) })).status, 413);
  assert.equal((await events.list()).some(row => row.analytics_id === payload.analytics_id), false);
  assert.equal((await track(payload, { raw: raw.padEnd(1024), type: "application/json; charset=utf-8" })).status, 200);

  const unavailable = createReelsV2Events({ pool: { query: async () => { throw new Error("private database detail"); } }, now });
  const error = await track(event(), undefined, unavailable);
  assert.equal(error.status, 503);
  assert.equal((await error.text()).includes("private database detail"), false);
});
