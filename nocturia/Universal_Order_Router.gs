/**
 * Health-Decoder.com 全站雙層解耦訂單與自測中樞 (Universal Order Router v6.1)
 * 負責將各專題商業訂單與自測數據精準分流寫入兩份獨立的 Google Sheets
 */

// ⚠️ 請填入您的兩份 Google Sheets 試算表 ID (從網址列 https://docs.google.com/spreadsheets/d/【這段ID】/edit 複製)
const ORDER_SPREADSHEET_ID = "請貼上_全站統一訂單總表_的ID";
const QUIZ_SPREADSHEET_ID  = "請貼上_全站用戶自測數據庫_的ID";

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.tryLock(10000);
  
  try {
    var rawData = e.postData.contents;
    var data = JSON.parse(rawData);
    var timestamp = new Date();
    
    // 分流一：自測問卷記錄 ➔ 寫入【自測數據庫】
    if (data.type === "quiz" || data.topic === "夜尿自測記錄") {
      var quizSS = SpreadsheetApp.openById(QUIZ_SPREADSHEET_ID);
      var topicName = data.topicName || "夜尿自測記錄";
      var quizSheet = quizSS.getSheetByName(topicName);
      
      if (!quizSheet) {
        quizSheet = quizSS.insertSheet(topicName);
        quizSheet.appendRow([
          "記錄時間", "稱呼", "性別", "年齡區間", "判定主成因", 
          "成因①(%)", "成因②(%)", "成因③(%)", "成因④(%)", "成因⑤(%)", "原始Payload"
        ]);
        quizSheet.getRange(1, 1, 1, 11).setFontWeight("bold").setBackground("#F1F5F9");
      }
      
      quizSheet.appendRow([
        timestamp,
        data.name || "未填寫",
        data.gender || "",
        data.age || "",
        data.primaryCause || "",
        data.ratios ? data.ratios[1] || 0 : 0,
        data.ratios ? data.ratios[2] || 0 : 0,
        data.ratios ? data.ratios[3] || 0 : 0,
        data.ratios ? data.ratios[4] || 0 : 0,
        data.ratios ? data.ratios[5] || 0 : 0,
        rawData
      ]);
    } 
    // 分流二：商業訂單 ➔ 寫入【全站統一訂單總表】
    else {
      var orderSS = SpreadsheetApp.openById(ORDER_SPREADSHEET_ID);
      var orderSheet = orderSS.getSheetByName("全站訂單總表");
      
      if (!orderSheet) {
        orderSheet = orderSS.insertSheet("全站訂單總表");
        orderSheet.appendRow([
          "訂單編號", "下單時間", "專題來源", "顧客姓名", "聯絡電話", 
          "送貨詳細地址", "升降機直達", "主診斷成因", "訂購明細", 
          "商品小計 (HKD)", "物流運費 (HKD)", "應付總額 (HKD)", "跟進狀態"
        ]);
        orderSheet.getRange(1, 1, 1, 13).setFontWeight("bold").setBackground("#F1F5F9");
      }
      
      var orderId = data.orderId || ("HD-" + Utilities.formatDate(timestamp, "Asia/Hong_Kong", "yyyyMMdd-HHmmss"));
      
      orderSheet.appendRow([
        orderId,
        timestamp,
        data.topicName || "夜尿專題",
        data.recipient ? data.recipient.name || "" : data.name || "",
        data.recipient ? data.recipient.phone || "" : data.phone || "",
        data.recipient ? data.recipient.address || "" : data.address || "",
        data.recipient ? data.recipient.hasLift || "" : (data.hasElevator ? "有升降機" : "無升降機"),
        data.causeName || "",
        Array.isArray(data.items) ? data.items.join("；\n") : (data.itemsDetail || ""),
        data.subtotal || 0,
        data.shipping || 0,
        data.total || 0,
        "待確認出貨"
      ]);
    }
    
    return ContentService.createTextOutput(JSON.stringify({ status: "success" }))
      .setMimeType(ContentService.MimeType.JSON);
      
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ status: "error", message: error.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}

/**
 * 🧪 測試工具：在 Apps Script 編輯器選取 testSendOrder() 並點擊「執行」，即可直接測試寫入！
 */
function testSendOrder() {
  var mockEvent = {
    postData: {
      contents: JSON.stringify({
        type: "order",
        orderId: "HD-TEST-0001",
        topicName: "夜尿專題",
        causeName: "成因 ①：下肢水腫平躺回流型",
        recipient: {
          name: "測試陳先生",
          phone: "98788564",
          address: "香港中環金融街 8 號",
          hasLift: "有升降機"
        },
        items: ["緩解夜尿30天套裝A1 x 1 (HKD 5,248)"],
        subtotal: 5248,
        shipping: 0,
        total: 5248
      })
    }
  };
  var res = doPost(mockEvent);
  Logger.log(res.getContent());
}
