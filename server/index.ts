import fs from "node:fs";
import path from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { loadConfig } from "./config.js";
import { createApp } from "./app.js";
import { createSaasApp } from "./saas/server.js";
import { installProcessHandlers } from "./log.js";

/**
 * Entrypoint for every role:
 *   AGENTOPIA_ROLE=all     (default) HTTP API + web client + worker in one process
 *   AGENTOPIA_ROLE=api     HTTP API + web client only (run workers separately)
 *   AGENTOPIA_ROLE=worker  task queue + scheduler only, no HTTP (npm run worker)
 *
 * AGENTOPIA_MODE=saas serves many users, each with a private town (role "all" only).
 */
const config = loadConfig();
installProcessHandlers();

/** Add the built web client to an app whose /api routes are already in place. */
function withWebClient<A extends Hono<any>>(app: A): A {
  // In production the server also serves the built web client (npm run build → dist/web).
  const webRoot = path.resolve("dist/web");
  if (config.isProduction && fs.existsSync(webRoot)) {
    app.use("/*", serveStatic({ root: path.relative(process.cwd(), webRoot) }));
    const indexHtml = fs.readFileSync(path.join(webRoot, "index.html"), "utf8");
    app.get("*", (c) => c.html(indexHtml));
  }
  return app;
}

let server: ReturnType<typeof serve> | null = null;
let stop: () => Promise<void>;

if (config.mode === "saas") {
  const saas = createSaasApp(config);
  const mode = saas.provider.simulated ? "SIMULATION (no API calls)" : config.anthropicApiKey ? "live Claude API" : "NO API KEY — tasks will fail until ANTHROPIC_API_KEY is set";
  // Mounted on the SaaS app so the HTML shell gets the same security headers (CSP etc.) as the API.
  const app = withWebClient(saas.app);
  server = serve({ fetch: app.fetch, hostname: config.host, port: config.port }, (info) => {
    console.log(`\n  🏡 Agentopia SaaS on http://${info.address}:${info.port}`);
    console.log(`     provider: ${mode}`);
    console.log(`     data:     ${config.dataDir} (accounts.sqlite + towns/)`);
    console.log(`     worker:   all towns, ${config.globalConcurrency} tasks at once\n`);
  });
  stop = () => saas.stop();
} else {
  const { api, runner, provider, db } = createApp(config);
  const mode = provider.simulated ? "SIMULATION (no API calls)" : config.anthropicApiKey ? "live Claude API" : "NO API KEY — tasks will fail until ANTHROPIC_API_KEY is set";
  if (config.role !== "worker") {
    const app = new Hono();
    app.route("/", api);
    server = serve({ fetch: withWebClient(app).fetch, hostname: config.host, port: config.port }, (info) => {
      console.log(`\n  🏡 Agentopia ${config.role === "api" ? "API" : "server"} on http://${info.address}:${info.port}`);
      console.log(`     provider: ${mode}`);
      console.log(`     database: ${config.dbPath}`);
      console.log(config.role === "api" ? "     worker:   none in this process (run `npm run worker`)" : `     worker:   ${runner.workerId} (concurrency ${config.workerConcurrency})`);
      if (!config.isProduction) console.log(`     web (dev): http://127.0.0.1:5173\n`);
    });
  } else {
    console.log(`\n  ⚙️  Agentopia worker ${runner.workerId} (concurrency ${config.workerConcurrency})`);
    console.log(`     provider: ${mode}`);
    console.log(`     database: ${config.dbPath}\n`);
  }
  stop = async () => {
    await runner.stop();
    db.close();
  };
}

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n${signal} received — stopping (running tasks are re-queued and resume on next start)…`);
  server?.close();
  await stop();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
