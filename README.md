# health-landing
Health Decoder production website.

正式 Reels 問卷入口為 `/reels-quiz/`，管理頁為 `/reels-quiz/admin/`。問卷提交、報告及管理功能需連接 PostgreSQL 及設定 Vercel 環境變數。

七個健康專頁為 `/awakening/`、`/cramps/`、`/diasthenia/`、`/foodcoma/`、`/nocturia/`、`/numbness/` 及 `/sarcopenia/`。`/hmcs/` 是這七頁共同引用的產品資料頁。

靜態網站由 `npm run build` 複製到 `dist/`，API 由 Vercel Node Functions 執行。
