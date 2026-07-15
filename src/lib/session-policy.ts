export const PB_AUTH_COOKIE = "pb_auth";
export const PB_AUTH_MANAGED_COOKIE = "pb_auth_managed";
export const LEGACY_AUTH_STORAGE_KEYS = ["pocketbase_auth", "pb_auth"] as const;

const MAX_SESSION_AGE_SECONDS = 7 * 24 * 60 * 60;
const TOKEN_AGE_BUFFER_SECONDS = 60;

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  avatar: string;
  role: "user" | "reviewer" | "admin";
  verified: boolean;
}

function decodeTokenPayload(token: string): { exp?: unknown } | null {
  try {
    const encoded = token.split(".")[1];
    if (!encoded) return null;
    const normalized = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    return JSON.parse(atob(padded)) as { exp?: unknown };
  } catch {
    return null;
  }
}

export function tokenMaxAge(token: string, now = Date.now()): number {
  const payload = decodeTokenPayload(token);
  if (typeof payload?.exp !== "number") return 0;
  const remaining = payload.exp - Math.floor(now / 1000) - TOKEN_AGE_BUFFER_SECONDS;
  return Math.max(0, Math.min(remaining, MAX_SESSION_AGE_SECONDS));
}

export function serializeSessionCookie(
  token: string,
  secure: boolean,
  now = Date.now(),
): string {
  const maxAge = tokenMaxAge(token, now);
  if (maxAge <= 0) throw new Error("Unauthorized");
  const value = encodeURIComponent(JSON.stringify({ token, record: null }));
  const expires = new Date(now + maxAge * 1000).toUTCString();
  return `${PB_AUTH_COOKIE}=${value}; Path=/; Max-Age=${maxAge}; Expires=${expires}; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}

export function serializeManagedSessionCookie(
  token: string,
  secure: boolean,
  now = Date.now(),
): string {
  const maxAge = tokenMaxAge(token, now);
  if (maxAge <= 0) throw new Error("Unauthorized");
  const expires = new Date(now + maxAge * 1000).toUTCString();
  return `${PB_AUTH_MANAGED_COOKIE}=1; Path=/; Max-Age=${maxAge}; Expires=${expires}; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}

export function serializeExpiredSessionCookie(secure: boolean): string {
  return `${PB_AUTH_COOKIE}=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}

export function serializeExpiredManagedSessionCookie(secure: boolean): string {
  return `${PB_AUTH_MANAGED_COOKIE}=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}

export function hasManagedSessionCookie(cookie: string): boolean {
  return cookie.split(";").some((part) => part.trim() === `${PB_AUTH_MANAGED_COOKIE}=1`);
}

export function sessionUser(record: Record<string, unknown>): SessionUser {
  const role = record.role;
  if (role !== "user" && role !== "reviewer" && role !== "admin") {
    throw new Error("Unauthorized");
  }
  return {
    id: String(record.id || ""),
    email: String(record.email || ""),
    name: String(record.name || ""),
    avatar: String(record.avatar || ""),
    role,
    verified: record.verified === true,
  };
}

function forwardedValue(request: Request, name: string): string {
  return request.headers.get(name)?.split(",")[0]?.trim() || "";
}

export function isSameOriginMutation(request: Request): boolean {
  if (request.method !== "POST") return false;
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;

  const origin = request.headers.get("origin");
  if (!origin) return false;

  try {
    const requestUrl = new URL(request.url);
    const host = forwardedValue(request, "x-forwarded-host") || request.headers.get("host") || requestUrl.host;
    const protocol = forwardedValue(request, "x-forwarded-proto") || requestUrl.protocol.replace(":", "");
    return new URL(origin).origin === `${protocol}://${host}`;
  } catch {
    return false;
  }
}

export function legacyTokenFromStorage(value: string | null): string | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as { token?: unknown };
    return typeof parsed.token === "string" && parsed.token.length > 0 ? parsed.token : null;
  } catch {
    return null;
  }
}
