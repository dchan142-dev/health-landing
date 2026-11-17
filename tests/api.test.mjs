import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { createApplication } from "../server/app.mjs";
import { cleanupVerificationUsers } from "../scripts/verification-cleanup.mjs";

const origin = "http://localhost:3010";
let db, app, adminCookie, aliceCookie, bobCookie, databasePool;
const accountByCookie = new Map();
// A real PostgreSQL engine implements the pg boundary; no clinical data is used.
before(async () => {
  db = new PGlite();
  const query = async (text, params) => {
    const result = await db.query(
      typeof text === "string" ? text : text.text,
      params || text.values,
    );
    return { ...result, rowCount: result.affectedRows ?? result.rows.length };
  };
  const pool = {
    query,
    connect: async () => ({ query, release() {} }),
    end: async () => {},
  };
  databasePool = pool;
  app = createApplication({
    pool,
    origin,
    secret: "integration-test-secret-32-characters-minimum",
    production: false,
  });
  await app.initialize();
  await app.bootstrapAdmin({
    name: "測試管理員",
    email: "admin@example.test",
    password: "Admin-test-password-123!",
  });
});
after(async () => {
  await db?.close();
});

async function request(
  path,
  { method = "GET", body, cookie, requestOrigin = origin } = {},
) {
  if (body && ((path === "/record" && method === "PUT") || path === "/submit"))
    body = { accountId: accountByCookie.get(cookie), ...body };
  return app.fetch(
    new Request(origin + "/api/health-intake" + path, {
      method,
      headers: {
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...(cookie ? { cookie } : {}),
        ...(requestOrigin ? { origin: requestOrigin } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  );
}
async function login(email, password) {
  const response = await request("/auth/sign-in/email", {
    method: "POST",
    body: { email, password },
  });
  assert.equal(response.status, 200, await response.clone().text());
  const cookie = response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  accountByCookie.set(cookie, (await response.json()).user.id);
  return cookie;
}

test("anonymous requests cannot read the client record or administrative records", async () => {
  for (const path of ["/record", "/admin/records"])
    assert.equal((await request(path)).status, 401);
});
test("repeating deployment setup leaves the existing administrator and password unchanged", async () => {
  const result = await app.bootstrapAdmin({
    name: "Ignored replacement",
    email: "admin@example.test",
    password: "Must-not-replace-password-456!",
  });
  assert.equal(result.created, false);
  await login("admin@example.test", "Admin-test-password-123!");
  assert.equal(
    (
      await request("/auth/sign-in/email", {
        method: "POST",
        body: {
          email: "admin@example.test",
          password: "Must-not-replace-password-456!",
        },
      })
    ).status,
    401,
  );
  await assert.rejects(
    app.bootstrapAdmin({
      name: "Different administrator",
      email: "different@example.test",
      password: "Different-admin-password-456!",
    }),
  );
});
test("self-registration creates only a client who can save and resume their own record", async () => {
  const response = await request("/auth/sign-up/email", {
    method: "POST",
    body: {
      email: "self-signup@example.test",
      password: "Self-signup-password-123!",
      name: "自行登記測試",
      consent: true,
    },
  });
  assert.equal(response.status, 200, await response.clone().text());
  let cookie = await login(
    "self-signup@example.test",
    "Self-signup-password-123!",
  );
  assert.equal(
    (await (await request("/session", { cookie })).json()).user.role,
    "user",
  );
  assert.equal((await request("/admin/records", { cookie })).status, 403);
  assert.equal(
    (
      await request("/record", {
        method: "PUT",
        cookie,
        body: {
          version: 0,
          step: 2,
          answers: { clientName: "自行登記測試", goal: "續填測試" },
        },
      })
    ).status,
    200,
  );
  assert.equal(
    (await request("/auth/sign-out", { method: "POST", cookie, body: {} }))
      .status,
    200,
  );
  cookie = await login("self-signup@example.test", "Self-signup-password-123!");
  assert.equal(
    (await (await request("/record", { cookie })).json()).answers.goal,
    "續填測試",
  );
});
test("self-registration rejects privilege fields, missing consent and cross-site requests", async () => {
  const ordinary = {
    email: "rejected@example.test",
    password: "Rejected-password-123!",
    name: "不應建立",
    consent: true,
  };
  for (const body of [
    { ...ordinary, role: "admin" },
    { ...ordinary, emailVerified: true },
    { ...ordinary, userId: "existing-user" },
    { ...ordinary, consent: false },
  ])
    assert.equal(
      (await request("/auth/sign-up/email", { method: "POST", body })).status,
      400,
    );
  assert.equal(
    (
      await request("/auth/sign-up/email", {
        method: "POST",
        body: ordinary,
        requestOrigin: "https://attacker.example",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request("/auth/admin/create-user", {
        method: "POST",
        body: ordinary,
      })
    ).status,
    403,
  );
  assert.equal(
    (await db.query('SELECT id FROM "user" WHERE email=$1', [ordinary.email]))
      .rows.length,
    0,
  );
});
test("registering an existing email cannot replace its password, role or saved answers", async () => {
  for (const email of ["self-signup@example.test", "admin@example.test"]) {
    assert.equal(
      (
        await request("/auth/sign-up/email", {
          method: "POST",
          body: {
            email,
            name: "不可取代",
            password: "Replacement-password-123!",
            consent: true,
          },
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await request("/auth/sign-in/email", {
          method: "POST",
          body: { email, password: "Replacement-password-123!" },
        })
      ).status,
      401,
    );
  }
  const cookie = await login(
    "self-signup@example.test",
    "Self-signup-password-123!",
  );
  assert.equal(
    (await (await request("/record", { cookie })).json()).answers.goal,
    "續填測試",
  );
  const administrator = await login(
    "admin@example.test",
    "Admin-test-password-123!",
  );
  assert.equal(
    (await (await request("/session", { cookie: administrator })).json()).user
      .role,
    "admin",
  );
  assert.equal(
    (
      await db.query("SELECT action FROM hd_audit WHERE action=$1", [
        "self_register_consent_v1",
      ])
    ).rows.length,
    1,
  );
});
test("a wrong password is rejected and the administrator can create separate client accounts", async () => {
  assert.equal(
    (
      await request("/auth/sign-in/email", {
        method: "POST",
        body: { email: "admin@example.test", password: "incorrect-password" },
      })
    ).status,
    401,
  );
  adminCookie = await login("admin@example.test", "Admin-test-password-123!");
  for (const name of ["alice", "bob"]) {
    const response = await request("/admin/clients", {
      method: "POST",
      cookie: adminCookie,
      body: {
        name: name === "alice" ? "測試甲" : "測試乙",
        email: `${name}@example.test`,
        password: `${name}-test-password-123!`,
      },
    });
    assert.equal(response.status, 201, await response.clone().text());
  }
  aliceCookie = await login("alice@example.test", "alice-test-password-123!");
  bobCookie = await login("bob@example.test", "bob-test-password-123!");
});
test("a tab cannot save or submit after its cookie changes to another account", async () => {
  const aliceId = accountByCookie.get(aliceCookie);
  for (const accountId of [undefined, aliceId]) {
    const response = await request("/record", {
      method: "PUT",
      cookie: bobCookie,
      body: {
        accountId,
        version: 0,
        step: 0,
        answers: { clientName: "應屬測試甲的答案" },
      },
    });
    assert.equal(response.status, accountId ? 409 : 400);
  }
  assert.deepEqual(
    (await (await request("/record", { cookie: bobCookie })).json()).answers,
    {},
  );
  assert.equal(
    (
      await request("/submit", {
        method: "POST",
        cookie: bobCookie,
        body: { accountId: aliceId, version: 0 },
      })
    ).status,
    409,
  );
});
test("the draft and current step survive a fresh request, and another client sees no answers", async () => {
  const saved = await request("/record", {
    method: "PUT",
    cookie: aliceCookie,
    body: {
      version: 0,
      step: 2,
      answers: {
        clientName: "測試甲",
        bowelChanges: ["乾硬／粒狀"],
        bowelFrequency: "每三天一次",
      },
    },
  });
  assert.equal(saved.status, 200, await saved.clone().text());
  const restored = await (
    await request("/record", { cookie: aliceCookie })
  ).json();
  assert.equal(restored.version, 1);
  assert.equal(restored.step, 2);
  assert.equal(restored.answers.bowelFrequency, "每三天一次");
  const bob = await (await request("/record", { cookie: bobCookie })).json();
  assert.deepEqual(bob.answers, {});
  assert.equal(
    (await request("/admin/records", { cookie: aliceCookie })).status,
    403,
  );
});
test("client-supplied user IDs cannot change whose record is saved", async () => {
  const response = await request("/record", {
    method: "PUT",
    cookie: bobCookie,
    body: {
      version: 0,
      step: 0,
      userId: "someone-else",
      answers: { clientName: "測試乙" },
    },
  });
  assert.equal(response.status, 400);
});
test("stale tabs cannot overwrite a more recent draft", async () => {
  const response = await request("/record", {
    method: "PUT",
    cookie: aliceCookie,
    body: { version: 0, step: 0, answers: { clientName: "舊分頁" } },
  });
  assert.equal(response.status, 409);
  assert.equal(
    (await (await request("/record", { cookie: aliceCookie })).json()).answers
      .clientName,
    "測試甲",
  );
});
test("cross-site writes and malformed answer payloads are rejected", async () => {
  assert.equal(
    (
      await request("/record", {
        method: "PUT",
        cookie: aliceCookie,
        requestOrigin: "https://attacker.example",
        body: { version: 1, step: 0, answers: {} },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request("/record", {
        method: "PUT",
        cookie: aliceCookie,
        requestOrigin: null,
        body: { version: 1, step: 0, answers: {} },
      })
    ).status,
    403,
  );
  for (const answers of [
    { hiddenRole: "admin" },
    { bowelChanges: "not-an-array" },
    { bowelChanges: ["not-an-option"] },
    { clientName: "x".repeat(10001) },
  ]) {
    assert.equal(
      (
        await request("/record", {
          method: "PUT",
          cookie: aliceCookie,
          body: { version: 1, step: 0, answers },
        })
      ).status,
      400,
    );
  }
});
test("submission needs explicit consent and then locks the versioned record", async () => {
  assert.equal(
    (
      await request("/submit", {
        method: "POST",
        cookie: aliceCookie,
        body: { version: 1 },
      })
    ).status,
    422,
  );
  const save = await request("/record", {
    method: "PUT",
    cookie: aliceCookie,
    body: {
      version: 1,
      step: 7,
      answers: {
        clientName: "測試甲",
        consent: true,
        bowelChanges: ["乾硬／粒狀"],
        bowelFrequency: "每三天一次",
      },
    },
  });
  assert.equal(save.status, 200);
  assert.equal(
    (
      await request("/submit", {
        method: "POST",
        cookie: aliceCookie,
        body: { version: 2 },
      })
    ).status,
    200,
  );
  const record = await (
    await request("/record", { cookie: aliceCookie })
  ).json();
  assert.equal(record.status, "submitted");
  assert.equal(
    (
      await request("/record", {
        method: "PUT",
        cookie: aliceCookie,
        body: { version: record.version, step: 0, answers: {} },
      })
    ).status,
    423,
  );
});
test("only an administrator can see another record and reopen it for corrections", async () => {
  const records = await (
    await request("/admin/records", { cookie: adminCookie })
  ).json();
  const alice = records.records.find(
    (row) => row.email === "alice@example.test",
  );
  assert.ok(alice);
  assert.equal("answers" in alice, false);
  assert.equal(
    (await request(`/admin/records/${alice.id}`, { cookie: bobCookie })).status,
    403,
  );
  const detail = await (
    await request(`/admin/records/${alice.id}`, { cookie: adminCookie })
  ).json();
  assert.equal(detail.answers.clientName, "測試甲");
  assert.equal(
    (
      await request(`/admin/records/${alice.id}/reopen`, {
        method: "POST",
        cookie: adminCookie,
        body: { version: detail.version },
      })
    ).status,
    200,
  );
  assert.equal(
    (await (await request("/record", { cookie: aliceCookie })).json()).status,
    "draft",
  );
});
test("sign-out invalidates the session and record responses cannot be cached", async () => {
  const response = await request("/record", { cookie: aliceCookie });
  assert.match(response.headers.get("cache-control"), /no-store/);
  assert.equal(
    (
      await request("/auth/sign-out", {
        method: "POST",
        cookie: aliceCookie,
        body: {},
      })
    ).status,
    200,
  );
  assert.equal((await request("/record", { cookie: aliceCookie })).status, 401);
});

test("administrator password reset revokes client sessions and accepts only the new password", async () => {
  const { records } = await (
    await request("/admin/records", { cookie: adminCookie })
  ).json();
  const bob = records.find((row) => row.email === "bob@example.test");
  assert.equal(
    (
      await request("/admin/reset-password", {
        method: "POST",
        cookie: adminCookie,
        body: { userId: bob.userId, password: "bob-new-password-456!" },
      })
    ).status,
    200,
  );
  assert.equal((await request("/record", { cookie: bobCookie })).status, 401);
  assert.equal(
    (
      await request("/auth/sign-in/email", {
        method: "POST",
        body: { email: "bob@example.test", password: "bob-test-password-123!" },
      })
    ).status,
    401,
  );
  bobCookie = await login("bob@example.test", "bob-new-password-456!");
  assert.equal((await request("/record", { cookie: bobCookie })).status, 200);
});
test("questionnaire contents are encrypted and audit entries omit medical answers", async () => {
  const rows = (await db.query("SELECT answers_ciphertext FROM hd_record"))
    .rows;
  assert.ok(rows.length);
  for (const row of rows) {
    assert.doesNotMatch(row.answers_ciphertext, /測試甲|每三天一次|clientName/);
    assert.ok(Buffer.from(row.answers_ciphertext, "base64").length > 28);
  }
  const audit = (await db.query("SELECT * FROM hd_audit")).rows;
  assert.ok(audit.length);
  assert.doesNotMatch(JSON.stringify(audit), /每三天一次|bowelFrequency/);
});
test("deployment cleanup removes only its marked test account and revokes access", async () => {
  const email =
    "hd-deploy-check-01234567-abcd-abcd-abcd-0123456789ab@example.test";
  assert.equal(
    (
      await request("/admin/clients", {
        method: "POST",
        cookie: adminCookie,
        body: {
          name: "部署驗證專用",
          email,
          password: "Verification-test-password-123!",
        },
      })
    ).status,
    201,
  );
  const cookie = await login(email, "Verification-test-password-123!");
  assert.equal(
    (
      await request("/record", {
        method: "PUT",
        cookie,
        body: { version: 0, step: 2, answers: { clientName: "部署驗證專用" } },
      })
    ).status,
    200,
  );
  await assert.rejects(
    cleanupVerificationUsers(databasePool, [email, "alice@example.test"]),
  );
  assert.equal((await request("/record", { cookie })).status, 200);
  assert.equal(await cleanupVerificationUsers(databasePool, [email]), 1);
  assert.equal((await request("/record", { cookie })).status, 401);
  assert.equal(
    (await db.query('SELECT id FROM "user" WHERE email=$1', [email])).rows
      .length,
    0,
  );
  assert.equal(
    (
      await db.query('SELECT id FROM "user" WHERE email=$1', [
        "alice@example.test",
      ])
    ).rows.length,
    1,
  );
  assert.equal(await cleanupVerificationUsers(databasePool, [email]), 0);
});

test("public registration acknowledgements do not reveal existing account membership", async () => {
  const body = {
    name: "私隱註冊測試",
    email: "privacy-signup@example.test",
    password: "Privacy-signup-password-123!",
    consent: true,
  };
  const fresh = await request("/auth/sign-up/email", { method: "POST", body });
  const duplicate = await request("/auth/sign-up/email", {
    method: "POST",
    body,
  });
  assert.equal(fresh.status, 200);
  assert.equal(duplicate.status, 200);
  const first = await fresh.json(),
    again = await duplicate.json();
  assert.deepEqual(first, again);
  assert.deepEqual(first, { ok: true });
});
