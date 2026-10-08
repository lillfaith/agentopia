import fs from "node:fs";
import path from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { loadConfig } from "./config.js";
import { createApp } from "./app.js";

const config = loadConfig();
const { api, runner, provider, db } = createApp(config);

const app = new Hono();
app.route("/", api);

// In production the server also serves the built web client (npm run build → dist/web).
const webRoot = path.resolve("dist/web");
if (config.isProduction && fs.existsSync(webRoot)) {
  app.use("/*", serveStatic({ root: path.relative(process.cwd(), webRoot) }));
  const indexHtml = fs.readFileSync(path.join(webRoot, "index.html"), "utf8");
  app.get("*", (c) => c.html(indexHtml));
}

const server = serve({ fetch: app.fetch, hostname: config.host, port: config.port }, (info) => {
  const mode = provider.simulated ? "SIMULATION (no API calls)" : config.anthropicApiKey ? "live Claude API" : "NO API KEY — tasks will fail until ANTHROPIC_API_KEY is set";
  console.log(`\n  🏡 Agentopia server on http://${info.address}:${info.port}`);
  console.log(`     provider: ${mode}`);
  console.log(`     database: ${config.dbPath}`);
  console.log(`     worker:   ${runner.workerId} (concurrency ${config.workerConcurrency})`);
  if (!config.isProduction) console.log(`     web (dev): http://127.0.0.1:5173\n`);
});

async function shutdown(signal: string) {
  console.log(`\n${signal} received — stopping worker (running tasks will be recovered on next start)…`);
  await runner.stop();
  server.close();
  db.close();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
