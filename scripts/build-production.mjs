import { execFileSync } from "node:child_process";

execFileSync(process.execPath, ["scripts/build.mjs"], { stdio: "inherit" });
// Production builds run inside Vercel, where production Secrets are available.
// A migration or bootstrap failure must prevent releasing the new deployment.
if (process.env.VERCEL_ENV === "production") {
  execFileSync(process.execPath, ["scripts/setup-db.mjs"], {
    stdio: "inherit",
  });
}
