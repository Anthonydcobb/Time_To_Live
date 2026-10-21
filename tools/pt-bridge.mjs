import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

const host = "127.0.0.1";
const port = Number(process.env.PT_BRIDGE_PORT ?? 39094);
const pending = [];
const results = new Map();

function json(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type",
    "content-type": "application/json",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

async function readJson(req) {
  let body = "";
  for await (const chunk of req) body += chunk;
  return body ? JSON.parse(body) : {};
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${host}:${port}`);
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET,POST,OPTIONS",
        "access-control-allow-headers": "content-type",
      });
      res.end();
      return;
    }
    if (req.method === "GET" && url.pathname === "/health") {
      json(res, 200, { ok: true, service: "pt-bridge", pending: pending.length, results: results.size });
      return;
    }
    if (req.method === "POST" && url.pathname === "/v1/command") {
      const body = await readJson(req);
      if (typeof body.device !== "string" || typeof body.line !== "string") {
        json(res, 400, { ok: false, error: "device and line are required" });
        return;
      }
      const id = randomUUID();
      pending.push({ id, device: body.device, line: body.line, mode: body.mode ?? "" });
      json(res, 202, { ok: true, id });
      return;
    }
    if (req.method === "GET" && url.pathname === "/v1/commands/next") {
      const command = pending.shift();
      if (!command) {
        res.writeHead(204);
        res.end();
      } else {
        json(res, 200, { ok: true, command });
      }
      return;
    }
    if (req.method === "POST" && url.pathname === "/v1/result") {
      const body = await readJson(req);
      if (typeof body.id !== "string") {
        json(res, 400, { ok: false, error: "id is required" });
        return;
      }
      results.set(body.id, { ...body, receivedAt: new Date().toISOString() });
      json(res, 200, { ok: true });
      return;
    }
    if (req.method === "GET" && url.pathname.startsWith("/v1/result/")) {
      const id = decodeURIComponent(url.pathname.slice("/v1/result/".length));
      const result = results.get(id);
      if (!result) json(res, 404, { ok: false, error: "result not available" });
      else json(res, 200, { ok: true, result });
      return;
    }
    json(res, 404, { ok: false, error: "not found" });
  } catch (error) {
    json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(port, host, () => {
  console.log(`PT bridge listening at http://${host}:${port}`);
});

function close() {
  server.close(() => process.exit(0));
}
process.once("SIGINT", close);
process.once("SIGTERM", close);
