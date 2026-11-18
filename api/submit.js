import { serveApi } from "../server/bridge.mjs";
import { productionReelsStore } from "../server/reels-store.mjs";

const MAX_BODY_BYTES = 12 * 1024;

function json(body, status = 200, headers = {}) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store", "x-content-type-options": "nosniff", ...headers },
  });
}

export async function submitReels(request, { store, origin }) {
  if (request.method !== "POST") {
    return json({ error: "不支援此操作" }, 405, { allow: "POST" });
  }
  if (!origin || request.headers.get("origin") !== origin) {
    return json({ error: "請從原本嘅問卷頁面再試。" }, 403);
  }
  const type = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (type !== "application/json") return json({ error: "請使用 JSON 格式。" }, 415);

  let payload;
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw) > MAX_BODY_BYTES) return json({ error: "資料太大。" }, 413);
    payload = JSON.parse(raw);
  } catch {
    return json({ error: "資料格式不正確。" }, 400);
  }

  try {
    await store.save(payload);
    return json({ ok: true });
  } catch (error) {
    if (error.status === 400) return json({ error: "請檢查答案、聯絡資料及預約時段。" }, 400);
    if (error.status === 403) return json({ error: "請返回原本填寫問卷嘅分頁再試。" }, 403);
    if (error.status === 409) return json({ error: "請先完成問卷同開啟報告。" }, 409);
    return json({ error: "暫時儲存唔到，請稍後再試。" }, 503);
  }
}

export default async function handler(req, res) {
  const origin = process.env.APP_ORIGIN;
  const store = { save: payload => productionReelsStore().save(payload) };
  const app = { fetch: request => submitReels(request, { store, origin }) };
  return serveApi(req, res, app, origin);
}
