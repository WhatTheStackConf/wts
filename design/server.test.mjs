import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { createHandler } from "./server.mjs";

let base, server, secret;

before(async () => {
  const dir = await mkdtemp(join(tmpdir(), "wts-design-"));
  const root = join(dir, "static");
  await mkdir(join(root, "assets"), { recursive: true });
  await writeFile(join(root, "index.html"), "<!doctype html><title>Storybook</title>");
  await writeFile(join(root, "assets", "iframe-Dx7Kq2Lm.js"), "export {};");
  secret = join(dir, "secret.txt");
  await writeFile(secret, "outside the root");
  server = createServer(createHandler(root));
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

describe("design static server", () => {
  it("serves index.html for the root path with security headers", async () => {
    const response = await fetch(`${base}/`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /text\/html/);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow");
    assert.equal(response.headers.get("cache-control"), "no-cache");
  });

  it("caches hashed assets for a year", async () => {
    const response = await fetch(`${base}/assets/iframe-Dx7Kq2Lm.js`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "public, max-age=31536000, immutable");
  });

  it("never serves a file outside the root", async () => {
    for (const path of ["/../secret.txt", "/%2e%2e/secret.txt", "/assets/%2e%2e%2f%2e%2e%2fsecret.txt", "/%00"]) {
      const response = await fetch(base + path);
      assert.notEqual(response.status, 200, path);
      assert.doesNotMatch(await response.text(), /outside the root/, path);
    }
  });

  it("answers 404 for a missing file and 405 for POST", async () => {
    assert.equal((await fetch(`${base}/missing.html`)).status, 404);
    assert.equal((await fetch(`${base}/`, { method: "POST" })).status, 405);
    assert.equal((await fetch(`${base}/healthz`)).status, 200);
  });
});
