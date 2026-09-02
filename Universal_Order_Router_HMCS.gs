/**
 * Universal_Order_Router.gs (HMCS 擴充升級版 · 香港時區 GMT+8)
 * 綁定試算表：
 * 1. ORDER_SPREADSHEET_ID: 全站統一訂單總表 (1_-riNDKIxX_zl7vMEoE0Opxc39q-HCEetNZFbmtIzD0)
 * 2. QUIZ_SPREADSHEET_ID: 全站用戶自測數據庫 (12w1BGgf3AxHCIYE-nJUjW_IDIpJgc6Z38Vr0NGq1lzc)
 */

var ORDER_SPREADSHEET_ID = "1_-riNDKIxX_zl7vMEoE0Opxc39q-HCEetNZFbmtIzD0";
var QUIZ_SPREADSHEET_ID  = "12w1BGgf3AxHCIYE-nJUjW_IDIpJgc6Z38Vr0NGq1lzc";

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.tryLock(10000); // 防並發衝突鎖定 10 秒
  
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return ContentService.createTextOutput(JSON.stringify({ status: "error", message: "No data received" }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    
    var data = JSON.parse(e.postData.contents);
    var now = new Date();
    // 強制鎖定香港時區 GMT+8
    var timestamp = Utilities.formatDate(now, "Asia/Hong_Kong", "yyyy/MM/dd HH:mm:ss");

    // ==========================================
    // 路由分支 1：HMCS 深度健康需求分析 (HNA)
    // ==========================================
    if (data.type === "hmcs" || data.type === "hna") {
      var ssQuiz = SpreadsheetApp.openById(QUIZ_SPREADSHEET_ID);
      var sheetName = "HMCS健康需求分析";
      var sheet = ssQuiz.getSheetByName(sheetName);
      
      if (!sheet) {
        sheet = ssQuiz.insertSheet(sheetName);
        sheet.appendRow([
          "記錄時間", "稱呼", "聯絡電話", "基本狀況", "慢性情況", 
          "精力評分", "最大困擾", "過往阻礙", "具體改善期望", "渴望生活", 
          "親臨門市意願", "改善決心"
        ]);
        sheet.getRange(1, 1, 1, 12).setFontWeight("bold").setBackground("#1E293B").setFontColor("#F8FAFC");
      }
      
      var conditionsStr = Array.isArray(data.conditions) ? data.conditions.join(", ") : (data.conditions || "無");
      
      sheet.appendRow([
        timestamp,
        data.name || "",
        "'" + (data.phone || ""), // 加單引號防電話首零丟失
        data.basicInfo || "",
        conditionsStr,
        data.energyScore || "",
        data.impact || "",
        data.obstacle || "",
        data.specificGoal || "",
        data.goal || "",
        data.timeCommit || "",
        data.budgetCommit || ""
      ]);
      
      return ContentService.createTextOutput(JSON.stringify({ status: "success", type: "hmcs" }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // ==========================================
    // 路由分支 2：全站專題訂單 (Order)
    // ==========================================
    if (data.type === "order") {
      var ssOrder = SpreadsheetApp.openById(ORDER_SPREADSHEET_ID);
      var orderSheet = ssOrder.getActiveSheet();
      
      orderSheet.appendRow([
        data.orderId || "",
        timestamp,
        data.topicName || "夜尿專題",
        data.recipient || "",
        "'" + (data.phone || ""),
        data.address || "",
        data.hasLift ? "有升降機" : "無升降機",
        data.primaryCause || "",
        data.itemsSummary || "",
        data.subtotal || 0,
        data.shipping || 0,
        data.total || 0,
        "待確認出貨"
      ]);
      
      return ContentService.createTextOutput(JSON.stringify({ status: "success", type: "order" }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // ==========================================
    // 路由分支 3：專題初步自測問卷 (Quiz)
    // ==========================================
    if (data.type === "quiz") {
      var ssQuizDefault = SpreadsheetApp.openById(QUIZ_SPREADSHEET_ID);
      var quizSheetName = data.topicName || "夜尿自測記錄";
      var quizSheet = ssQuizDefault.getSheetByName(quizSheetName);
      
      if (!quizSheet) {
        quizSheet = ssQuizDefault.insertSheet(quizSheetName);
        quizSheet.appendRow(["記錄時間", "稱呼", "性別", "年齡區間", "判定主成因", "成因①(%)", "成因②(%)", "成因③(%)", "成因④(%)", "成因⑤(%)", "原始Payload"]);
      }
      
      var ratios = data.ratios || {};
      quizSheet.appendRow([
        timestamp,
        data.name || "",
        data.gender || "",
        data.age || "",
        data.primaryCause || "",
        ratios["1"] || 0,
        ratios["2"] || 0,
        ratios["3"] || 0,
        ratios["4"] || 0,
        ratios["5"] || 0,
        JSON.stringify(data)
      ]);
      
      return ContentService.createTextOutput(JSON.stringify({ status: "success", type: "quiz" }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    
    return ContentService.createTextOutput(JSON.stringify({ status: "ignored", message: "Unknown payload type" }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ status: "error", message: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}
