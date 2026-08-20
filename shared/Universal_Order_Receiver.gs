/**
 * Health-decoder.com 全站通用多主題訂單接收器 (Universal Order Web App)
 * 支援夜尿專題、官方商店、Health Map 諮詢及未來所有新專題共用！
 */

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.tryLock(10000); // 鎖定防並發衝突

  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var data = JSON.parse(e.postData.contents);
    
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
      data.orderId,
      data.timestamp,
      data.name,
      "'" + data.phone,
      data.address,
      data.hasElevator,
      data.causeTitle || data.topic,
      data.itemsDetail,
      data.subtotal,
      data.shipping,
      data.total,
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
