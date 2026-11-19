import pg from "pg";
import { DAY_TO_AXIS } from "../reels-quiz-v2/quiz-data.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EVENTS = new Set(["landing", "start", "checkout", "report_unlocked", "booking_intent", "whatsapp_opened"]);
const PLATFORMS = new Set(["fb", "ig", "unknown"]);
const KEYS = ["analytics_id", "event", "platform", "reel"];
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS hd_reels_v2_events (
    analytics_id uuid NOT NULL,
    event text NOT NULL,
    platform text NOT NULL,
    reel char(2) NOT NULL,
    created_at timestamptz NOT NULL,
    PRIMARY KEY (analytics_id, event)
  )`;

function validate(payload) {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload) ||
      Reflect.ownKeys(payload).length !== KEYS.length || !KEYS.every(key => Object.hasOwn(payload, key)) ||
      typeof payload.analytics_id !== "string" || !UUID.test(payload.analytics_id) ||
      !EVENTS.has(payload.event) || !PLATFORMS.has(payload.platform) ||
      typeof payload.reel !== "string" || !Object.hasOwn(DAY_TO_AXIS, payload.reel)) {
    throw Object.assign(new Error("Invalid V2 funnel event"), { status: 400 });
  }
}

export function createReelsV2Events({ pool, now = () => new Date() }) {
  if (!pool) throw new Error("Reels V2 event storage configuration is incomplete");
  let schemaReady;

  function initialize() {
    schemaReady ??= pool.query(SCHEMA).catch(error => {
      // Concurrent first requests may create the schema in separate function instances.
      if (["23505", "42P07"].includes(error.code)) return pool.query(SCHEMA);
      throw error;
    }).catch(error => {
      schemaReady = undefined;
      throw error;
    });
    return schemaReady;
  }

  async function record(payload) {
    validate(payload);
    const { analytics_id, event, platform, reel } = payload;
    const createdAt = now();
    await initialize();
    await pool.query(`
      INSERT INTO hd_reels_v2_events (analytics_id, event, platform, reel, created_at)
      VALUES ($1, $2, $3, $4, $5) ON CONFLICT (analytics_id, event) DO NOTHING`,
      [analytics_id, event, platform, reel, createdAt],
    );
  }

  async function list() {
    await initialize();
    const { rows } = await pool.query(`
      SELECT analytics_id, event, platform, reel, created_at FROM hd_reels_v2_events
      ORDER BY created_at, analytics_id, event`);
    return rows;
  }

  return { initialize, record, list };
}

let productionEvents;
export function productionReelsV2Events() {
  if (!productionEvents) {
    const { DATABASE_URL } = process.env;
    if (!DATABASE_URL) throw new Error("Reels V2 event storage configuration is incomplete");
    const pool = new pg.Pool({
      connectionString: DATABASE_URL,
      max: 3,
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 20000,
    });
    productionEvents = createReelsV2Events({ pool });
  }
  return productionEvents;
}
