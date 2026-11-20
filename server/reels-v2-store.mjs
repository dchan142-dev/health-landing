import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import pg from "pg";
import {
  AGE_RANGES,
  AXES_META,
  DAY_TO_AXIS,
  GENDERS,
  QUESTIONS,
  STORES,
  buildBookingDates,
  computeBMI,
  evaluateAxes,
  hasRedFlags,
} from "../reels-quiz-v2/quiz-data.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// HTML email syntax with the checkout requirement for a dotted domain.
const CHECKOUT_EMAIL = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;
const HTML_NUMBER = /^-?(?:\d+|\d*\.\d+)(?:[eE][+-]?\d+)?$/;
const EVENT_RANK = { triage_aborted_level1: 0, quiz_unlocked: 1, booking_intent: 2 };

const TABLE = "hd_reels_v2_submissions";
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS ${TABLE} (
    id uuid PRIMARY KEY,
    token_hash text NOT NULL,
    event_rank smallint NOT NULL CHECK (event_rank BETWEEN 0 AND 2),
    client_submitted_at timestamptz NOT NULL,
    payload_ciphertext text NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT NOW()
  )`;

const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const isUuid = value => typeof value === "string" && UUID.test(value);
const cleanText = value => typeof value === "string" ? value.trim() : "";

function inputError(status = 400) {
  return Object.assign(new Error("Invalid quiz submission"), { status });
}

function readAnswers(candidate, axis, triage) {
  const ids = triage ? ["q6"] : ["q1", ...Object.keys(QUESTIONS)];
  if (!object(candidate) || Reflect.ownKeys(candidate).length !== ids.length ||
      !ids.every(id => Object.hasOwn(candidate, id))) throw inputError();
  const answers = {};
  for (const id of ids) {
    const value = candidate[id];
    const options = id === "q1" ? AXES_META[axis].q1Opts : QUESTIONS[id].opts;
    if (id === "q1" || QUESTIONS[id].mode === "single") {
      if (!options.some(option => option.val === value)) throw inputError();
      answers[id] = value;
    } else {
      if (!Array.isArray(value) || !value.length || value.length > options.length || new Set(value).size !== value.length) {
        throw inputError();
      }
      const selected = Array.from(value, answer => options.find(option => option.val === answer));
      if (selected.some(option => !option) || (value.length > 1 && selected.some(option => option.isNone))) {
        throw inputError();
      }
      answers[id] = selected.map(option => option.val);
    }
  }
  if (hasRedFlags(answers) !== triage) throw inputError();
  return answers;
}

function readMeasurement(value) {
  if (typeof value === "number") return value;
  const text = cleanText(value);
  return HTML_NUMBER.test(text) ? Number(text) : NaN;
}

function readUser(candidate) {
  if (!object(candidate)) throw inputError();
  const { ageRange, gender, marketingConsent } = candidate;
  const name = cleanText(candidate.name);
  const phone = cleanText(candidate.phone);
  const email = cleanText(candidate.email);
  if (!name || name.length > 100 || /[\u0000-\u001f\u007f]/.test(name) ||
      !/^\d{8}$/.test(phone) || email.length > 254 || !CHECKOUT_EMAIL.test(email) ||
      !AGE_RANGES.includes(ageRange) || !GENDERS.includes(gender) ||
      (marketingConsent !== undefined && typeof marketingConsent !== "boolean")) {
    throw inputError();
  }
  const heightCm = readMeasurement(candidate.heightCm);
  const weightKg = readMeasurement(candidate.weightKg);
  return { name, phone, email, ageRange, gender, heightCm, weightKg, marketingConsent: marketingConsent === true };
}

function eligibleDate(candidate, now) {
  return buildBookingDates(now).find(date => date.iso === candidate.date && date.slots.includes(candidate.timeSlot));
}

function readBooking(candidate, now) {
  if (!object(candidate) || !STORES.includes(candidate.store)) throw inputError();
  const available = eligibleDate(candidate, now);
  if (!available) throw inputError();
  return { store: candidate.store, date: available.iso, weekday: available.weekday, timeSlot: candidate.timeSlot };
}

function readIdentity(payload) {
  if (payload?.schema_version !== 2 || !isUuid(payload.submission_id) || !isUuid(payload.submission_token)) throw inputError();
  const id = payload.submission_id.toLowerCase();
  const token = payload.submission_token.toLowerCase();
  if (id === token) throw inputError();
  return { id, tokenHash: createHash("sha256").update(token).digest("hex") };
}

function normalize(payload, now) {
  const { submission_id, submitted_at, event_type, day_entry, axis_entry } = payload;
  if (typeof submitted_at !== "string" || typeof event_type !== "string" || !Object.hasOwn(EVENT_RANK, event_type) ||
      typeof day_entry !== "string" || !Object.hasOwn(DAY_TO_AXIS, day_entry) ||
      typeof axis_entry !== "string" || !Object.hasOwn(AXES_META, axis_entry)) {
    throw inputError();
  }
  const timestamp = new Date(submitted_at);
  if (!Number.isFinite(timestamp.getTime()) || timestamp.toISOString() !== submitted_at ||
      timestamp.getTime() > now.getTime() + 5 * 60 * 1000) {
    throw inputError();
  }
  const triage = event_type === "triage_aborted_level1";
  const answers = readAnswers(payload.answers, axis_entry, triage);
  const user = triage ? null : readUser(payload.user);
  const bmi = triage ? null : computeBMI(user.heightCm, user.weightKg);
  if (!triage && !bmi) throw inputError();
  const report = triage ? null : evaluateAxes(axis_entry, answers);
  const booking = event_type === "booking_intent" ? readBooking(payload.booking, timestamp) : null;
  return {
    schema_version: 2,
    submission_id: submission_id.toLowerCase(),
    submitted_at,
    event_type,
    user,
    day_entry,
    axis_entry,
    bmi,
    scoring_version: "v2",
    top_axis: report?.winnerId ?? null,
    ratios: report?.ratios ?? null,
    evidence: report?.evidence ?? null,
    evidence_count: report?.evidenceCount ?? null,
    answers,
    booking,
  };
}

export function createReelsV2Store({ pool, encryptionKey, now = () => new Date() }) {
  const key = Buffer.from(encryptionKey ?? "", "base64");
  if (!pool || key.length !== 32) throw new Error("Reels V2 storage configuration is incomplete");
  let schemaReady;

  function initialize() {
    schemaReady ??= pool.query(SCHEMA).catch(error => {
      // Concurrent first requests from separate function instances may reach the catalog together.
      if (["23505", "42P07"].includes(error.code)) return pool.query(SCHEMA);
      throw error;
    }).catch(error => {
      schemaReady = undefined;
      throw error;
    });
    return schemaReady;
  }

  function seal(record) {
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, nonce);
    cipher.setAAD(Buffer.from(`${TABLE}:${record.submission_id}`));
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(record), "utf8"), cipher.final()]);
    return Buffer.concat([nonce, cipher.getAuthTag(), encrypted]).toString("base64");
  }

  function unseal({ id, payload_ciphertext }) {
    const bytes = Buffer.from(payload_ciphertext, "base64");
    const decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12));
    decipher.setAAD(Buffer.from(`${TABLE}:${id}`));
    decipher.setAuthTag(bytes.subarray(12, 28));
    return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8"));
  }

  function verifyToken(existing, tokenHash) {
    if (existing && !timingSafeEqual(Buffer.from(existing.token_hash, "hex"), Buffer.from(tokenHash, "hex"))) {
      throw inputError(403);
    }
  }

  async function authorizedRow(id, tokenHash) {
    const { rows: [row] } = await pool.query(
      `SELECT id, token_hash, payload_ciphertext FROM ${TABLE} WHERE id = $1`, [id],
    );
    verifyToken(row, tokenHash);
    return row;
  }

  async function resume(payload) {
    const { id, tokenHash } = readIdentity(payload);
    await initialize();
    const row = await authorizedRow(id, tokenHash);
    const record = row && unseal(row);
    if (!record?.user) throw inputError(404);
    return record;
  }

  function reconcile(current, incoming, receivedAt, expectedUnlockRevision) {
    const { event_type, submitted_at } = incoming;
    if (event_type === "triage_aborted_level1") {
      const retain = current && (current.event_type !== event_type || current.submitted_at >= submitted_at);
      return { record: retain ? current : incoming };
    }
    // Older encrypted rows predate the separate unlock revision. A booking keeps its
    // own timestamp when a visitor corrects the report or withdraws consent.
    const unlockTime = current?.unlock_submitted_at ?? current?.submitted_at;
    if (event_type === "booking_intent") {
      if (!current?.user) throw inputError(409);
      if (current.booking && current.submitted_at >= submitted_at) {
        const conflict = isDeepStrictEqual(current.booking, incoming.booking) ? undefined : "superseded_booking";
        return { record: current, conflict };
      }
      if (!eligibleDate(incoming.booking, receivedAt)) throw inputError();
      return { record: { ...current, unlock_submitted_at: unlockTime, event_type, submitted_at, booking: incoming.booking } };
    }
    if (current?.user) {
      const currentRevision = current.unlock_revision ?? unlockTime;
      // Early booked rows lost the unlock time. An unversioned replay with the
      // same normalized contents can acknowledge that row without changing it.
      const legacyRetry = !current.unlock_revision && incoming.unlock_revision === submitted_at && submitted_at <= unlockTime;
      const sameRevision = incoming.unlock_revision === currentRevision && submitted_at === unlockTime;
      const retry = (sameRevision || legacyRetry) &&
        current.day_entry === incoming.day_entry && current.axis_entry === incoming.axis_entry &&
        isDeepStrictEqual(current.user, incoming.user) && isDeepStrictEqual(current.answers, incoming.answers);
      if (retry) return { record: current };
      if (expectedUnlockRevision !== currentRevision || incoming.unlock_revision === currentRevision || submitted_at <= unlockTime) {
        return { record: current, conflict: "superseded_unlock" };
      }
    }
    const record = { ...incoming, unlock_submitted_at: submitted_at };
    if (current?.booking) Object.assign(record, {
      event_type: current.event_type, submitted_at: current.submitted_at, booking: current.booking,
    });
    return { record };
  }

  async function save(payload) {
    const receivedAt = now();
    const { id, tokenHash } = readIdentity(payload);
    const incoming = normalize(payload, receivedAt);
    const expectedUnlockRevision = payload.expected_unlock_revision;
    if (incoming.event_type === "quiz_unlocked") {
      if (payload.unlock_revision !== undefined && !isUuid(payload.unlock_revision)) throw inputError();
      incoming.unlock_revision = payload.unlock_revision ?? incoming.submitted_at;
    }
    await initialize();
    // Compare the exact ciphertext read. A concurrent change in either the booking
    // or the report forces a fresh authorized read and a new merge of both fields.
    for (;;) {
      const row = await authorizedRow(id, tokenHash);
      const current = row && unseal(row);
      const result = reconcile(current, incoming, receivedAt, expectedUnlockRevision);
      const { record } = result;
      if (record === current) return result;
      const values = [id, tokenHash, EVENT_RANK[record.event_type], record.submitted_at, seal(record)];
      const written = row
        ? await pool.query(`
            UPDATE ${TABLE} SET event_rank = $3, client_submitted_at = $4, payload_ciphertext = $5, updated_at = NOW()
            WHERE id = $1 AND token_hash = $2 AND payload_ciphertext = $6 RETURNING id`, [...values, row.payload_ciphertext])
        : await pool.query(`
            INSERT INTO ${TABLE} (id, token_hash, event_rank, client_submitted_at, payload_ciphertext)
            VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING RETURNING id`, values);
      if (written.rows.length) return result;
    }
  }

  async function find(id) {
    if (!isUuid(id)) return null;
    await initialize();
    const { rows: [record] } = await pool.query(
      `SELECT id, payload_ciphertext FROM ${TABLE} WHERE id = $1`, [id],
    );
    return record ? unseal(record) : null;
  }

  async function list() {
    await initialize();
    const { rows } = await pool.query(`SELECT id, payload_ciphertext FROM ${TABLE} ORDER BY updated_at DESC, id`);
    return rows.map(unseal);
  }

  return { initialize, save, resume, find, list };
}

let productionStore;
export function productionReelsV2Store() {
  if (!productionStore) {
    const { DATABASE_URL, DATA_ENCRYPTION_KEY } = process.env;
    if (!DATABASE_URL || !DATA_ENCRYPTION_KEY) throw new Error("Reels V2 storage configuration is incomplete");
    const pool = new pg.Pool({
      connectionString: DATABASE_URL,
      max: 3,
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 20000,
    });
    productionStore = createReelsV2Store({ pool, encryptionKey: DATA_ENCRYPTION_KEY });
  }
  return productionStore;
}
