export async function serveApi(req, res, app, origin) {
  try {
    const source = new URL(req.url, origin),
      rewritten = source.searchParams.get("route");
    const path =
      rewritten !== null ? "/api/health-intake/" + rewritten : source.pathname;
    const url = new URL(path, origin);
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) {
      if (value !== undefined)
        headers.set(name, Array.isArray(value) ? value.join(", ") : value);
    }
    let body;
    if (!["GET", "HEAD"].includes(req.method)) {
      if (req.body !== undefined)
        body =
          typeof req.body === "string" ? req.body : JSON.stringify(req.body);
      else {
        const chunks = [];
        let bytes = 0;
        for await (const chunk of req) {
          bytes += chunk.length;
          if (bytes > 262144) {
            res.writeHead(413, {
              "content-type": "application/json",
              "cache-control": "no-store",
            });
            res.end(JSON.stringify({ error: "資料太大，請縮短內容" }));
            return;
          }
          chunks.push(chunk);
        }
        body = Buffer.concat(chunks);
      }
      if (Buffer.byteLength(body) > 262144) {
        res.writeHead(413, {
          "content-type": "application/json",
          "cache-control": "no-store",
        });
        res.end(JSON.stringify({ error: "資料太大，請縮短內容" }));
        return;
      }
    }
    const response = await app.fetch(
      new Request(url, { method: req.method, headers, body }),
    );
    for (const [name, value] of response.headers)
      if (name !== "set-cookie") res.setHeader(name, value);
    const cookies = response.headers.getSetCookie();
    if (cookies.length) res.setHeader("set-cookie", cookies);
    res.statusCode = response.status;
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    res.writeHead(503, {
      "content-type": "application/json",
      "cache-control": "no-store",
    });
    res.end(
      JSON.stringify({ error: "記錄服務尚未連接，請稍後重試或聯絡跟進者。" }),
    );
  }
}
