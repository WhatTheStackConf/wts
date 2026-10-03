import { betterAuth, APIError } from "better-auth";
import type { Auth } from "better-auth";
import { jwt } from "better-auth/plugins";
import { createAuthEndpoint, createAuthMiddleware } from "better-auth/api";
import { resolveSigningKey } from "better-auth/plugins/jwt";
import { oauthProvider, oauthProviderAuthServerMetadata, oauthProviderOpenIdConfigMetadata } from "@better-auth/oauth-provider";
import bcrypt from "bcryptjs";
import nodemailer from "nodemailer";
import { Pool } from "pg";
import { z } from "zod";
import { createHash, timingSafeEqual } from "node:crypto";
import type { Config } from "./config.js";
import { profileFields, readProfile } from "./profile.js";

export const oauthScopes = ["openid", "profile", "email", "wts.profile"];

export function hashClientSecret(secret: string) {
  return createHash("sha256").update(secret, "utf8").digest("base64url");
}

export interface Runtime {
  auth: Pick<Auth, "handler"> & { api: Pick<Auth["api"], "getSession"> };
  pool: Pool;
  config: Config;
  openIdConfiguration: (request: Request) => Promise<Response>;
  authorizationServerMetadata: (request: Request) => Promise<Response>;
  initializeSigningKeys: () => Promise<void>;
  close: () => Promise<void>;
}

