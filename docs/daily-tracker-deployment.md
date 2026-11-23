# Daily companion deployment

Production route: `/daily/`. Existing questionnaire route: `/intake/`.

This release reuses the existing Better Auth configuration, cookies, passwords,
PostgreSQL database and AES-256-GCM encryption key. No account recreation,
password reset or secret rotation is part of deployment.

## Access

`hd_app_access` stores the immutable existing user ID for `wingtung-daily`.
During the first production build, the binding selects exactly one existing
questionnaire belonging to an account created before 2026-11-23 UTC, matching
WingTung Lai / Lai Wing Tung / Ms Lai in the existing account or clientName answer.
Both saved drafts and submitted questionnaires qualify; the match must be unique.
A zero/ambiguous match stops deployment. Once bound, later registrations and
name changes cannot grant access. Existing administrators can view and edit the
same client record. Other logged-in accounts receive 403 at the API boundary.

The questionnaire account menu offers the daily service to authorized accounts.
Clients can also open `/daily/` directly with the same email and password.

## Persistence and limits

`hd_daily` has one encrypted record per client/date, with optimistic versions.
The API rejects stale writes and changed sessions. A daily record includes meals,
photos, weight, blood pressure, sleep, activity, stress, digestion and actual
supplement-use statuses. This page does not prescribe or escalate product doses.

The initial record period is 2026-11-23 through 2026-12-22. Each meal allows eight
compressed JPEGs, at most 32 per day. Individual data URLs are capped at
100,000 characters; the daily request limit is 4MiB. Questionnaire requests retain
the original 256KiB limit. Compressed images are encrypted in the database in
this release. Google Drive upload is a separate future integration.

No health records, passwords or photos are written to localStorage. Unsaved
changes remain in the open page. A visible status confirms server persistence.
Connection failures retain unsaved content and provide a private JSON download;
reconnection retries saving. Date changes and logout wait for pending saves.
Stale-version conflicts require preserving the current page backup before reload.
Cloud-record history can be exported as CSV; photos remain in the cloud record.

Calendar reminders are downloaded as ICS for the client's phone calendar.
The app does not send email, SMS, WhatsApp or background push reminders.
The client explicitly copies summaries for sharing.

## Verification and rollback

Run `npm test`, `npm run build` and mobile browser checks for sign-in, shared
session, photo upload, save/reload/relogin, history and date switching. Verify
production returns a login screen for anonymous clients and 401 for anonymous
tracker APIs. Confirm deployment logs show the existing account binding.
The schema change is additive; existing questionnaire and Reels data are retained.
A rollback can promote the preceding Vercel deployment. Keep the new tables and
existing encryption key so daily records can be restored in the next release.

## Gemini original release — 2026-11-23

The user approved the restored Gemini draft for formal release. `/daily/` now
provides the existing-account sign-in and opens the authenticated original page
at `/api/health-intake/tracker/daily`. The previous redesigned `daily/app.mjs` and
`daily/style.css` have been removed. The original sound, encouragement, star
particles and reward modal remain intact. Formal saves use `hd_daily`; the
independent preview continues to use `hd_daily_preview`.

WingTung opening the old questionnaire login is directed to `/daily/` after
authentication. The original questionnaire remains accessible through
`/intake/?view=questionnaire`. Existing passwords and account IDs are unchanged.
Previously stored sleep/activity/stress fields are retained when saving through
the original interface. Administrator preview test records were cleared once
through an audited, scoped maintenance operation.
