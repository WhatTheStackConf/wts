import { z } from "zod";

export interface Config {
  origin: string;
  databaseUrl: string;
  secret: string;
  production: boolean;
  registrationOpen: boolean;
  host: string;
  port: number;
  providers: {
    google: { clientId: string; clientSecret: string } | undefined;
    github: { clientId: string; clientSecret: string } | undefined;
  };
  smtp: {
    host: string;
    port: number;
    secure: boolean;
    from: string;
    auth: { user: string; pass: string } | undefined;
  };
}

const optionalCredential = z.preprocess((value) => value === "" ? undefined : value, z.string().min(1).optional());

const environment = z.object({
  NODE_ENV: z.enum(["production", "development", "test"]).default("production"),
  AUTH_PUBLIC_URL: z.string().url(),
  DATABASE_URL: z.string().url(),
  BETTER_AUTH_SECRET: z.string().min(32).refine((value) => new Set(value).size >= 8),
  AUTH_REGISTRATION: z.enum(["closed", "open"]).default("closed"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  SMTP_HOST: z.string().min(1),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_SECURE: z.enum(["true", "false"]).default("false"),
  SMTP_FROM: z.string().min(1),
  SMTP_USER: optionalCredential,
  SMTP_PASSWORD: optionalCredential,
  GOOGLE_CLIENT_ID: optionalCredential,
  GOOGLE_CLIENT_SECRET: optionalCredential,
  GITHUB_CLIENT_ID: optionalCredential,
  GITHUB_CLIENT_SECRET: optionalCredential,
});

export function isLoopback(hostname: string): boolean {
  return hostname === "localhost" || hostname === "[::1]" || /^127(?:\.\d{1,3}){3}$/.test(hostname);
}

export function readConfig(env: NodeJS.ProcessEnv): Config {
  const result = environment.safeParse(env);
  if (!result.success) throw new Error("Invalid auth environment configuration.");
  const values = result.data;
  const publicUrl = new URL(values.AUTH_PUBLIC_URL);
  const production = values.NODE_ENV === "production";
  if (publicUrl.pathname !== "/" || publicUrl.search || publicUrl.hash || publicUrl.username || publicUrl.password) {
    throw new Error("AUTH_PUBLIC_URL must contain an origin only.");
  }
  if (publicUrl.protocol !== "https:" && (production || publicUrl.protocol !== "http:" || !isLoopback(publicUrl.hostname))) {
    throw new Error("AUTH_PUBLIC_URL must use HTTPS or a rehearsal loopback origin.");
  }
  const databaseUrl = new URL(values.DATABASE_URL);
  if (!["postgres:", "postgresql:"].includes(databaseUrl.protocol)) throw new Error("DATABASE_URL must use PostgreSQL.");
  function pair(id: string | undefined, secret: string | undefined) {
    if (Boolean(id) !== Boolean(secret)) throw new Error("Provider and SMTP credentials must contain complete pairs.");
    return id && secret ? { clientId: id, clientSecret: secret } : undefined;
  }
  const google = pair(values.GOOGLE_CLIENT_ID, values.GOOGLE_CLIENT_SECRET);
  const github = pair(values.GITHUB_CLIENT_ID, values.GITHUB_CLIENT_SECRET);
  const smtpCredentials = pair(values.SMTP_USER, values.SMTP_PASSWORD);
  if (production && !smtpCredentials) throw new Error("Production SMTP requires credentials.");
  return {
    origin: publicUrl.origin,
    databaseUrl: values.DATABASE_URL,
    secret: values.BETTER_AUTH_SECRET,
    production,
    registrationOpen: values.AUTH_REGISTRATION === "open",
    host: values.HOST,
    port: values.PORT,
    providers: { google, github },
    smtp: {
      host: values.SMTP_HOST,
      port: values.SMTP_PORT,
      secure: values.SMTP_SECURE === "true",
      from: values.SMTP_FROM,
      auth: smtpCredentials ? { user: smtpCredentials.clientId, pass: smtpCredentials.clientSecret } : undefined,
    },
  };
}

