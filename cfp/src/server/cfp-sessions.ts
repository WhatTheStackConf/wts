import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import * as oidc from "openid-client";
import { z } from "zod";
import type { VerifiedCfpAccount } from "../lib/account-model.ts";
import { openCfpDatabase } from "./storage.ts";

const proofLifetime = 300_000;
const opaque = /^[A-Za-z0-9_-]{43}$/;
const profileSchema = z.object({
  version: z.literal(1),
  wtsUserId: z.string().min(1).max(200),
  name: z.string().min(1).max(200),
  avatarUrl: z.string().max(2048).nullable().refine((value) => {
    if (value === null) return true;
    try {
      const url = new URL(value);
      return !url.username && !url.password && (url.protocol === "https:" || (url.protocol === "http:" && loopback(url.hostname)));
    } catch { return false; }
  }),
  preferredLanguage: z.string().max(64).nullable().refine((value) => {
    if (value === null) return true;
    try { return new Intl.Locale(value).toString() === value; } catch { return false; }
  }),
  username: z.string().max(200),
  emailVisibility: z.boolean(),
  revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
});
const userInfoSchema = z.object({
  sub: z.string().min(1),
  email: z.string().email().max(320),
  email_verified: z.literal(true),
  "https://wts.sh/user_id": z.string().min(1).max(200),
  "https://wts.sh/profile": profileSchema,
});
const flowSchema = z.object({ verifier: z.string().min(43).max(128), nonce: z.string().min(1), issuer: z.string(), clientId: z.string(), callback: z.string() });
const flowRowSchema = z.object({ encrypted_flow: z.string(), return_path: z.string(), expires_at: z.number().int() });
const sessionRowSchema = z.object({ issuer: z.string(), subject: z.string(), encrypted_access_token: z.string(), expires_at: z.number().int(), wts_user_id: z.string() });

function loopback(host: string): boolean {
  return host === "localhost" || host === "[::1]" || /^127(?:\.(?:\d{1,3})){3}$/.test(host);
}

function configuredUrl(name: string, originOnly: boolean): URL {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || (originOnly && value !== url.origin)) {
    throw new Error(`${name} must be an exact URL without credentials, a query, or a fragment.`);
  }
  if (value !== (originOnly ? url.origin : url.href.replace(/\/$/, ""))) {
    throw new Error(`${name} must use its canonical URL without a trailing slash.`);
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["development", "test"].includes(process.env.NODE_ENV || "") && loopback(url.hostname))) {
    throw new Error(`${name} requires HTTPS except for local development on loopback.`);
  }
  return url;
}

interface Settings {
  origin: string;
  issuer: string;
  clientId: string;
  clientSecret: string;
  key: Buffer;
  secure: boolean;
  callback: string;
  sessionCookie: string;
  flowCookie: string;
}

function settings(): Settings {
  const origin = configuredUrl("CFP_ORIGIN", true).origin;
  const issuer = configuredUrl("OIDC_ISSUER", false).href.replace(/\/$/, "");
  const clientId = process.env.OIDC_CLIENT_ID;
  const clientSecret = process.env.OIDC_CLIENT_SECRET;
  const encodedKey = process.env.CFP_SESSION_KEY;
  if (!clientId || !clientSecret) throw new Error("OIDC_CLIENT_ID and OIDC_CLIENT_SECRET are required.");
  if (!encodedKey || !opaque.test(encodedKey)) throw new Error("CFP_SESSION_KEY must contain 32 random bytes encoded as base64url.");
  const key = Buffer.from(encodedKey, "base64url");
  if (key.length !== 32 || key.toString("base64url") !== encodedKey) throw new Error("CFP_SESSION_KEY has an invalid encoding.");
  const secure = origin.startsWith("https:");
  return {
    origin, issuer, clientId, clientSecret, key, secure,
    callback: `${origin}/auth/callback`,
    sessionCookie: secure ? "__Host-wts-cfp-session" : "wts-cfp-session",
    flowCookie: secure ? "__Host-wts-cfp-flow" : "wts-cfp-flow",
  };
}

