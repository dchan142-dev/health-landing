import { clearAdminPreview } from "./clear-admin-preview.mjs";
import { productionReelsStore } from "../server/reels-store.mjs";
import { productionReelsV2Events } from "../server/reels-v2-events.mjs";
import { productionReelsV2Store } from "../server/reels-v2-store.mjs";
import { application, productionDatabasePool } from "../server/runtime.mjs";
import { cleanupVerificationUsers } from "./verification-cleanup.mjs";

try {
  const app = application();
  await app.initialize();
  await app.bindWingTung();
  console.log("WingTung tracker account binding confirmed.");
  await productionReelsStore().initialize();
  await productionReelsV2Store().initialize();
  await productionReelsV2Events().initialize();
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
  const previewCleanup = await clearAdminPreview(productionDatabasePool(), {
    email: "dchan142@gmail.com",
    operationId: "maintenance:clear-admin-preview:2026-11-23-v1",
  });
  console.log("Administrator preview cleanup: " + JSON.stringify(previewCleanup));
  process.exit(0);
} catch (error) {
  if (error.message === "Tracker requires exactly one existing WingTung account") console.error(error.message);
  console.error(
    "Setup failed. Check private environment settings and database access. If an administrator already exists, omit HD_ADMIN_* and rerun.",
  );
  process.exit(1);
}
