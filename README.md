# health-landing
health decoder 1st landing page

健康問卷新增於 `/intake/`。支援獨立密碼登入、跨裝置續填及管理員查看；需先連接 PostgreSQL 及設定 Vercel 環境變數。

部署與使用方法：[健康問卷部署文件](docs/health-intake-deployment.md)。現有靜態網站由 `npm run build` 複製到 `dist/`，API 由 Vercel Node Functions 執行。
