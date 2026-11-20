# Reels 動態問卷 V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增一個不影響 V1、可獨立測試及管理的 Reels 問卷 V2，改善影片等待、自評報告、資料表單及預約轉化。

**Architecture:** V2 以新的頂層公開目錄、獨立資料模組、API、加密資料表及 Admin 管道運作；只在現有建置、資料庫初始化、本機伺服器與 Vercel 設定加入增量路由。V2 前端繼續直接讀取既有 16 條影片，問卷資料與匿名分析事件完全分離。

**Tech Stack:** 原生 HTML／CSS／ES modules、Node.js 22、Vercel Functions、PostgreSQL／PGlite、node:test、jsdom、PDFKit。

**Spec:** `docs/superpowers/specs/2026-11-19-reels-quiz-v2-design.md`

## Global Constraints

- 不修改 `reels-quiz/` 的 V1 產品檔案、既有 API 回應、資料表 AAD 或正式連結。
- 新頁面路徑固定為 `/reels-quiz-v2/`，影片仍為 `/demo/reels-quiz/media/<clip>.mp4`。
- 電郵及其餘六項資料保持必填；推廣同意保持獨立選填。
- V2 介面不標示第一次見面免費或收費，不作診斷聲稱。
- 不加入新 npm 依賴。

## Review Focus

- Instagram／Facebook 內置瀏覽器阻止自動播放或返回分頁時，直接作答及重開 WhatsApp 仍可用。
- `day`／`axis` 遺漏、衝突或無效時，V2 仍按 V1 規則安全回退且不在畫面暴露版本／軸線。
- 零 Q2–Q5 訊號時，不產生虛構 winner、百分比或不可下載報告。
- 已開報告後日期過期、重複送出或網絡重試時，最新有效預約才獲保存。
- V1 與 V2 的 token、草稿、資料表、Admin／CSV／PDF 不可互相讀寫。

---

### Task 1: V2 問卷資料與計分合約

**Files:** Create `reels-quiz-v2/quiz-data.mjs`; test `tests/reels-quiz-v2.test.mjs`.

**Interfaces:** Produces `evaluateAxes(axis, answers)` returning `{ winnerId, winner, ratios, sortedIds, evidenceCount }`; zero signals return null winner and four zero ratios.

- [ ] Write failing tests for all 30 entries, source-neutral scoring, zero signals, BMI, red flags and Hong Kong booking dates.
- [ ] Run `node --test tests/reels-quiz-v2.test.mjs` and confirm failure.
- [ ] Create the V2 data module from the locked questionnaire, changing only the scoring contract and evidence helper.
- [ ] Re-run the test and commit `feat: add isolated reels quiz v2 scoring`.

### Task 2: V2 手機問卷介面

**Files:** Create `reels-quiz-v2/index.html`, `quiz.css`, `quiz.mjs`, `admin/index.html`; test `tests/reels-quiz-v2-ui.test.mjs`.

**Interfaces:** Consumes Task 1 exports; produces `/reels-quiz-v2/`, `POST /api/submit-v2` and non-blocking `POST /api/event-v2` payloads.

- [ ] Write failing jsdom tests for direct answer/text-first mode, safety-first red flags, inline field errors, zero-signal report, empty booking and explicit WhatsApp completion.
- [ ] Build isolated V2 static files from V1 visual/copy baseline using `hd_reels_v4` session keys and V2 API paths.
- [ ] Implement grouped field validation, unselected booking, WhatsApp reopen/confirmation and anonymous events.
- [ ] Run Tasks 1–2 tests and commit `feat: build reels quiz v2 mobile flow`.

### Task 3: V2 提交與匿名事件儲存

**Files:** Create `server/reels-v2-store.mjs`, `server/reels-v2-events.mjs`, `api/submit-v2.js`, `api/event-v2.js`; modify `server/local.mjs`, `scripts/setup-db.mjs`; test `tests/reels-v2-store.test.mjs`.

**Interfaces:** Produces `createReelsV2Store()`, `productionReelsV2Store()`, `createReelsV2Events()`, `submitReelsV2()` and `recordReelsV2Event()`.

- [ ] Write failing PGlite tests for separate tables/AAD, score snapshot, token isolation, booking retries, event allowlist/dedup/extra-field rejection and same-origin.
- [ ] Implement the two tables, two APIs and additive local/production initialization.
- [ ] Run V2 and existing store tests; commit `feat: isolate reels v2 storage and funnel events`.

### Task 4: V2 專屬後台、CSV 與 PDF

**Files:** Create `server/reels-v2-admin.mjs`, `server/reels-v2-report-pdf.mjs`, `api/export-v2.js`, `api/report-v2-pdf.js`, `reels-quiz-v2/admin/app.mjs`, `style.css`; test `tests/reels-v2-admin.test.mjs`.

**Interfaces:** Consumes Task 3 store and existing admin session; produces V2-only JSON/CSV/PDF and `/reels-quiz-v2/admin/`.

- [ ] Write failing tests for auth, V2-only list, CSV safety, zero-signal PDF, download URL and Admin DOM.
- [ ] Build the V2-only admin pipeline and render PDFs from stored V2 score snapshots.
- [ ] Run V2 and existing admin tests; commit `feat: add dedicated reels v2 admin reports`.

### Task 5: 建置、部署設定與完整回歸

**Files:** Modify `scripts/build.mjs`, `vercel.json`, `.github/workflows/health-intake.yml`, `tests/hosting.test.mjs`, `README.md`.

**Interfaces:** Produces `dist/reels-quiz-v2/`, V2 function settings, CSP/privacy headers and CI coverage.

- [ ] Write failing build assertions for preserved V1, copied V2, private-file exclusion and V2 asset paths.
- [ ] Add only the required V2 build assertion, Vercel function/header, CI paths and README test-entry note.
- [ ] Run `npm test` and `npm run build`.
- [ ] Complete 390×844 browser flows for all four axes, safety, invalid email, zero signals, booking and WhatsApp return.
- [ ] Confirm the diff contains no `reels-quiz/` V1 product-file changes; commit `test: verify isolated reels quiz v2 release`.
