# Health Decoder 夜尿專題落地頁 · HTML v6 實機交付包

## ▍檔案說明
- `index.html`：夜尿專題全域單一獨立免依賴（Standalone）HTML v6 實機代碼檔案。
  - 包含 Nav Bar、Block A 至 Block L 全域組件。
  - 包含 v2.1 問卷演算引擎、動態門閥解鎖機制（Progressive Gating）。
  - 包含 Block G 手機兩行流雙按鍵、雙彈窗解耦（Pop-up A / Pop-up B）、Block H 7 大 30 天套裝明細彈窗。
  - 包含 購物車即時運費計算引擎（滿 $400 免運、未滿 $400 收 $40）。
  - 包含 雙軌下單閉環（WhatsApp 預填訊息喚起 + Apps Script Webhook 異步記表）。
  - 包含 Block K 10 級逆向向上平滑導航狀態機。
  - 100% 內嵌 CSS 與 JavaScript，零外部外部框架依賴，極速秒開。

## ▍本地 GitHub / Vercel 部署步驟
1. 將 `index.html` 複製並覆蓋至你的本地 Git 儲存庫專案根目錄（或專題目錄）。
2. 如有自訂圖片，可將對應產品圖片放入 `./images/products/` 目錄（如 `0368.webp`, `36281.webp`, `Noct_Set_A1.webp` 等）。
3. 執行 Git 提交與推送：
   ```bash
   git add .
   git commit -m "feat: deploy Health Decoder Nocturia HTML v6 release"
   git push origin main
   ```
4. Vercel 將自動觸發 CI/CD 構建並完成上線更新。
