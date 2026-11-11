import pg from "pg";
import { createApplication } from "./app.mjs";

let instance;
export function application() {
  if (instance) return instance;
  const { DATABASE_URL, APP_ORIGIN, BETTER_AUTH_SECRET, DATA_ENCRYPTION_KEY } =
    process.env;
  if (
    !DATABASE_URL ||
    !APP_ORIGIN ||
    !BETTER_AUTH_SECRET ||
    !DATA_ENCRYPTION_KEY
  )
    throw new Error("Server configuration incomplete");
  const parsed = new URL(APP_ORIGIN);
  if (parsed.origin !== APP_ORIGIN || parsed.protocol !== "https:")
    throw new Error("APP_ORIGIN must be a fixed HTTPS origin");
  const pool = new pg.Pool({
    connectionString: DATABASE_URL,
    max: 3,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 20000,
  });
  instance = createApplication({
    pool,
    origin: APP_ORIGIN,
    secret: BETTER_AUTH_SECRET,
    encryptionKey: DATA_ENCRYPTION_KEY,
    production: true,
  });
  return instance;
}
