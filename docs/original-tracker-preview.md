# Gemini original tracker preview

Review URL: https://health-decoder.com/daily-preview/

The existing `/daily/` page stays in place pending the user's visual and audio
review. This isolated entry reuses the existing authenticated tracker API, client
permission and encryption. Preview edits are stored separately per signed-in
account in `hd_daily_preview`; existing actual records seed the view read-only.
Preview interactions never overwrite the customer's actual daily records. Its personalized original HTML and JavaScript
are served only after the same server-side authorization check.

Source: supplied `ms_lai_tracker_v5.html`. Preserve original DOM element IDs,
custom CSS, audio oscillators, celebration fanfare, encouragement selection,
24-star particles, reward modal, gallery, charts and calendar wall. Integrity
tests pin the original feedback functions and custom stylesheet.

Integration changes:
- Reuse the existing account and server-side client grant.
- Save canonical encrypted daily records; show a reward after server confirmation.
- Keep existing sleep/activity/stress data when the original view saves a record.
- Preserve original enzyme quantity, food percentage, stool-count categories and
  reminder preferences in validated optional metadata.
- Keep unsaved changes in the open page and offer a JSON backup on save failure.
- Retain the original layout; replace runtime CDN scripts with pinned local assets.
- Support multiple photos as in the original, with a platform limit of eight
  compressed JPEG photos per meal for this preview.
- Mark email/background synchronization as awaiting connection; phone calendar
  reminders remain available. Preserve original reminder controls and layout.
- Enable normal browser zoom for accessibility.

Before replacing `/daily/`, the user should review the mobile preview, tap chime,
celebration sound, mute control and reward modal. Deploying this isolated preview
adds the preview route and backward-compatible metadata support; it does not
replace the current daily page.

## Approved formal release

On 2026-11-23 the user explicitly requested immediate formal release of this
restored original. The official entry is `/daily/`. Production records and
preview records remain separate. Future deployments must retain the original
feedback and audio features unless the user requests a change.