export function createRuntime(config: Config): Runtime {
  const pool = new Pool({ connectionString: config.databaseUrl, max: 10, connectionTimeoutMillis: 5000 });
  pool.on("error", () => process.stderr.write("Auth database connection failed.\n"));
  const mail = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    ...(config.smtp.auth ? { auth: config.smtp.auth } : {}),
    ...(config.production && !config.smtp.secure ? { requireTLS: true } : {}),
    connectionTimeout: 10000,
    socketTimeout: 15000,
  });
  async function sendMail(to: string, subject: string, text: string) {
    try { await mail.sendMail({ from: config.smtp.from, to, subject, text }); }
    catch { throw new APIError("INTERNAL_SERVER_ERROR", { message: "Email delivery failed. Try again later." }); }
  }
  const secureCookies = config.production || config.origin.startsWith("https:");
  const auth = betterAuth({
    appName: "WTS account",
    baseURL: config.origin,
    basePath: "/api/auth",
    secret: config.secret,
    database: pool,
    trustedOrigins: [config.origin],
    logger: { disabled: true },
    user: { additionalFields: profileFields },
    session: {
      expiresIn: 8 * 60 * 60,
      disableSessionRefresh: true,
      cookieCache: { enabled: false },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        const password = ctx.path === "/sign-up/email" ? ctx.body?.password : ctx.path === "/reset-password" ? ctx.body?.newPassword : undefined;
        if (typeof password === "string" && Buffer.byteLength(password, "utf8") > 72) {
          throw new APIError("BAD_REQUEST", { message: "New passwords must contain 72 UTF-8 bytes or fewer." });
        }
      }),
    },
    databaseHooks: {
      session: { create: { before: async (session) => ({
        data: { ...session, expiresAt: new Date(session.createdAt.getTime() + 8 * 60 * 60 * 1000) },
      }) } },
    },
    advanced: {
      useSecureCookies: false,
      crossSubDomainCookies: { enabled: false },
      defaultCookieAttributes: { httpOnly: true, secure: secureCookies, sameSite: "lax", path: "/" },
      cookiePrefix: secureCookies ? "__Host-wts-auth" : "wts-auth",
    },
    account: {
      encryptOAuthTokens: true,
      accountLinking: { enabled: false, disableImplicitLinking: true, updateUserInfoOnLink: false },
    },
    socialProviders: {
      ...(config.providers.google ? { google: { ...config.providers.google, disableSignUp: !config.registrationOpen, overrideUserInfoOnSignIn: false } } : {}),
      ...(config.providers.github ? { github: { ...config.providers.github, disableSignUp: !config.registrationOpen, overrideUserInfoOnSignIn: false } } : {}),
    },
    emailAndPassword: {
      enabled: true,
      disableSignUp: !config.registrationOpen,
      requireEmailVerification: true,
      autoSignIn: false,
      maxPasswordLength: 4096,
      minPasswordLength: 12,
      password: {
        hash: async (password) => bcrypt.hash(password, 12),
        verify: async ({ hash, password }) => bcrypt.compare(password, hash),
      },
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, token }) => {
        const url = new URL("/reset-password", config.origin);
        url.searchParams.set("token", token);
        await sendMail(user.email, "Reset your WTS password", `Open this link to reset your password.\n\n${url.href}\n\nThis link expires in one hour.`);
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      autoSignInAfterVerification: false,
      sendVerificationEmail: async ({ user, token }) => {
        const url = new URL("/api/auth/verify-email", config.origin);
        url.searchParams.set("token", token);
        url.searchParams.set("callbackURL", `${config.origin}/verify-email?verified=1`);
        await sendMail(user.email, "Verify your WTS email", `Open this link to verify your email.\n\n${url.href}\n\nThis link expires in one hour.`);
      },
    },
    plugins: [
      jwt({ jwt: { issuer: config.origin, expirationTime: "5m" }, disableSettingJwtHeader: true }),
      {
        id: "wts-key-readiness",
        endpoints: {
          checkSigningKey: createAuthEndpoint("/wts-key-readiness", {
            method: "GET",
            metadata: { SERVER_ONLY: true },
          }, async (ctx) => {
            await resolveSigningKey(ctx);
            return { ready: true };
          }),
        },
      },
      oauthProvider({
        loginPage: "/sign-in",
        consentPage: "/consent",
        signup: { page: "/sign-up" },
        scopes: oauthScopes,
        grantTypes: ["authorization_code"],
        accessTokenExpiresIn: 300,
        idTokenExpiresIn: 300,
        codeExpiresIn: 300,
        allowDynamicClientRegistration: false,
        allowUnauthenticatedClientRegistration: false,
        clientPrivileges: () => false,
        resourcePrivileges: () => false,
        validateRedirectUri: (uri, registered) => registered.includes(uri),
        storeClientSecret: {
          hash: hashClientSecret,
          verify: async (secret, hash) => {
            const actual = Buffer.from(hashClientSecret(secret));
            const expected = Buffer.from(hash);
            return actual.length === expected.length && timingSafeEqual(actual, expected);
          },
        },
        advertisedMetadata: {
          scopes_supported: oauthScopes,
          claims_supported: ["https://wts.sh/user_id", "https://wts.sh/profile"],
        },
        customTokenResponseFields: async ({ user, verificationValue }) => {
          const sessionId = verificationValue?.sessionId;
          if (!user?.emailVerified || !sessionId) throw new APIError("FORBIDDEN", { error: "access_denied", error_description: "Verify your email before you authorize an application." });
          const session = await pool.query(`SELECT 1 FROM session WHERE id = $1 AND "userId" = $2 AND "expiresAt" > now()`, [sessionId, user.id]);
          if (session.rowCount !== 1) throw new APIError("FORBIDDEN", { error: "access_denied", error_description: "The account session has ended." });
          return {};
        },
        extensions: [{ claims: {
          userInfo: async ({ user, scopes, jwt: token }) => {
            if (!user.emailVerified || typeof token.sid !== "string") throw new APIError("UNAUTHORIZED", { error: "invalid_token", error_description: "The account session has ended." });
            const session = await pool.query(`SELECT 1 FROM session WHERE id = $1 AND "userId" = $2 AND "expiresAt" > now()`, [token.sid, user.id]);
            if (session.rowCount !== 1) throw new APIError("UNAUTHORIZED", { error: "invalid_token", error_description: "The account session has ended." });
            if (!scopes.includes("wts.profile")) return {};
            const profile = await readProfile(pool, user.id, config.origin);
            return { "https://wts.sh/user_id": profile.wtsUserId, "https://wts.sh/profile": { version: 1, ...profile } };
          },
        } }],
      }),
    ],
  });
  const openId = oauthProviderOpenIdConfigMetadata(auth);
  const oauthMetadata = oauthProviderAuthServerMetadata(auth);
  async function serviceMetadata(response: Response) {
    if (!response.ok) return response;
    const metadata = z.record(z.string(), z.unknown()).parse(await response.json());
    delete metadata.end_session_endpoint;
    metadata.backchannel_logout_supported = false;
    metadata.backchannel_logout_session_supported = false;
    return Response.json(metadata, { status: response.status, headers: response.headers });
  }
  let closed = false;
  return {
    auth,
    pool,
    config,
    openIdConfiguration: async (request) => serviceMetadata(await openId(request)),
    authorizationServerMetadata: async (request) => serviceMetadata(await oauthMetadata(request)),
    initializeSigningKeys: async () => { await auth.api.checkSigningKey(); },
    close: async () => {
      if (closed) return;
      closed = true;
      mail.close();
      await pool.end();
    },
  };
}
