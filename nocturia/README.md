# Health Decoder 夜尿專題落地頁與自測系統 (Production Release v5.0)

本儲存庫為 **Health Decoder (health-decoder.com)** 夜尿專題落地頁之完整實機前端代碼與後端集成包。

---

## ▍核心規格與架構亮點

1. **3 大畫面 ✕ 12 大 BLOCK 全量閉環**：
   - **畫面 ①**：Block A (Hero 區 ✕ Bento Grid 5 大模組) ➔ Block B (MOD-NOCT-QUIZ 6 大純化維度自測問卷)。
   - **畫面 ②**：Block C (診斷判定 ✕ 5 大成因佔比進度條 ✕ 痛點直擊 ✕ 薄血藥避險) ➔ Block D (生化因果 ✕ Vimeo 影片) ➔ Block E (生活微習慣 ✕ Vimeo 影片 ✕ 治標局限警告)。
   - **畫面 ③**：Block F (分子靶向修復 ✕ Vimeo 影片) ➔ Block G (精準選品 ✕ 彈窗詳情) ➔ Block H (扁平單層選購 ✕ 30 天套裝高調折扣 ✕ 購物車即時清單 ✕ 純淨 4 大結算欄位) ➔ Block I (完整物流條款) ➔ Block J (真實見證 ✕ 1:1 Health Map 諮詢) ➔ Block K (回到頂部) ➔ Block L (VIP 私域社群)。

2. **15 條 Vimeo 影音資產全量動態嵌入**：
   - 成因 ① 至 ⑤ 之 Block D、Block E、Block F 各自獨立綁定官方 16:9 Vimeo 播放器，隨診斷結果 100% 封閉渲染。

3. **生化權重演算引擎 v2.1 (零基底乘數計分法)**：
   - 勾選「🚫 以上皆無」嚴格 0 分。
   - 年齡與性別採乘數係數加權，徹底杜絕無症狀虛假判定。

4. **後端 Google Sheets 異步寫入 ✕ WhatsApp 即時閉環**：
   - 訂單自動生成唯一編號（例：`NOCT-20260828-XXXXXX`），經 Webhook 寫入 Google Sheets 後台。
   - 一鍵喚起 WhatsApp (`+852 9878 8564`)，自動帶入完整訂單明細與收款指示（FPS / PayMe / AlipayHK）。

---

## ▍檔案清單

- `index.html`：專題全功能前端實機代碼（包含 HTML5 / CSS3 / JavaScript ES6 / Vimeo API / Webhook Integration）。
- `Universal_Order_Receiver.gs`：Google Apps Script 後端中樞腳本（支援試算表自動創建與並發寫入鎖定）。
- `VIMEO_ASSETS_MATRIX.md`：15 條 Vimeo 影音資產對照清單。
- `DEPLOYMENT_GUIDE.md`：GitHub Desktop 本地部署與 Vercel 一鍵發布指引。
