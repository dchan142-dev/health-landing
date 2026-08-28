# 🚀 GitHub Desktop 本地更新與 Vercel 自動發布指引

## 步驟 1：解壓縮檔案至本地專案目錄
1. 下載 Google Drive 上的 `health_decoder_nocturia_package_v5.zip`。
2. 解壓縮並將內容覆蓋至你的本地 GitHub 專案資料夾（例如 `health-decoder` 儲存庫目錄下）。

## 步驟 2：使用 GitHub Desktop 提交變更
1. 打開 **GitHub Desktop** 應用程式。
2. 左側面板會自動偵測到 `index.html` 及相關檔案的更新。
3. 在左下角 Summary 輸入：
   `feat(nocturia): update nocturia landing page to v5.0 with full vimeo embeds, quiz v2.1 and order webhook`
4. 點擊 **Commit to main**。
5. 點擊右上角 **Push origin** 推送至 GitHub。

## 步驟 3：Vercel 自動構建與驗證
1. 推送完成後，Vercel 將自動觸發 Webhook 並在 30 秒內完成構建。
2. 訪問 `https://health-decoder.com` 或專屬專題子路徑查看實機效果。
3. 測試問卷自測、Vimeo 視頻播放與 WhatsApp 結算閉環。
