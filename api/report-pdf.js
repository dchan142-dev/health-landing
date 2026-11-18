import { serveProductionReelsAdmin } from "../server/reels-admin.mjs";

export default function handler(req, res) {
  return serveProductionReelsAdmin(req, res, "reportPdf");
}
