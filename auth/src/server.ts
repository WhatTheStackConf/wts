import { serve } from "@hono/node-server";
import { createRuntime } from "./auth.js";
import { createApp } from "./app.js";
import { readConfig } from "./config.js";
import { schemaVersion } from "./migration.js";

export async function start() {
  const config = readConfig(process.env);
  const runtime = createRuntime(config);
  try {
    const installed = await runtime.pool.query<{ issuer: string; schemaVersion: number }>(`SELECT issuer, "schemaVersion" FROM wts_instance WHERE singleton = true`);
    if (installed.rows[0]?.issuer !== config.origin || installed.rows[0]?.schemaVersion !== schemaVersion) throw new Error("Migrate the configured issuer before starting the service.");
    await runtime.initializeSigningKeys();
    const app = createApp(runtime);
    const server = serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (address) => {
      process.stdout.write(JSON.stringify({ event: "listening", port: address.port }) + "\n");
    });
    let closePromise: Promise<void> | undefined;
    const close = () => {
      closePromise ??= (async () => {
        await new Promise<void>((resolve) => {
          const deadline = setTimeout(() => {
            if ("closeAllConnections" in server) server.closeAllConnections();
            resolve();
          }, 15000);
          deadline.unref();
          server.close(() => { clearTimeout(deadline); resolve(); });
        });
        await runtime.close();
      })();
      return closePromise;
    };
    const stop = () => {
      void close().catch(() => { process.stderr.write("The auth service did not close cleanly.\n"); process.exitCode = 1; });
    };
    process.once("SIGTERM", stop);
    process.once("SIGINT", stop);
    server.on("error", () => {
      process.stderr.write("The auth server failed.\n");
      process.exitCode = 1;
      stop();
    });
    return { server, runtime, close };
  } catch (error) {
    await runtime.close();
    throw error;
  }
}

try { await start(); }
catch { process.stderr.write("The auth service could not start. Check its configuration and installed database.\n"); process.exitCode = 1; }
