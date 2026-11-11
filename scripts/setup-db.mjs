import { application, productionDatabasePool } from "../server/runtime.mjs";
import { cleanupVerificationUsers } from "./verification-cleanup.mjs";

try {
  const app = application();
  await app.initialize();
  const { HD_ADMIN_EMAIL, HD_ADMIN_NAME, HD_ADMIN_PASSWORD } = process.env;
  if (HD_ADMIN_EMAIL || HD_ADMIN_NAME || HD_ADMIN_PASSWORD) {
    if (
      !HD_ADMIN_EMAIL ||
      !HD_ADMIN_NAME ||
      !HD_ADMIN_PASSWORD ||
      HD_ADMIN_PASSWORD.length < 12
    )
      throw new Error(
        "Provide all administrator fields; password must contain at least 12 characters",
      );
    const result = await app.bootstrapAdmin({
      email: HD_ADMIN_EMAIL,
      name: HD_ADMIN_NAME,
      password: HD_ADMIN_PASSWORD,
    });
    console.log(
      result.created
        ? "Database initialized; first administrator created."
        : "Database initialized; existing administrator unchanged.",
    );
  } else console.log("Database schema initialized.");
  if (process.env.HD_VERIFICATION_CLEANUP_EMAILS) {
    const count = await cleanupVerificationUsers(
      productionDatabasePool(),
      JSON.parse(process.env.HD_VERIFICATION_CLEANUP_EMAILS),
    );
    console.log(
      "Deployment verification cleanup completed: " + count + " test accounts.",
    );
  }
  process.exit(0);
} catch {
  console.error(
    "Setup failed. Check private environment settings and database access. If an administrator already exists, omit HD_ADMIN_* and rerun.",
  );
  process.exit(1);
}
