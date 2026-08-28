/**
 * Health-Decoder.com 全站訂單與問卷中樞 (Universal Order Receiver)
 * 負責處理夜尿專題自測數據收集與在線訂單異步寫入 Google Sheets
 */

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.tryLock(10000);
  
  try {
    var rawData = e.postData.contents;
    var data = JSON.parse(rawData);
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    
    if (data.topic === "夜尿自測記錄") {
      var quizSheet = ss.getSheetByName("夜尿自測記錄");
      if (!quizSheet) {
        quizSheet = ss.insertSheet("夜尿自測記錄");
        quizSheet.appendRow([
          "記錄時間", "稱呼", "性別", "年齡區間", "判定主成因", 
          "成因①(%)", "成因②(%)", "成因③(%)", "成因④(%)", "成因⑤(%)", "原始Payload"
        ]);
      }
      quizSheet.appendRow([
        data.timestamp,
        data.name,
        data.gender,
        data.age,
        data.primaryCause,
        data.ratios[1] || 0,
        data.ratios[2] || 0,
        data.ratios[3] || 0,
        data.ratios[4] || 0,
        data.ratios[5] || 0,
        rawData
      ]);
    } else {
      // 夜尿專題訂單
      var orderSheet = ss.getSheetByName("夜尿專題");
      if (!orderSheet) {
        orderSheet = ss.insertSheet("夜尿專題");
        orderSheet.appendRow([
          "訂單編號", "下單時間", "顧客姓名", "聯絡電話", "送貨地址", 
          "升降機直達", "專題/成因", "訂購明細", "商品總額 (HKD)", 
          "基本運費 (HKD)", "應付總額 (HKD)", "付款方式", "跟進狀態"
        ]);
      }
      orderSheet.appendRow([
        data.orderId,
        data.timestamp,
        data.name,
        data.phone,
        data.address,
        data.hasElevator,
        data.causeTitle,
        data.itemsDetail,
        data.subtotal,
        data.shipping,
        data.total,
        data.paymentMethod,
        "待聯絡 / 待收款"
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
