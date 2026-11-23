# Private Google Drive photo archive

State: implemented and tested locally; owner Google authorization/deployment is
required before production activation. Keep the live deployment unchanged until
the signed bridge check and real Drive readback succeed.

## Storage flow

The authenticated upload arrives in server memory. The server sends an HMAC-signed
request to the owner's Google Apps Script deployment. The script checks replay
nonce/time, owner-only Drive permissions, folder ancestry and SHA-256. It creates
private folders under the configured root: WingTung Lai / YYYY-MM-DD / meal.
Preview photos use a separate Preview / actor / date / meal branch.

The script reads every uploaded file back and verifies bytes and permissions.
Only after every image passes does the server update the encrypted daily record
with authenticated application image URLs. PostgreSQL stores file IDs, SHA-256,
size, context and verification time; it never stores new photo bytes.

Images are served through the existing session and client authorization check.
Drive files remain private; the application does not make public Drive links.
Image streams use private/no-store headers and verify the downloaded checksum.

## Existing data migration

`app.migratePhotosToDrive()` uploads embedded images from both daily tables,
verifies remote copies, then replaces the encrypted image content with references
using optimistic versions. Failed transfer/checksum/privacy checks preserve the
original row. A final scan verifies zero embedded images in the active tables.
Images already indexed are reverified before a remaining original is removed.
The migration retains all text, clinical fields, accounts and access grants.

PostgreSQL active-table cleanup does not erase historical provider backups or
WAL immediately. Review the provider's configured backup retention separately;
make no claim of immediate erasure of all historical backup copies. PostgreSQL
reclaims obsolete row/TOAST space through vacuum; raw-image growth stops once
new uploads and legacy migration use the verified Drive flow.

## Setup and release

1. Create an owner-private Drive root and verify its permissions.
2. Use the provided Apps Script code with that root and a generated shared secret.
   The filled secret-bearing source stays outside Git and public static output.
3. Run `setup` as the owner to grant Drive permission. Deploy as a web app,
   execute as the owner, with server access enabled. Signed requests are mandatory.
4. Store `HD_DRIVE_SHARED_SECRET` as a sensitive production Vercel environment
   variable. Store the observed `/exec` deployment URL as `HD_DRIVE_WEBAPP_URL`.
5. Run the signed `check` action and a test image upload/download/readback before
   releasing. Do not remove existing originals before a successful real check.
6. The production build runs the verified migration. Confirm the migration log
   reports `embeddedPhotosRemaining: 0`. Recheck after the deployment switch for
   legacy writes that were already in flight. Do not remove the Drive files on
   optimistic-version failure; a retry reuses the verified hash/name safely.

The app keeps the Gemini UI, audio, encouragement and password flow unchanged.
No additional customer Google login is required.
