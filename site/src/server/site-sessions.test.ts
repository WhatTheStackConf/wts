import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { logout } from "./site-sessions.ts";
import { initializeEdition } from "./storage.ts";

void test("requires explicit proxy trust and preserves host and logout origin checks", async () => {
  const directory = mkdtempSync(join(tmpdir(), "wts-site-proxy-"));
  const values = {
    SITE_DATA_DIR: directory,
    SITE_ORIGIN: "https://site.acceptance.localhost",
    SITE_EDITION_ID: "2027",
    OIDC_ISSUER: "https://identity.acceptance.localhost",
    OIDC_CLIENT_ID: "synthetic-client",
    OIDC_CLIENT_SECRET: "synthetic-secret",
    SITE_SESSION_KEY: randomBytes(32).toString("base64url"),
    SITE_TRUST_PROXY: "false",
  };
  const previous = new Map(Object.keys(values).map((key) => [key, process.env[key]]));
  Object.assign(process.env, values);
  const request = (host = "site.acceptance.localhost", origin = values.SITE_ORIGIN) => new Request(`http://${host}/auth/logout`, {
    method: "POST",
    headers: { Origin: origin, "X-Forwarded-Proto": "https", "X-Forwarded-Host": "site.acceptance.localhost" },
  });
  try {
    initializeEdition("2027", "synthetic-proxy", directory);
    await assert.rejects(() => logout(request()), (error: unknown) => error instanceof Response && error.status === 403);
    process.env.SITE_TRUST_PROXY = "true";
    const accepted = await logout(request());
    assert.equal(accepted.status, 303);
    assert.equal(accepted.headers.get("Location"), "/");
    await assert.rejects(() => logout(request("wrong.acceptance.localhost")), (error: unknown) => error instanceof Response && error.status === 403);
    assert.equal((await logout(request("site.acceptance.localhost", "https://wrong.acceptance.localhost"))).status, 403);
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(directory, { recursive: true, force: true });
  }
});
