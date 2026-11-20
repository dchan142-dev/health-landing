import { serveProductionReelsV2Admin } from "../server/reels-v2-admin.mjs";

export default function handler(req, res) {
  return serveProductionReelsV2Admin(req, res, "exportCsv");
}
