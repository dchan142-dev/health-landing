import { application } from "../server/runtime.mjs";
import { serveApi } from "../server/bridge.mjs";

export default async function handler(req, res) {
  try {
    return await serveApi(req, res, application(), process.env.APP_ORIGIN);
  } catch {
    res.writeHead(503, {
      "content-type": "application/json",
      "cache-control": "private, no-store",
    });
    res.end(JSON.stringify({ error: "記錄服務尚未連接，請聯絡跟進者。" }));
  }
}
