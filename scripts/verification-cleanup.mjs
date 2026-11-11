// Deployment verification uses a reserved email namespace and a fixed label.
// This build-only helper never accepts ordinary client accounts for deletion.
export async function cleanupVerificationUsers(pool, emails) {
  if (
    !Array.isArray(emails) ||
    emails.length > 5 ||
    emails.some(
      (email) =>
        typeof email !== "string" ||
        !/^hd-deploy-check-[a-f0-9-]+@example\.test$/.test(email),
    )
  )
    throw new Error("Invalid verification account list");
  if (!emails.length) return 0;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const users = (
      await client.query(
        "SELECT id FROM \"user\" WHERE email=ANY($1::text[]) AND name=$2 AND COALESCE(role,'user')='user'",
        [emails, "部署驗證專用"],
      )
    ).rows.map((row) => row.id);
    if (!users.length) {
      await client.query("COMMIT");
      return 0;
    }
    const records = (
      await client.query(
        "SELECT id FROM hd_record WHERE user_id=ANY($1::text[])",
        [users],
      )
    ).rows.map((row) => row.id);
    await client.query(
      "DELETE FROM hd_audit WHERE actor_id=ANY($1::text[]) OR record_id=ANY($2::text[])",
      [users, [...users, ...records]],
    );
    await client.query(
      "DELETE FROM \"user\" WHERE id=ANY($1::text[]) AND COALESCE(role,'user')='user'",
      [users],
    );
    await client.query("COMMIT");
    return users.length;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
