import { getRequestEvent } from "solid-js/web";
import PocketBase from "pocketbase";

const PB_AUTH_COOKIE = "pb_auth";
const DEFAULT_MAX_AGE = 7 * 24 * 60 * 60; // 7 days fallback
const TOKEN_AGE_BUFFER = 60; // expire cookie 60s before the JWT

function pocketBaseURL(): string {
  return process.env.POCKETBASE_URL || "http://localhost:8090";
}

/**
 * Extract the `exp` claim from a JWT and return a max-age value
 * (seconds from now) with a small buffer so the cookie never outlives the token.
 */
function tokenMaxAge(token: string): number {
  try {
    const payload = JSON.parse(
      atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")),
    );
    if (typeof payload.exp === "number") {
      const remaining = payload.exp - Math.floor(Date.now() / 1000);
      return Math.max(remaining - TOKEN_AGE_BUFFER, 0);
    }
  } catch {
    // malformed token — fall through to default
  }
  return DEFAULT_MAX_AGE;
}

function makeSetCookie(pbInstance: PocketBase, isSecure: boolean): string {
  const maxAge = pbInstance.authStore.token
    ? tokenMaxAge(pbInstance.authStore.token)
    : DEFAULT_MAX_AGE;

  // Use the SDK's exportToCookie to get the exact format loadFromCookie expects,
  // then extract just the name=value portion for Set-Cookie.
  const fullCookie = pbInstance.authStore.exportToCookie({
    httpOnly: true,
    secure: isSecure,
    sameSite: "Lax",
    maxAge,
  });
  const nameValue = fullCookie.split(";")[0];
  return `${nameValue}; Path=/; Max-Age=${maxAge}; SameSite=Lax${isSecure ? "; Secure" : ""}`;
}

/**
 * Server-side login: authenticates against PocketBase and sets an HTTP-only
 * session cookie via Set-Cookie header. Returns the user record and token.
 */
export const serverLogin = async (email: string, password: string) => {
  "use server";
  const event = getRequestEvent();

  const pb = new PocketBase(pocketBaseURL());
  const authData = await pb.collection("users").authWithPassword(email, password);

  const isSecure = (event?.request.headers.get("x-forwarded-proto") || "http") === "https";
  event?.response.headers.append("Set-Cookie", makeSetCookie(pb, isSecure));

  return {
    token: authData.token,
    record: {
      id: authData.record.id,
      email: authData.record.email,
      name: (authData.record as any).name,
      role: (authData.record as any).role,
      verified: authData.record.verified,
    },
  };
};

/**
 * Server-side logout: clears the HTTP-only session cookie.
 */
export const serverLogout = async () => {
  "use server";
  const event = getRequestEvent();

  event?.response.headers.append(
    "Set-Cookie",
    `${PB_AUTH_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`,
  );
};

/**
 * Syncs the HTTP-only session cookie from a client-side token.
 * Called on page refresh when the user is authenticated via localStorage
 * but the server-side cookie may have expired or been cleared.
 */
export const syncCookieFromToken = async (token: string) => {
  "use server";
  const event = getRequestEvent();

  const pb = new PocketBase(pocketBaseURL());
  pb.authStore.save(token, null);

  try {
    await pb.collection("users").authRefresh();
  } catch {
    return { success: false };
  }

  if (!pb.authStore.record) {
    return { success: false };
  }

  const isSecure = (event?.request.headers.get("x-forwarded-proto") || "http") === "https";
  event?.response.headers.append("Set-Cookie", makeSetCookie(pb, isSecure));

  return { success: true };
};

/**
 * Validates that the current request is from an authenticated admin user.
 * Reads the HTTP-only pb_auth cookie set by serverLogin.
 *
 * @returns The authenticated user model
 */
export const requireAdmin = async () => {
  const event = getRequestEvent();
  if (!event) {
    throw new Error("No request event available (server-side only)");
  }

  const cookie = event.request.headers.get("cookie") || "";

  if (!cookie.includes(`${PB_AUTH_COOKIE}=`)) {
    throw new Error("Unauthorized: Admin access required");
  }

  const pb = new PocketBase(pocketBaseURL());
  pb.authStore.loadFromCookie(cookie);

  if (!pb.authStore.isValid) {
    throw new Error("Unauthorized: Admin access required");
  }

  try {
    await pb.collection("users").authRefresh();
  } catch {
    throw new Error("Unauthorized: Admin access required");
  }

  if (pb.authStore.record?.role !== "admin") {
    throw new Error("Unauthorized: Admin access required");
  }

  return pb.authStore.record;
};

/**
 * Validates that the current request is from an authenticated user.
 * @returns The authenticated user model
 */
export const requireAuth = async () => {
  const event = getRequestEvent();
  if (!event) {
    throw new Error("No request event available (server-side only)");
  }

  const cookie = event.request.headers.get("cookie") || "";

  const pb = new PocketBase(pocketBaseURL());
  pb.authStore.loadFromCookie(cookie);

  if (!pb.authStore.isValid) {
    throw new Error("Unauthorized: Login required");
  }

  try {
    await pb.collection("users").authRefresh();
  } catch {
    throw new Error("Unauthorized: Login required");
  }

  return pb.authStore.record;
};

/**
 * Validates that the current request is from an authenticated reviewer OR admin.
 * @returns The authenticated user model
 */
export const requireReviewer = async () => {
  const user = await requireAuth();
  if (user.role !== "reviewer" && user.role !== "admin") {
    throw new Error("Unauthorized: Reviewer access required");
  }
  return user;
};
