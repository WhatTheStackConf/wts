// Run: node --test tests/server-function-transport.browser.test.mjs
// Production-bundled Chromium RPC regression. The browser's requests are routed
// to Solid's real server handler in memory; no app/PocketBase server is started.
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { chromium } from "@playwright/test";
import { build } from "vite";
import solid from "@solidjs/vite-plugin";
import { handleServerFunctionRequest, registerServerFunction } from "@solidjs/web/server-functions/server";
import { provideRequestEvent } from "@solidjs/web/storage";

await test("production browser RPC preserves blank optional fields after shared bootstrap", { timeout: 60_000 }, async () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const entry = fileURLToPath(new URL("./transport-browser-fixture.ts", import.meta.url));
  const bundle = await build({
    root,
    configFile: false,
    logLevel: "error",
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    plugins: [solid({ hot: false }), {
      name: "transport-regression-fixture",
      resolveId(id) { if (id === entry) return id; },
      load(id) {
        if (id !== entry) return;
        return `
          import { isServer } from "@solidjs/web";
          import { createServerReference } from "@solidjs/web/server-functions";
          import { initializeServerFunctionTransport } from "../src/lib/server-function-transport";
          window.transport = {
            initialize() { if (!isServer) initializeServerFunctionTransport(); },
            submit: createServerReference("browser-transport-regression")
          };
        `;
      },
    }],
    build: {
      write: false,
      minify: true,
      lib: { entry, formats: ["es"], fileName: "transport" },
      rollupOptions: { output: { codeSplitting: false } },
    },
  });
  const outputs = Array.isArray(bundle) ? bundle : [bundle];
  const script = outputs.flatMap((output) => output.output)
    .find((chunk) => chunk.type === "chunk" && chunk.isEntry)?.code;
  assert(script, "a production browser bundle must be emitted");

  const received = [];
  const requests = [];
  registerServerFunction("browser-transport-regression", (draft) => {
    received.push(draft);
    return { success: true };
  });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") pageErrors.push(message.text()); });
  page.on("requestfailed", (request) => pageErrors.push(`${request.method()} ${new URL(request.url()).pathname}: ${request.failure()?.errorText}`));
  await page.route("**/*", async (route) => {
    const incoming = route.request();
    if (incoming.url() === "http://wts.test/") {
      await route.fulfill({ contentType: "text/html", body: '<script type="module" src="/transport.js"></script>' });
    } else if (incoming.url() === "http://wts.test/transport.js") {
      await route.fulfill({ contentType: "text/javascript", body: script });
    } else if (incoming.url() === "http://wts.test/_server") {
      const request = new Request(incoming.url(), {
        method: incoming.method(),
        headers: await incoming.allHeaders(),
        body: incoming.postDataBuffer(),
      });
      requests.push(request.clone());
      const response = await handleServerFunctionRequest(request, { provideEvent: provideRequestEvent });
      await route.fulfill({
        status: response.status,
        headers: Object.fromEntries(response.headers),
        body: Buffer.from(await response.arrayBuffer()),
      });
    } else {
      await route.abort();
      assert.fail("unexpected request outside isolated transport fixture");
    }
  });

  try {
    await page.goto("http://wts.test/");
    await page.waitForFunction(() => Boolean(window.transport));
    const defaultFailure = await page.evaluate(async () => {
      try {
        await window.transport.submit({ id: undefined });
        return "unexpected success";
      } catch (error) { return error.message; }
    });
    assert.match(defaultFailure, /not JSON-serializable/);
    assert.equal(requests.length, 0, "unconfigured encoder fails before fetch");

    const results = await page.evaluate(async () => {
      window.transport.initialize();
      const achievement = await window.transport.submit({ id: undefined, unlockRule: { sourceDiversity: undefined } });
      const egg = await window.transport.submit({ eggKey: "browser-egg", badgeIcon: undefined, reason: undefined });
      const question = await window.transport.submit({ questions: [{ hint: undefined, choices: ["yes", undefined, null] }] });
      const ordinary = await window.transport.submit({ id: "existing", enabled: false, points: 0 });
      let classRejected = false;
      let toJSONCalled = false;
      class PrivateValue {
        secret = "synthetic-secret-do-not-send";
        toJSON() { toJSONCalled = true; return this.secret; }
      }
      try { await window.transport.submit({ value: new PrivateValue() }); }
      catch { classRejected = true; }
      return { achievement, egg, question, ordinary, classRejected, toJSONCalled };
    });
    assert.deepEqual(results, {
      achievement: { success: true }, egg: { success: true },
      question: { success: true }, ordinary: { success: true },
      classRejected: true, toJSONCalled: false,
    });
    assert.deepEqual(received, [
      { id: undefined, unlockRule: { sourceDiversity: undefined } },
      { eggKey: "browser-egg", badgeIcon: undefined, reason: undefined },
      { questions: [{ hint: undefined, choices: ["yes", undefined, null] }] },
      { id: "existing", enabled: false, points: 0 },
    ]);
    assert.equal(requests.length, 4, "unsupported class never leaves the browser");
    assert.equal(requests[3].headers.get("Content-Type"), "application/json");
    assert.deepEqual(pageErrors, []);
  } catch (error) {
    throw new Error(`${error.message}; requests=${requests.length}; received=${received.length}; browser=${pageErrors.join("; ")}`, { cause: error });
  } finally {
    await page.unrouteAll({ behavior: "wait" });
    await browser.close();
  }
});