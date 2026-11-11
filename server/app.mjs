import { betterAuth } from "better-auth";
import { admin } from "better-auth/plugins";
import { getMigrations } from "better-auth/db/migration";
import {
  randomUUID,
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { readFile } from "node:fs/promises";
import { validateAnswers, progress } from "../intake/schema.mjs";

const prefix = "/api/health-intake";
export function createApplication({
  pool,
  origin,
  secret,
  encryptionKey,
  production = true,
}) {
  const key = encryptionKey
    ? Buffer.from(encryptionKey, "base64")
    : createHash("sha256")
        .update(secret + ":local-test-data")
        .digest();
  if (
    !origin ||
    !secret ||
    secret.length < 32 ||
    key.length !== 32 ||
    (production && !encryptionKey) ||
    (production && !origin.startsWith("https://"))
  )
    throw new Error("Invalid server configuration");
  const auth = betterAuth({
    database: pool,
    baseURL: origin,
    basePath: prefix + "/auth",
    secret,
    trustedOrigins: [origin],
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      autoSignIn: false,
    },
    session: {
      expiresIn: 28800,
      updateAge: 3600,
      cookieCache: { enabled: false },
    },
    rateLimit: {
      enabled: production,
      storage: "database",
      window: 60,
      max: 30,
      customRules: { "/sign-in/email": { window: 60, max: 5 } },
    },
    advanced: { useSecureCookies: production },
    plugins: [admin()],
    logger: { disabled: true },
  });
  function seal(answers) {
    const nonce = randomBytes(12),
      cipher = createCipheriv("aes-256-gcm", key, nonce);
    const encrypted = Buffer.concat([
      cipher.update(JSON.stringify(answers), "utf8"),
      cipher.final(),
    ]);
    return Buffer.concat([nonce, cipher.getAuthTag(), encrypted]).toString(
      "base64",
    );
  }
  function unseal(value) {
    const bytes = Buffer.from(value, "base64"),
      decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12));
    decipher.setAuthTag(bytes.subarray(12, 28));
    return JSON.parse(
      Buffer.concat([
        decipher.update(bytes.subarray(28)),
        decipher.final(),
      ]).toString("utf8"),
    );
  }
  const json = (value, status = 200) => Response.json(value, { status });
  const audit = (actor, action, id = null) =>
    pool.query(
      "INSERT INTO hd_audit (id,actor_id,action,record_id) VALUES ($1,$2,$3,$4)",
      [randomUUID(), actor, action, id],
    );
  function record(row) {
    if (!row)
      return {
        id: null,
        version: 0,
        answers: {},
        step: 0,
        status: "draft",
        updatedAt: null,
      };
    return {
      id: row.id,
      version: row.version,
      answers: unseal(row.answers_ciphertext),
      step: row.step,
      status: row.status,
      updatedAt: row.updated_at,
      submittedAt: row.submitted_at,
    };
  }
  async function body(request) {
    if (!request.headers.get("content-type")?.startsWith("application/json"))
      throw Object.assign(new Error("請使用JSON格式"), { status: 415 });
    const raw = await request.text();
    if (Buffer.byteLength(raw) > 262144)
      throw Object.assign(new Error("資料太大，請縮短內容"), { status: 413 });
    let value;
    try {
      value = JSON.parse(raw);
    } catch {
      throw Object.assign(new Error("資料格式不正確"), { status: 400 });
    }
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw Object.assign(new Error("資料格式不正確"), { status: 400 });
    return value;
  }
  const validDraft = (v) =>
    Object.keys(v).every((k) =>
      ["accountId", "version", "step", "answers"].includes(k),
    ) &&
    typeof v.accountId === "string" &&
    Number.isSafeInteger(v.version) &&
    v.version >= 0 &&
    Number.isInteger(v.step) &&
    v.step >= 0 &&
    v.step <= 7 &&
    validateAnswers(v.answers);
  async function route(request) {
    const url = new URL(request.url),
      path = url.pathname.slice(prefix.length).replace(/\/$/, "") || "/";
    if (
      !["GET", "HEAD"].includes(request.method) &&
      request.headers.get("origin") !== origin
    )
      return json({ error: "請從本站頁面操作，重新登入後再試" }, 403);
    if (path.startsWith("/auth/")) {
      if (
        ![
          "/auth/sign-in/email",
          "/auth/sign-out",
          "/auth/get-session",
          "/auth/change-password",
        ].includes(path)
      )
        return json({ error: "帳號由跟進者建立，請聯絡跟進者" }, 403);
      return auth.handler(request);
    }
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) return json({ error: "登入已過期，請重新登入" }, 401);
    const user = session.user;
    if (path === "/session" && request.method === "GET")
      return json({
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role || "user",
        },
      });
    if (path.startsWith("/admin/") && user.role !== "admin")
      return json({ error: "你沒有管理員權限" }, 403);
    if (path === "/record") {
      if (request.method === "GET")
        return json(
          record(
            (
              await pool.query("SELECT * FROM hd_record WHERE user_id=$1", [
                user.id,
              ])
            ).rows[0],
          ),
        );
      if (request.method !== "PUT") return json({ error: "不支援此操作" }, 405);
      const v = await body(request);
      if (!validDraft(v))
        return json({ error: "欄位格式不正確，請重新整理後再試" }, 400);
      if (v.accountId !== user.id)
        return json(
          {
            error:
              "登入帳號已改變，這頁答案未儲存。請先下載答案，再以原本帳號登入。",
            code: "SESSION_CHANGED",
          },
          409,
        );
      const current = (
        await pool.query(
          "SELECT id,version,status FROM hd_record WHERE user_id=$1",
          [user.id],
        )
      ).rows[0];
      if (current?.status === "submitted")
        return json({ error: "問卷已提交；如需修改請聯絡跟進者重開" }, 423);
      const saved =
        v.version === 0 && !current
          ? await pool.query(
              "INSERT INTO hd_record (id,user_id,answers_ciphertext,step) VALUES ($1,$2,$3,$4) ON CONFLICT (user_id) DO NOTHING RETURNING *",
              [randomUUID(), user.id, seal(v.answers), v.step],
            )
          : await pool.query(
              "UPDATE hd_record SET answers_ciphertext=$1,step=$2,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE user_id=$3 AND version=$4 AND status='draft' RETURNING *",
              [seal(v.answers), v.step, user.id, v.version],
            );
      if (!saved.rows[0])
        return json(
          {
            error: "另一個分頁已更新紀錄。請先保留畫面內容，再重新載入。",
            code: "VERSION_CONFLICT",
          },
          409,
        );
      return json(record(saved.rows[0]));
    }
    if (path === "/submit" && request.method === "POST") {
      const v = await body(request);
      if (v.accountId !== user.id)
        return json(
          {
            error: "登入帳號已改變，請以原本帳號登入後再提交。",
            code: "SESSION_CHANGED",
          },
          409,
        );
      if (!Number.isSafeInteger(v.version))
        return json({ error: "版本不正確" }, 400);
      const row = (
        await pool.query("SELECT * FROM hd_record WHERE user_id=$1", [user.id])
      ).rows[0];
      if (!row) return json({ error: "請先儲存問卷" }, 422);
      if (row.version !== v.version)
        return json(
          { error: "紀錄已更新，請重新載入", code: "VERSION_CONFLICT" },
          409,
        );
      const answers = unseal(row.answers_ciphertext);
      if (!answers.clientName?.trim() || answers.consent !== true)
        return json({ error: "請填寫稱呼，並確認資料使用及提交" }, 422);
      const saved = await pool.query(
        "UPDATE hd_record SET status='submitted',version=version+1,submitted_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE user_id=$1 AND version=$2 AND status='draft' RETURNING *",
        [user.id, v.version],
      );
      if (!saved.rows[0])
        return json(
          { error: "紀錄已更新或已提交", code: "VERSION_CONFLICT" },
          409,
        );
      await audit(user.id, "submit", row.id);
      return json(record(saved.rows[0]));
    }
    if (path === "/admin/records" && request.method === "GET") {
      const result = await pool.query(
        "SELECT u.id AS client_id,u.name,u.email,r.* FROM \"user\" u LEFT JOIN hd_record r ON r.user_id=u.id WHERE COALESCE(u.role,'user') <> 'admin' ORDER BY r.updated_at DESC NULLS LAST,u.name",
      );
      return json({
        records: result.rows.map((r) => ({
          id: r.id || null,
          userId: r.client_id,
          name: r.name,
          email: r.email,
          status: r.status || "not_started",
          version: r.version || 0,
          updatedAt: r.updated_at,
          progress: progress(
            r.answers_ciphertext ? unseal(r.answers_ciphertext) : {},
          ),
        })),
      });
    }
    if (path === "/admin/clients" && request.method === "POST") {
      const v = await body(request);
      if (
        typeof v.name !== "string" ||
        !v.name.trim() ||
        v.name.length > 100 ||
        typeof v.email !== "string" ||
        v.email.length > 254 ||
        !/^\S+@\S+\.\S+$/.test(v.email) ||
        typeof v.password !== "string" ||
        v.password.length < 12 ||
        v.password.length > 128
      )
        return json({ error: "請填有效稱呼、電郵及12字元以上密碼" }, 400);
      try {
        const result = await auth.api.createUser({
          headers: request.headers,
          body: {
            name: v.name.trim(),
            email: v.email.trim().toLowerCase(),
            password: v.password,
            role: "user",
          },
        });
        await audit(user.id, "create_client", result.user.id);
        return json(
          {
            user: {
              id: result.user.id,
              name: result.user.name,
              email: result.user.email,
            },
          },
          201,
        );
      } catch {
        return json({ error: "未能建立帳號，請確認電郵是否已使用" }, 400);
      }
    }
    const detail = path.match(/^\/admin\/records\/([a-zA-Z0-9-]+)(\/reopen)?$/);
    if (detail) {
      const row = (
        await pool.query("SELECT * FROM hd_record WHERE id=$1", [detail[1]])
      ).rows[0];
      if (!row) return json({ error: "找不到紀錄" }, 404);
      if (!detail[2] && request.method === "GET") {
        await audit(user.id, "view_record", row.id);
        return json(record(row));
      }
      if (detail[2] && request.method === "POST") {
        const v = await body(request);
        if (!Number.isSafeInteger(v.version))
          return json({ error: "版本不正確" }, 400);
        const saved = await pool.query(
          "UPDATE hd_record SET status='draft',version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=$1 AND version=$2 RETURNING *",
          [row.id, v.version],
        );
        if (!saved.rows[0])
          return json(
            { error: "紀錄已更新，請重新載入", code: "VERSION_CONFLICT" },
            409,
          );
        await audit(user.id, "reopen_record", row.id);
        return json(record(saved.rows[0]));
      }
    }
    if (path === "/admin/reset-password" && request.method === "POST") {
      const v = await body(request);
      if (
        typeof v.userId !== "string" ||
        typeof v.password !== "string" ||
        v.password.length < 12 ||
        v.password.length > 128
      )
        return json({ error: "新密碼最少12字元" }, 400);
      const target = (
        await pool.query('SELECT id,role FROM "user" WHERE id=$1', [v.userId])
      ).rows[0];
      if (!target || target.role === "admin")
        return json({ error: "只可從此處重設客人密碼" }, 403);
      await auth.api.setUserPassword({
        headers: request.headers,
        body: { userId: v.userId, newPassword: v.password },
      });
      await auth.api.revokeUserSessions({
        headers: request.headers,
        body: { userId: v.userId },
      });
      await audit(user.id, "reset_password", v.userId);
      return json({ ok: true });
    }
    return json({ error: "找不到此操作" }, 404);
  }
  return {
    auth,
    async initialize() {
      const migration = await getMigrations(auth.options);
      await migration.runMigrations();
      const sql = await readFile(
        new URL("./schema.sql", import.meta.url),
        "utf8",
      );
      for (const statement of sql
        .split(";")
        .map((s) => s.trim())
        .filter(Boolean))
        await pool.query(statement);
    },
    async bootstrapAdmin({ name, email, password }) {
      const administrators = (
        await pool.query('SELECT id,email FROM "user" WHERE role=$1', ["admin"])
      ).rows;
      if (administrators.length) {
        if (
          administrators.some(
            (row) => row.email.toLowerCase() === email.trim().toLowerCase(),
          )
        )
          return { created: false };
        throw new Error("A different administrator already exists");
      }
      const result = await auth.api.signUpEmail({
        body: { name, email, password },
      });
      await pool.query('UPDATE "user" SET role=$1 WHERE id=$2', [
        "admin",
        result.user.id,
      ]);
      return { created: true };
    },
    async fetch(request) {
      let response;
      try {
        response = await route(request);
      } catch (error) {
        response = json(
          {
            error: error.status
              ? error.message
              : "暫時未能處理，答案未確認儲存。請稍後重試。",
          },
          error.status || 503,
        );
      }
      const headers = new Headers(response.headers);
      headers.set("cache-control", "private, no-store, max-age=0");
      headers.set("pragma", "no-cache");
      headers.set("x-content-type-options", "nosniff");
      return new Response(response.body, { status: response.status, headers });
    },
  };
}
