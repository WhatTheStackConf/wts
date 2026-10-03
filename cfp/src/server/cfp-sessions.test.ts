import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { assertMutationRequest, finishLogin, logout, readAccount, requireAccount, startLogin } from "./cfp-sessions.ts";
import { initializeEdition, migrate, openCfpDatabase } from "./storage.ts";
import { GET as loginHandler } from "../routes/auth/login.ts";
import { GET as callbackHandler } from "../routes/auth/callback.ts";
import { POST as logoutHandler } from "../routes/auth/logout.ts";

void test("CFP request, cookie, expiry, and local logout boundaries", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "wts-cfp-auth-"));
  const values = {
    NODE_ENV: "test", CFP_DATA_DIR: directory, CFP_ORIGIN: "https://cfp.acceptance.localhost",
    CFP_EDITION_ID: "2027", CFP_TRUST_PROXY: "false",
    OIDC_ISSUER: "https://identity.acceptance.localhost", OIDC_CLIENT_ID: "synthetic-client",
    OIDC_CLIENT_SECRET: "synthetic-secret", CFP_SESSION_KEY: randomBytes(32).toString("base64url"),
  };
  const previous = new Map(Object.keys(values).map((key) => [key, process.env[key]]));
  Object.assign(process.env, values);
  const hash = (token: string) => createHash("sha256").update(token).digest("base64url");
  const rejected = (status: number) => (error: unknown) => error instanceof Response && error.status === status;
  const proxyRequest = (host = "cfp.acceptance.localhost", origin = values.CFP_ORIGIN) => new Request(`http://${host}/auth/logout`, {
    method: "POST", headers: { Origin: origin, "X-Forwarded-Proto": "https", "X-Forwarded-Host": "cfp.acceptance.localhost" },
  });
  try {
    migrate(directory);
    initializeEdition("2027", directory);

    await t.test("proxy trust cannot replace the canonical host or exact Origin", async () => {
      await assert.rejects(() => logout(proxyRequest()), rejected(403));
      process.env.CFP_TRUST_PROXY = "true";
      const accepted = await logout(proxyRequest());
      assert.equal(accepted.status, 303);
      assert.equal(accepted.headers.get("Location"), "/");
      assert.equal(accepted.headers.get("Cache-Control"), "private, no-store");
      assert.deepEqual(accepted.headers.getSetCookie().map((value) => value.split("=")[0]), ["__Host-wts-cfp-session", "__Host-wts-cfp-flow"]);
      for (const cookie of accepted.headers.getSetCookie()) {
        assert.match(cookie, /; Path=\/; HttpOnly; SameSite=Lax; Max-Age=0;/);
        assert.match(cookie, /; Secure$/);
        assert.equal(cookie.includes("Domain="), false);
      }
      await assert.rejects(() => logout(proxyRequest("wrong.acceptance.localhost")), rejected(403));
      assert.equal((await logout(proxyRequest("cfp.acceptance.localhost", "https://site.acceptance.localhost"))).status, 403);
      process.env.CFP_TRUST_PROXY = "false";
    });

    await t.test("mutations reject GET and absent, null, sibling, or noncanonical origins", async () => {
      assert.throws(() => assertMutationRequest(new Request(`${values.CFP_ORIGIN}/profile`)), rejected(405));
      for (const origin of [undefined, "null", "https://site.acceptance.localhost", `${values.CFP_ORIGIN}/`, "https://CFP.acceptance.localhost"]) {
        const headers = new Headers();
        if (origin !== undefined) headers.set("Origin", origin);
        const request = new Request(`${values.CFP_ORIGIN}/profile`, { method: "POST", headers });
        assert.throws(() => assertMutationRequest(request), rejected(403));
      }
      const crossSite = new Request(`${values.CFP_ORIGIN}/profile`, { method: "POST", headers: { Origin: values.CFP_ORIGIN, "Sec-Fetch-Site": "cross-site" } });
      assert.throws(() => assertMutationRequest(crossSite), rejected(403));
      assert.throws(() => assertMutationRequest(proxyRequest()), rejected(403));
      process.env.CFP_TRUST_PROXY = "true";
      assertMutationRequest(proxyRequest());
      assert.throws(() => assertMutationRequest(proxyRequest("wrong.acceptance.localhost")), rejected(403));
      const accepted = await logout(proxyRequest());
      assert.equal(accepted.status, 303);
      process.env.CFP_TRUST_PROXY = "false";
    });

    await t.test("auth endpoints reject wrong methods and callbacks before provider access", async () => {
      const wrongLogin = await startLogin(new Request(`${values.CFP_ORIGIN}/auth/login`, { method: "POST" }));
      assert.equal(wrongLogin.status, 405);
      assert.equal(wrongLogin.headers.get("Allow"), "GET");
      const wrongCallback = await finishLogin(new Request(`${values.CFP_ORIGIN}/auth/callback/`));
      assert.equal(wrongCallback.status, 400);
      const missingBinding = await finishLogin(new Request(`${values.CFP_ORIGIN}/auth/callback?state=opaque`));
      assert.equal(missingBinding.status, 400);
      const getLogout = await logout(new Request(`${values.CFP_ORIGIN}/auth/logout`));
      assert.equal(getLogout.status, 405);
      assert.equal(getLogout.headers.get("Allow"), "POST");
      const noOrigin = await logout(new Request(`${values.CFP_ORIGIN}/auth/logout`, { method: "POST" }));
      assert.equal(noOrigin.status, 403);
      assert.equal(noOrigin.headers.get("Cache-Control"), "private, no-store");
    });

    await t.test("native handlers preserve denials and hide configuration failures", async () => {
      const denied = await logoutHandler({ request: proxyRequest() });
      assert.equal(denied.status, 403);
      assert.equal(denied.headers.get("Cache-Control"), "private, no-store");
      process.env.CFP_SESSION_KEY = "synthetic-invalid-secret";
      try {
        const unavailable = await loginHandler({ request: new Request(`${values.CFP_ORIGIN}/auth/login`) });
        assert.equal(unavailable.status, 503);
        assert.equal(unavailable.headers.get("Cache-Control"), "private, no-store");
        assert.equal(unavailable.headers.get("Referrer-Policy"), "no-referrer");
        const failure = await unavailable.text();
        assert.equal(failure.includes("CFP_SESSION_KEY"), false);
        assert.equal(failure.includes("synthetic-invalid-secret"), false);
        const callback = await callbackHandler({ request: new Request(`${values.CFP_ORIGIN}/auth/callback?code=synthetic-private-code`) });
        assert.equal(callback.status, 503);
        const callbackFailure = await callback.text();
        assert.equal(callbackFailure.includes("synthetic-private-code"), false);
        assert.equal(callbackFailure.includes("CFP_SESSION_KEY"), false);
      } finally {
        process.env.CFP_SESSION_KEY = values.CFP_SESSION_KEY;
      }
    });

    await t.test("canonical cookies isolate CFP and expired proofs do not refresh", async () => {
      const token = randomBytes(32).toString("base64url");
      const db = openCfpDatabase(directory);
      try {
        const now = Date.now();
        db.prepare("INSERT INTO cfp_accounts(wts_user_id,created_at) VALUES (?,?)").run("synthetic-account", now);
        db.prepare("INSERT INTO oidc_bindings(issuer,subject,wts_user_id,created_at) VALUES (?,?,?,?)").run(values.OIDC_ISSUER, "synthetic-subject", "synthetic-account", now);
        db.prepare("INSERT INTO cfp_sessions(session_hash,issuer,subject,encrypted_access_token,created_at,expires_at) VALUES (?,?,?,?,?,?)")
          .run(hash(token), values.OIDC_ISSUER, "synthetic-subject", "invalid-encrypted-proof", now - 300_000, now - 1);
        for (const cookie of [`wts-site-session=${token}`, `wts-cfp-session=${token}`, `__Host-wts-cfp-session=${token}; __Host-wts-cfp-session=${token}`]) {
          const request = new Request(`${values.CFP_ORIGIN}/applications`, { headers: { Cookie: cookie } });
          assert.equal(await readAccount(request), null);
          await assert.rejects(() => requireAccount(request), rejected(401));
        }
        assert.equal(db.prepare("SELECT count(*) AS count FROM cfp_sessions").get()?.count, 1);
        const expired = new Request(`${values.CFP_ORIGIN}/applications`, { headers: { Cookie: `__Host-wts-cfp-session=${token}` } });
        await assert.rejects(() => requireAccount(expired), rejected(401));
        assert.equal(db.prepare("SELECT count(*) AS count FROM cfp_sessions").get()?.count, 0);
      } finally { db.close(); }
    });

    await t.test("local logout removes only the owned session and flow", async () => {
      const token = randomBytes(32).toString("base64url");
      const foreign = randomBytes(32).toString("base64url");
      const browser = randomBytes(32).toString("base64url");
      const db = openCfpDatabase(directory);
      try {
        const now = Date.now();
        for (const session of [token, foreign]) db.prepare("INSERT INTO cfp_sessions(session_hash,issuer,subject,encrypted_access_token,created_at,expires_at) VALUES (?,?,?,?,?,?)")
          .run(hash(session), values.OIDC_ISSUER, "synthetic-subject", "invalid-encrypted-proof", now, now + 300_000);
        db.prepare("INSERT INTO oidc_flows(state_hash,browser_binding_hash,encrypted_flow,return_path,expires_at) VALUES (?,?,?,?,?)")
          .run(hash("synthetic-state"), hash(browser), "invalid-encrypted-flow", "/profile", now + 300_000);
        const ended = await logout(new Request(`${values.CFP_ORIGIN}/auth/logout`, {
          method: "POST", headers: { Origin: values.CFP_ORIGIN, Cookie: `__Host-wts-cfp-session=${token}; __Host-wts-cfp-flow=${browser}; wts-site-session=${foreign}` },
        }));
        assert.equal(ended.status, 303);
        assert.deepEqual(db.prepare("SELECT session_hash FROM cfp_sessions").all().map((row) => row.session_hash), [hash(foreign)]);
        assert.equal(db.prepare("SELECT count(*) AS count FROM oidc_flows").get()?.count, 0);
        const invalid = new Request(`${values.CFP_ORIGIN}/applications`, { headers: { Cookie: `__Host-wts-cfp-session=${foreign}` } });
        await assert.rejects(() => requireAccount(invalid), rejected(503));
        assert.equal(db.prepare("SELECT count(*) AS count FROM cfp_sessions").get()?.count, 1);
      } finally { db.close(); }
    });
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(directory, { recursive: true, force: true });
  }
});
