// Local stand-in for the n8n webhook, for development only:
//   PGHOST=/var/tmp/pg PGPORT=5433 PGDATABASE=aquaterra_gov_dev node server/governance/dev-server.mjs
//   VITE_GOV_ENDPOINT=http://localhost:8787 npm run dev
import { createServer } from "node:http";
import { spawnSync } from "node:child_process";

createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method !== "POST") return res.end("{}");
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    let j = "{}";
    try { j = JSON.stringify(JSON.parse(body)); } catch { /* bad json */ }
    const r = spawnSync("psql", ["-U", process.env.PGUSER || "postgres", "-tA", "-v", `j=${j}`, "-f", "-"], { input: "SELECT aquaterra_gov(:'j'::jsonb);", encoding: "utf8" });
    res.setHeader("Content-Type", "application/json");
    res.end(r.stdout.trim() || JSON.stringify({ ok: false, error: "network", detail: r.stderr }));
  });
}).listen(8787, () => console.log("governance dev server on :8787"));