let discovered: { identity: string; promise: Promise<oidc.Configuration> } | undefined;
function provider(config: Settings): Promise<oidc.Configuration> {
  const identity = JSON.stringify([config.issuer, config.clientId, config.clientSecret]);
  if (discovered?.identity === identity) return discovered.promise;
  const promise = oidc.discovery(new URL(config.issuer), config.clientId,
    { token_endpoint_auth_method: "client_secret_basic", [oidc.clockTolerance]: 0 },
    oidc.ClientSecretBasic(config.clientSecret),
    { timeout: 10, execute: [oidc.enableNonRepudiationChecks, ...(config.issuer.startsWith("http:") ? [oidc.allowInsecureRequests] : [])] },
  ).then((client) => {
    const metadata = client.serverMetadata();
    if (metadata.issuer !== config.issuer) throw new Error("The identity service returned a different issuer.");
    for (const key of ["authorization_endpoint", "token_endpoint", "userinfo_endpoint", "jwks_uri"] as const) {
      const endpoint = metadata[key];
      if (!endpoint) throw new Error("The identity service did not supply a required endpoint.");
      const url = new URL(endpoint);
      if (url.username || url.password || url.hash || (url.protocol !== "https:" && !(config.issuer.startsWith("http:") && url.protocol === "http:" && url.origin === new URL(config.issuer).origin))) {
        throw new Error("The identity service returned an unsafe endpoint.");
      }
    }
    if (!metadata.code_challenge_methods_supported?.includes("S256")) throw new Error("The identity service must support S256 PKCE.");
    return client;
  }).catch((error: unknown) => {
    if (discovered?.promise === promise) discovered = undefined;
    throw error;
  });
  discovered = { identity, promise };
  return promise;
}

