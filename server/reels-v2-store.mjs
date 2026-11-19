import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";
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

function readUser(candidate) {
  if (!object(candidate)) throw inputError();
  const { ageRange, gender, marketingConsent } = candidate;
  const name = cleanText(candidate.name);
  const phone = cleanText(candidate.phone);
  const email = cleanText(candidate.email);
  const numeric = value => typeof value === "number" ? String(value) : cleanText(value);
  const heightCm = numeric(candidate.heightCm);
  const weightKg = numeric(candidate.weightKg);
  if (!name || name.length > 100 || /[\u0000-\u001f\u007f]/.test(name) ||
      !/^\d{8}$/.test(phone) || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      !AGE_RANGES.includes(ageRange) || !GENDERS.includes(gender) ||
      (marketingConsent !== undefined && typeof marketingConsent !== "boolean") ||
      !/^\d+(\.\d+)?$/.test(heightCm) || !/^\d+(\.\d+)?$/.test(weightKg) ||
      heightCm.length > 12 || weightKg.length > 12) {
    throw inputError();
  }
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

function normalize(payload, now) {
  if (!object(payload) || payload.schema_version !== 2) throw inputError();
  const { submission_id, submission_token, submitted_at, event_type, day_entry, axis_entry } = payload;
  if (!isUuid(submission_id) || !isUuid(submission_token) || submission_id.toLowerCase() === submission_token.toLowerCase() ||
      typeof submitted_at !== "string" || typeof event_type !== "string" || !Object.hasOwn(EVENT_RANK, event_type) ||
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

  async function saveBooking(record, tokenHash, receivedAt) {
    const { rows: [existing] } = await pool.query(`
      SELECT id, token_hash, event_rank, payload_ciphertext, client_submitted_at >= $2 AS newer_or_same
      FROM ${TABLE} WHERE id = $1`, [record.submission_id, record.submitted_at]);
    verifyToken(existing, tokenHash);
    if (!existing || existing.event_rank < EVENT_RANK.quiz_unlocked) throw inputError(409);
    if (existing.event_rank === EVENT_RANK.booking_intent && existing.newer_or_same) return;
    if (!eligibleDate(record.booking, receivedAt)) throw inputError();

    const booked = {
      ...unseal(existing),
      event_type: record.event_type,
      submitted_at: record.submitted_at,
      booking: record.booking,
    };
    // The original unlock snapshot is immutable. The write predicate also protects against a
    // newer booking committing between the read and this update.
    await pool.query(`
      UPDATE ${TABLE}
      SET event_rank = $3, client_submitted_at = $4, payload_ciphertext = $5, updated_at = NOW()
      WHERE id = $1 AND token_hash = $2 AND event_rank >= 1
        AND (event_rank < $3 OR client_submitted_at < $4)`,
      [record.submission_id, tokenHash, EVENT_RANK.booking_intent, record.submitted_at, seal(booked)],
    );
  }

  async function save(payload) {
    const receivedAt = now();
    const record = normalize(payload, receivedAt);
    const rank = EVENT_RANK[record.event_type];
    const tokenHash = createHash("sha256").update(payload.submission_token.toLowerCase()).digest("hex");
    await initialize();
    if (record.event_type === "booking_intent") return saveBooking(record, tokenHash, receivedAt);

    const { rows } = await pool.query(`
      INSERT INTO ${TABLE} AS saved (id, token_hash, event_rank, client_submitted_at, payload_ciphertext)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (id) DO UPDATE SET event_rank = excluded.event_rank,
        client_submitted_at = excluded.client_submitted_at,
        payload_ciphertext = excluded.payload_ciphertext, updated_at = NOW()
      WHERE saved.token_hash = excluded.token_hash
        AND (saved.event_rank < excluded.event_rank OR
          (saved.event_rank = 0 AND excluded.event_rank = 0 AND saved.client_submitted_at < excluded.client_submitted_at))
      RETURNING id`, [record.submission_id, tokenHash, rank, record.submitted_at, seal(record)]);
    if (rows.length) return;

    const { rows: [existing] } = await pool.query(`SELECT token_hash FROM ${TABLE} WHERE id = $1`, [record.submission_id]);
    verifyToken(existing, tokenHash);
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

  return { initialize, save, find, list };
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
