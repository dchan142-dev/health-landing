/**
 * Health-decoder.com 全站通用多主題訂單接收器 (Universal Order Web App)
 * 支援：夜尿專題 (5大方案)、官方共用商店 (12款產品)、Health Map 1:1 諮詢
 * 
 * 部署指引：
 * 1. 部署 -> 新增部署 -> 選擇「網頁應用程式 (Web App)」
 * 2. 執行身分：選擇「我 (dchan142@gmail.com)」
 * 3. 誰可以存取：選擇「所有人 (Anyone)」【⚠️ 最重要，否則前端跨域會被拒絕】
 * 4. 點擊「部署」並完成授權，複製「網頁應用程式網址」貼入 site-config.js
 */

// 測試用：在 Apps Script 編輯器中選擇 testWriteOrder 並點擊「執行」，可立即測試寫入並完成授權
function testWriteOrder() {
  var testEvent = {
    postData: {
      contents: JSON.stringify({
        topic: "夜尿專題",
        orderId: "TEST-" + Utilities.formatDate(new Date(), "Asia/Hong_Kong", "yyyyMMdd-HHmmss"),
        timestamp: Utilities.formatDate(new Date(), "Asia/Hong_Kong", "yyyy-MM-dd HH:mm:ss"),
        name: "測試顧客",
        phone: "98788564",
        address: "香港測試地址123號",
        hasElevator: "有升降機直達",
        causeTitle: "成因①專屬方案：下肢循環與微血管修復",
        itemsDetail: "【30天特惠套裝】緩解夜尿30天套裝A1 x 1",
        subtotal: 5248,
        shipping: 0,
        total: 5248
      })
    }
  };
  var result = doPost(testEvent);
  Logger.log(result.getContent());
}

// GET 探針：在瀏覽器直接打開 Web App 網址時，顯示連線正常狀態
function doGet(e) {
  return ContentService.createTextOutput("✅ Health Decoder Universal Order Webhook is ACTIVE & ONLINE!")
    .setMimeType(ContentService.MimeType.TEXT);
}

// POST 接收端：接收前端訂單 JSON 並自動分流寫入分頁
function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.tryLock(10000); // 鎖定防並發衝突

  try {
    // 優先綁定當前試算表，若為獨立腳本則透過 Google Sheet ID 綁定
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) {
      ss = SpreadsheetApp.openById("1OH6yYS5Udi-DpxXHeulw-OgQfobe9Zj9OoY_OKrSEV8");
    }

    var data;
    if (e && e.postData && e.postData.contents) {
      data = JSON.parse(e.postData.contents);
    } else if (e && e.parameter && e.parameter.data) {
      data = JSON.parse(e.parameter.data);
    } else {
      data = e ? e.parameter : {};
    }
    
    // 依據專題名稱 (如 "夜尿專題"、"官方商店"、"Health Map 諮詢") 自動切換或新建分頁
    var sheetName = data.topic || "一般訂單";
    var sheet = ss.getSheetByName(sheetName);
    
    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
      sheet.appendRow([
        "訂單編號",
        "下單時間",
        "顧客姓名",
        "聯絡電話",
        "送貨地址",
        "升降機直達",
        "專題/成因",
        "訂購明細",
        "商品總額 (HKD)",
        "基本運費 (HKD)",
        "應付總額 (HKD)",
        "跟進狀態"
      ]);
      sheet.getRange("A1:L1").setBackground("#0e4b75").setFontColor("#ffffff").setFontWeight("bold");
    }

    sheet.appendRow([
      data.orderId || "",
      data.timestamp || Utilities.formatDate(new Date(), "Asia/Hong_Kong", "yyyy-MM-dd HH:mm:ss"),
      data.name || "",
      "'" + (data.phone || ""),
      data.address || "",
      data.hasElevator || "",
      data.causeTitle || data.topic || "",
      data.itemsDetail || "",
      data.subtotal || 0,
      data.shipping || 0,
      data.total || 0,
      "待聯絡 / 待收款"
    ]);

    return ContentService.createTextOutput(JSON.stringify({ "result": "success", "orderId": data.orderId }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ "result": "error", "error": error.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}