function hash(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

function encrypt(value: string, key: Buffer, context: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(context));
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return ["1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
}

function decrypt(value: string, key: Buffer, context: string): string {
  const [version, iv, tag, ciphertext, extra] = value.split(".");
  if (version !== "1" || !iv || !tag || !ciphertext || extra !== undefined) throw new Error("The encrypted session value is invalid.");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
}

function cookieToken(request: Request, name: string): string | null {
  const values = (request.headers.get("cookie") || "").split(";").map((part) => part.trim()).filter((part) => part.startsWith(`${name}=`));
  if (values.length !== 1) return null;
  const token = values[0].slice(name.length + 1);
  return opaque.test(token) ? token : null;
}

function cookie(config: Settings, name: string, value: string, expiresAt: number): string {
  const maxAge = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}; Expires=${new Date(expiresAt).toUTCString()}${config.secure ? "; Secure" : ""}`;
}

function response(status: number, body: string, extra?: HeadersInit): Response {
  const headers = new Headers(extra);
  headers.set("Cache-Control", "private, no-store");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("Content-Type", "text/plain; charset=utf-8");
  return new Response(body, { status, headers });
}

function redirect(path: string, cookies: string[] = []): Response {
  const headers = new Headers({ Location: path });
  for (const value of cookies) headers.append("Set-Cookie", value);
  return response(303, "", headers);
}

function assertOrigin(request: Request, config: Pick<Settings, "origin" | "secure">): URL {
  const url = new URL(request.url);
  if (process.env.CFP_TRUST_PROXY === "true" && config.secure && url.protocol === "http:" &&
      url.host === new URL(config.origin).host && request.headers.get("x-forwarded-proto") === "https") {
    url.protocol = "https:";
  }
  if (url.origin !== config.origin) throw response(403, "The request origin is invalid.");
  return url;
}

function returnPath(value: string | null, origin: string): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || /[\\\x00-\x20\x7f]/.test(value)) return "/applications";
  const url = new URL(value, origin);
  const idPath = /^\/(?:apply|applications)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (url.origin !== origin || url.search || url.hash || url.pathname !== value ||
      !(["/", "/applications", "/profile", "/settings"].includes(url.pathname) || idPath.test(url.pathname))) return "/applications";
  return url.pathname;
}

function centralAccount(info: unknown, subject: string, config: Settings): VerifiedCfpAccount {
  const claims = userInfoSchema.parse(info);
  const profile = claims["https://wts.sh/profile"];
  if (claims.sub !== subject || profile.wtsUserId !== claims["https://wts.sh/user_id"]) throw new Error("The central identity claims disagree.");
  return { wtsUserId: profile.wtsUserId, email: claims.email, emailVerified: true, profile, accountUrl: new URL("/account", config.issuer).href };
}

export function assertMutationRequest(request: Request): void {
  if (request.method !== "POST") throw response(405, "Use POST to change applicant data.", { Allow: "POST" });
  const origin = configuredUrl("CFP_ORIGIN", true).origin;
  assertOrigin(request, { origin, secure: origin.startsWith("https:") });
  if (request.headers.get("origin") !== origin || request.headers.get("sec-fetch-site") === "cross-site") {
    throw response(403, "Use a same-origin request to change applicant data.");
  }
}

export async function startLogin(request: Request): Promise<Response> {
  if (request.method !== "GET") return response(405, "Use GET to sign in.", { Allow: "GET" });
  const config = settings();
  const url = assertOrigin(request, config);
  const client = await provider(config);
  const verifier = oidc.randomPKCECodeVerifier();
  const state = oidc.randomState();
  const nonce = oidc.randomNonce();
  const browserToken = randomBytes(32).toString("base64url");
  const stateHash = hash(state);
  const browserHash = hash(browserToken);
  const expiresAt = Date.now() + proofLifetime;
  const authorization = oidc.buildAuthorizationUrl(client, {
    redirect_uri: config.callback, scope: "openid profile email wts.profile", response_type: "code",
    state, nonce, code_challenge: await oidc.calculatePKCECodeChallenge(verifier), code_challenge_method: "S256",
  });
  const encrypted = encrypt(JSON.stringify({ verifier, nonce, issuer: config.issuer, clientId: config.clientId, callback: config.callback }), config.key, `flow:${stateHash}:${browserHash}`);
  const db = openCfpDatabase();
  try {
    db.prepare("DELETE FROM oidc_flows WHERE expires_at <= ?").run(Date.now());
    db.prepare("INSERT INTO oidc_flows(state_hash,browser_binding_hash,encrypted_flow,return_path,expires_at) VALUES (?,?,?,?,?)")
      .run(stateHash, browserHash, encrypted, returnPath(url.searchParams.get("returnTo"), config.origin), expiresAt);
  } finally { db.close(); }
  return redirect(authorization.href, [cookie(config, config.flowCookie, browserToken, expiresAt)]);
}

export async function finishLogin(request: Request): Promise<Response> {
  const config = settings();
  const url = assertOrigin(request, config);
  if (request.method !== "GET" || url.pathname !== "/auth/callback") return response(400, "The authorization callback is invalid.");
  const state = url.searchParams.get("state");
  const browserToken = cookieToken(request, config.flowCookie);
  if (!state || url.searchParams.getAll("state").length !== 1 || !browserToken) return response(400, "The authorization state is invalid.");
  const stateHash = hash(state);
  const browserHash = hash(browserToken);
  const db = openCfpDatabase();
  let flow;
  try {
    flow = flowRowSchema.nullish().parse(db.prepare("DELETE FROM oidc_flows WHERE state_hash = ? AND browser_binding_hash = ? AND expires_at > ? RETURNING encrypted_flow,return_path,expires_at")
      .get(stateHash, browserHash, Date.now()));
  } finally { db.close(); }
  const clearFlow = cookie(config, config.flowCookie, "", 0);
  if (!flow) return response(400, "The authorization state has expired or was already used.");
  try {
    const secrets = flowSchema.parse(JSON.parse(decrypt(flow.encrypted_flow, config.key, `flow:${stateHash}:${browserHash}`)));
    if (secrets.issuer !== config.issuer || secrets.clientId !== config.clientId || secrets.callback !== config.callback) throw new Error("The authorization configuration changed.");
    const client = await provider(config);
    const exchangeStartedAt = Date.now();
    const tokens = await oidc.authorizationCodeGrant(client, url, {
      pkceCodeVerifier: secrets.verifier, expectedState: state, expectedNonce: secrets.nonce, idTokenExpected: true,
    }, { redirect_uri: config.callback });
    const claims = tokens.claims();
    if (!claims || claims.iss !== config.issuer || !claims.sub || !Number.isSafeInteger(claims.exp) || !Number.isFinite(tokens.expires_in) || !tokens.expires_in || tokens.expires_in <= 0 || tokens.token_type.toLowerCase() !== "bearer") {
      throw new Error("The identity service returned an unusable proof.");
    }
    const expiresAt = Math.floor(Math.min(claims.exp * 1000, exchangeStartedAt + tokens.expires_in * 1000, exchangeStartedAt + proofLifetime));
    const account = centralAccount(await oidc.fetchUserInfo(client, tokens.access_token, claims.sub), claims.sub, config);
    const now = Date.now();
    if (expiresAt <= now) throw new Error("The identity proof has expired.");
    const token = randomBytes(32).toString("base64url");
    const sessionHash = hash(token);
    const encryptedToken = encrypt(tokens.access_token, config.key, `session:${sessionHash}:${config.issuer}:${claims.sub}`);
    const sessionDb = openCfpDatabase();
    try {
      sessionDb.exec("BEGIN IMMEDIATE");
      const binding = z.object({ wts_user_id: z.string() }).nullish().parse(sessionDb.prepare("SELECT wts_user_id FROM oidc_bindings WHERE issuer = ? AND subject = ?").get(config.issuer, claims.sub));
      if (binding && binding.wts_user_id !== account.wtsUserId) throw new Error("The immutable identity binding changed.");
      sessionDb.prepare("INSERT INTO cfp_accounts(wts_user_id,created_at) VALUES (?,?) ON CONFLICT(wts_user_id) DO NOTHING").run(account.wtsUserId, now);
      sessionDb.prepare("INSERT INTO oidc_bindings(issuer,subject,wts_user_id,created_at) VALUES (?,?,?,?) ON CONFLICT(issuer,subject) DO NOTHING").run(config.issuer, claims.sub, account.wtsUserId, now);
      const previous = cookieToken(request, config.sessionCookie);
      if (previous) sessionDb.prepare("DELETE FROM cfp_sessions WHERE session_hash = ?").run(hash(previous));
      sessionDb.prepare("DELETE FROM cfp_sessions WHERE expires_at <= ?").run(now);
      sessionDb.prepare("INSERT INTO cfp_sessions(session_hash,issuer,subject,encrypted_access_token,created_at,expires_at) VALUES (?,?,?,?,?,?)")
        .run(sessionHash, config.issuer, claims.sub, encryptedToken, now, expiresAt);
      sessionDb.exec("COMMIT");
    } catch (error) {
      sessionDb.exec("ROLLBACK");
      throw error;
    } finally { sessionDb.close(); }
    return redirect(returnPath(flow.return_path, config.origin), [clearFlow, cookie(config, config.sessionCookie, token, expiresAt)]);
  } catch {
    return response(400, "The application rejected the identity response. Start a new sign-in attempt.", { "Set-Cookie": clearFlow });
  }
}

export async function readAccount(request: Request): Promise<VerifiedCfpAccount | null> {
  const origin = process.env.CFP_ORIGIN;
  const secure = origin ? origin.startsWith("https://") : new URL(request.url).protocol === "https:";
  const token = cookieToken(request, secure ? "__Host-wts-cfp-session" : "wts-cfp-session");
  if (!token) return null;
  const config = settings();
  assertOrigin(request, config);
  const sessionHash = hash(token);
  const db = openCfpDatabase();
  let session;
  try {
    session = sessionRowSchema.nullish().parse(db.prepare("SELECT s.issuer,s.subject,s.encrypted_access_token,s.expires_at,b.wts_user_id FROM cfp_sessions s JOIN oidc_bindings b USING(issuer,subject) WHERE s.session_hash = ?")
      .get(sessionHash));
    if (session && session.expires_at <= Date.now()) {
      db.prepare("DELETE FROM cfp_sessions WHERE session_hash = ?").run(sessionHash);
      return null;
    }
  } finally { db.close(); }
  if (!session || session.issuer !== config.issuer) return null;
  let account: VerifiedCfpAccount;
  try {
    const accessToken = decrypt(session.encrypted_access_token, config.key, `session:${sessionHash}:${session.issuer}:${session.subject}`);
    account = centralAccount(await oidc.fetchUserInfo(await provider(config), accessToken, session.subject), session.subject, config);
    if (account.wtsUserId !== session.wts_user_id || session.expires_at <= Date.now()) throw new Error("The identity proof is no longer valid.");
  } catch {
    throw response(503, "The identity service could not verify this account. Sign in again or try later.");
  }
  return account;
}

export async function requireAccount(request: Request): Promise<VerifiedCfpAccount> {
  const account = await readAccount(request);
  if (!account) throw response(401, "Sign in to access your account.");
  return account;
}

export async function logout(request: Request): Promise<Response> {
  if (request.method !== "POST") return response(405, "Use POST to sign out.", { Allow: "POST" });
  const config = settings();
  assertOrigin(request, config);
  if (request.headers.get("origin") !== config.origin || request.headers.get("sec-fetch-site") === "cross-site") return response(403, "Use a same-origin request to sign out.");
  const sessionToken = cookieToken(request, config.sessionCookie);
  const browserToken = cookieToken(request, config.flowCookie);
  const db = openCfpDatabase();
  try {
    if (sessionToken) db.prepare("DELETE FROM cfp_sessions WHERE session_hash = ?").run(hash(sessionToken));
    if (browserToken) db.prepare("DELETE FROM oidc_flows WHERE browser_binding_hash = ?").run(hash(browserToken));
  } finally { db.close(); }
  return redirect("/", [cookie(config, config.sessionCookie, "", 0), cookie(config, config.flowCookie, "", 0)]);
}

