import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { fileURLToPath } from "node:url";
import { verifyOAuthQueryParams } from "@better-auth/oauth-provider";
import type { Runtime } from "./auth.js";
import { oauthScopes } from "./auth.js";
import { renderPage } from "./pages.js";
import type { PageState } from "./pages.js";
import { profileWrite, readProfile, writeProfile } from "./profile.js";
import { schemaVersion } from "./migration.js";

const authRoutes: Record<string, true> = {
  "/sign-in/email": true, "/sign-in/social": true, "/sign-up/email": true,
  "/sign-out": true, "/get-session": true, "/send-verification-email": true,
  "/verify-email": true, "/request-password-reset": true, "/reset-password": true,
  "/jwks": true, "/error": true,
  "/oauth2/authorize": true, "/oauth2/token": true, "/oauth2/consent": true,
  "/oauth2/continue": true, "/oauth2/userinfo": true, "/oauth2/introspect": true, "/oauth2/revoke": true,
};
const serverProtocolRoutes: Record<string, true> = {
  "/oauth2/token": true, "/oauth2/userinfo": true, "/oauth2/introspect": true, "/oauth2/revoke": true,
};

export function createApp(runtime: Runtime) {
  const { config, pool, auth } = runtime;
  const app = new Hono();
  const enabledProviders: ("google" | "github")[] = [];
  if (config.providers.google) enabledProviders.push("google");
  if (config.providers.github) enabledProviders.push("github");
  app.use("*", async (c, next) => {
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "no-referrer");
    c.header("X-Frame-Options", "DENY");
    c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    c.header("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' https:; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
    c.header("Cache-Control", "no-store");
    if (config.production) c.header("Strict-Transport-Security", "max-age=31536000");
    if (!['/healthz', '/readyz'].includes(c.req.path) && new URL(c.req.url).host !== new URL(config.origin).host) {
      return c.json({ error: { code: "invalid_host", message: "Use the configured account origin." } }, 400);
    }
    await next();
  });
  app.onError((_error, c) => c.json({ error: { code: "server_error", message: "The account service could not complete this request." } }, 500));
  app.get("/healthz", (c) => c.json({ status: "ok" }));
  app.get("/readyz", async (c) => {
    try {
      const result = await pool.query<{ issuer: string; schemaVersion: number; keys: boolean; migrations: number; identityTrigger: boolean }>(
        `SELECT issuer, "schemaVersion", EXISTS(SELECT 1 FROM jwks WHERE "privateKey" IS NOT NULL AND ("expiresAt" IS NULL OR "expiresAt" > now())) AS keys,
          (SELECT count(*)::integer FROM wts_schema_migrations WHERE name IN ('001_better_auth_1_7_7.sql','002_wts_identity.sql')) AS migrations,
          EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.user'::regclass AND tgname = 'user_bind_identity' AND tgenabled = 'O') AS "identityTrigger"
         FROM wts_instance WHERE singleton = true`);
      const installed = result.rows[0];
      if (!installed || installed.issuer !== config.origin || installed.schemaVersion !== schemaVersion || !installed.keys || installed.migrations !== 2 || !installed.identityTrigger) {
        return c.json({ status: "not_ready" }, 503);
      }
      return c.json({ status: "ready" });
    } catch { return c.json({ status: "not_ready" }, 503); }
  });
  app.get("/.well-known/openid-configuration", (c) => runtime.openIdConfiguration(c.req.raw));
  app.get("/.well-known/oauth-authorization-server", (c) => runtime.authorizationServerMetadata(c.req.raw));
  app.use("/assets/*", serveStatic({ root: fileURLToPath(new URL("../public/", import.meta.url)), rewriteRequestPath: (path) => path.replace(/^\/assets/, "") }));
  app.all("/api/auth/*", async (c) => {
    const path = c.req.path.slice("/api/auth".length);
    const callback = /^\/callback\/(google|github)$/.exec(path);
    const resetRedirect = /^\/reset-password\/[^/]+$/.test(path) && c.req.method === "GET";
    if (!authRoutes[path] && !resetRedirect && !(callback && enabledProviders.some((provider) => provider === callback[1]))) return c.notFound();
    if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method) && !serverProtocolRoutes[path] && c.req.header("Origin") !== config.origin) {
      return c.json({ error: { code: "forbidden", message: "Use the account page to change this account." } }, 403);
    }
    if (["/request-password-reset", "/send-verification-email"].includes(path) && c.req.method === "POST") {
      let body: unknown;
      try { body = await c.req.raw.clone().json(); } catch { return c.json({ error: { code: "invalid_request", message: "Send a JSON request." } }, 400); }
      if (typeof body !== "object" || body === null) return c.json({ error: { code: "invalid_request", message: "Send an account request." } }, 400);
      const key = path === "/request-password-reset" ? "redirectTo" : "callbackURL";
      const destination = path === "/request-password-reset" ? "/reset-password" : "/verify-email?verified=1";
      if (key in body) {
        const value = Reflect.get(body, key);
        if (typeof value !== "string" || !URL.canParse(value, config.origin) || new URL(value, config.origin).href !== new URL(destination, config.origin).href) return c.json({ error: { code: "invalid_request", message: "Use the fixed account destination." } }, 400);
      }
    }
    return auth.handler(c.req.raw);
  });
  app.get("/v1/me", async (c) => {
    if (c.req.header("Authorization")) return c.json({ error: { code: "unauthorized", message: "Use your central account session." } }, 401);
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: { code: "unauthorized", message: "Sign in to your account." } }, 401);
    if (!session.user.emailVerified) return c.json({ error: { code: "forbidden", message: "Verify your email before you use this account." } }, 403);
    return c.json({ profile: await readProfile(pool, session.user.id, config.origin) });
  });
  app.patch("/v1/me", async (c) => {
    if (c.req.header("Origin") !== config.origin) return c.json({ error: { code: "forbidden", message: "Use the account page to change your profile." } }, 403);
    if (c.req.header("Authorization")) return c.json({ error: { code: "unauthorized", message: "Use your central account session." } }, 401);
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: { code: "unauthorized", message: "Sign in to your account." } }, 401);
    if (!session.user.emailVerified) return c.json({ error: { code: "forbidden", message: "Verify your email before you use this account." } }, 403);
    let body: unknown;
    try { body = await c.req.json(); } catch { return c.json({ error: { code: "invalid_profile", message: "Send a valid profile request." } }, 400); }
    const parsed = profileWrite.safeParse(body);
    if (!parsed.success) return c.json({ error: { code: "invalid_profile", message: "Send only the profile fields and a valid revision." } }, 400);
    const profile = await writeProfile(pool, session.user.id, config.origin, parsed.data);
    if (!profile) return c.json({ error: { code: "revision_conflict", message: "Your profile changed. Reload it before you save." } }, 409);
    return c.json({ profile });
  });
  app.get("/", (c) => c.redirect("/account"));
  app.get("/:page", async (c) => {
    const page = c.req.param("page");
    if (!["sign-in", "sign-up", "recovery", "reset-password", "verify-email", "consent", "account", "error"].includes(page)) return c.notFound();
    const query = new URL(c.req.url).searchParams;
    const oauthQuery = query.get("oauth_query") ?? (query.has("sig") ? new URL(c.req.url).search.slice(1) : null);
    const common = { registrationOpen: config.registrationOpen, enabledProviders, oauthQuery, notice: null };
    const fail = (message: string) => c.html(renderPage({ ...common, oauthQuery: null, kind: "error", title: "Account request failed", message }), 400);
    if (oauthQuery && !await verifyOAuthQueryParams(oauthQuery, config.secret)) return fail("This authorization request expired or is invalid. Start again from the application.");
    let state: PageState;
    switch (page) {
      case "sign-in": state = { ...common, kind: "sign-in" }; break;
      case "sign-up":
        if (!config.registrationOpen) return fail("Registration is closed. Sign in with your existing account.");
        state = { ...common, kind: "sign-up" }; break;
      case "recovery": state = { ...common, kind: "recovery" }; break;
      case "reset-password": state = { ...common, kind: "reset-password", token: query.get("token") }; break;
      case "verify-email": state = { ...common, kind: "verify-email", email: query.get("email"), verified: query.get("verified") === "1" }; break;
      case "error": state = { ...common, kind: "error", title: "Account request failed", message: "The account request failed. Start again from the application or account page." }; break;
      case "account": {
        const session = await auth.api.getSession({ headers: c.req.raw.headers });
        if (!session) return c.redirect("/sign-in");
        if (!session.user.emailVerified) return c.redirect("/verify-email");
        state = { ...common, kind: "account", email: session.user.email, profile: await readProfile(pool, session.user.id, config.origin) };
        break;
      }
      case "consent": {
        if (!oauthQuery) return fail("Start authorization from the application.");
        const session = await auth.api.getSession({ headers: c.req.raw.headers });
        if (!session) return c.redirect(`/sign-in?oauth_query=${encodeURIComponent(oauthQuery)}`);
        if (!session.user.emailVerified) return c.redirect("/verify-email");
        const authorization = new URLSearchParams(oauthQuery);
        const clientId = authorization.get("client_id");
        const redirectUri = authorization.get("redirect_uri");
        const scopes = (authorization.get("scope") ?? "").split(" ").filter(Boolean);
        const clients = await pool.query<{ name: string; redirectUris: string[]; scopes: string[] }>(`SELECT name, "redirectUris", scopes FROM "oauthClient" WHERE "clientId" = $1 AND NOT disabled AND "subjectType" = 'public'`, [clientId]);
        const client = clients.rows[0];
        if (!client || !redirectUri || !client.redirectUris.includes(redirectUri) || scopes.some((scope) => !client.scopes.includes(scope) || !oauthScopes.includes(scope))) return fail("This application authorization request is invalid.");
        state = { ...common, kind: "consent", client: { name: client.name, redirectUri }, scopes };
        break;
      }
      default: return c.notFound();
    }
    return c.html(renderPage(state));
  });
  return app;
}
