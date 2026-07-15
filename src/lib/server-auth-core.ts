import PocketBase from "pocketbase";
import { getRequestEvent } from "solid-js/web";
import {
  PB_AUTH_COOKIE,
  hasManagedSessionCookie,
  isSameOriginMutation,
  serializeExpiredManagedSessionCookie,
  serializeExpiredSessionCookie,
  serializeManagedSessionCookie,
  serializeSessionCookie,
  sessionUser,
  type SessionUser,
} from "~/lib/session-policy";

function pocketBaseURL(): string {
  return process.env.POCKETBASE_URL || "http://localhost:8090";
}

function requestEvent() {
  const event = getRequestEvent();
  if (!event) throw new Error("Unauthorized");
  return event;
}

function secureCookie(request: Request): boolean {
  const forwardedProtocol = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  return process.env.NODE_ENV === "production" || forwardedProtocol === "https" || new URL(request.url).protocol === "https:";
}

function requireSessionMutation() {
  const event = requestEvent();
  if (!isSameOriginMutation(event.request)) throw new Error("Unauthorized");
  return event;
}

function setSessionCookie(token: string): void {
  const event = requestEvent();
  const secure = secureCookie(event.request);
  event.response.headers.append(
    "Set-Cookie",
    serializeSessionCookie(token, secure),
  );
  event.response.headers.append("Set-Cookie", serializeManagedSessionCookie(token, secure));
}

function clearSessionCookie(): void {
  const event = requestEvent();
  const secure = secureCookie(event.request);
  event.response.headers.append(
    "Set-Cookie",
    serializeExpiredSessionCookie(secure),
  );
  event.response.headers.append("Set-Cookie", serializeExpiredManagedSessionCookie(secure));
}

function isUnauthorizedError(error: unknown): boolean {
  return error instanceof Error && error.message === "Unauthorized";
}

function isPocketBaseAuthFailure(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const status = Number((error as { status?: unknown }).status);
  return status === 401 || status === 403;
}

async function refreshToken(token: string): Promise<PocketBase> {
  if (!token || token.length > 8192) throw new Error("Unauthorized");
  const pb = new PocketBase(pocketBaseURL());
  pb.authStore.save(token, null);
  if (!pb.authStore.isValid) throw new Error("Unauthorized");
  try {
    await pb.collection("users").authRefresh();
  } catch (error) {
    if (isPocketBaseAuthFailure(error)) throw new Error("Unauthorized");
    throw error;
  }
  if (!pb.authStore.isValid || !pb.authStore.record || pb.authStore.record.verified !== true) {
    throw new Error("Unauthorized");
  }
  return pb;
}

async function refreshRequestSession(rotateCookie: boolean): Promise<{ pb: PocketBase; user: SessionUser }> {
  const event = requestEvent();
  const cookie = event.request.headers.get("cookie") || "";
  if (!cookie.includes(`${PB_AUTH_COOKIE}=`)) throw new Error("Unauthorized");

  const pb = new PocketBase(pocketBaseURL());
  pb.authStore.loadFromCookie(cookie);
  if (!pb.authStore.isValid || !pb.authStore.token) throw new Error("Unauthorized");

  const refreshed = await refreshToken(pb.authStore.token);
  const user = sessionUser(refreshed.authStore.record as unknown as Record<string, unknown>);
  if (rotateCookie) setSessionCookie(refreshed.authStore.token);
  return { pb: refreshed, user };
}

/** Authenticates a password without exposing a PocketBase token to browser JavaScript. */
export const serverLoginCore = async (email: string, password: string): Promise<SessionUser> => {
  requireSessionMutation();
  const pb = new PocketBase(pocketBaseURL());
  const authData = await pb.collection("users").authWithPassword(email, password);
  if (authData.record.verified !== true) {
    throw new Error("Please verify your email address before logging in.");
  }
  const user = sessionUser(authData.record as unknown as Record<string, unknown>);
  setSessionCookie(authData.token);
  return user;
};

/**
 * Validates a temporary OAuth or legacy browser token with PocketBase before
 * rotating it into the HttpOnly server session. No client model is accepted.
 */
export const serverLoginWithTokenCore = async (token: string): Promise<SessionUser> => {
  requireSessionMutation();
  const pb = await refreshToken(token);
  const user = sessionUser(pb.authStore.record as unknown as Record<string, unknown>);
  setSessionCookie(pb.authStore.token);
  return user;
};

/** Returns sanitized session state and rotates valid legacy/readable cookies to HttpOnly. */
export const getSessionCore = async (): Promise<SessionUser | null> => {
  const event = requireSessionMutation();
  try {
    const cookie = event.request.headers.get("cookie") || "";
    return (await refreshRequestSession(!hasManagedSessionCookie(cookie))).user;
  } catch (error) {
    if (!isUnauthorizedError(error)) throw error;
    clearSessionCookie();
    return null;
  }
};

export const serverLogoutCore = async (): Promise<void> => {
  requireSessionMutation();
  clearSessionCookie();
};

export const requireAuth = async (): Promise<SessionUser> => {
  requireSessionMutation();
  try {
    return (await refreshRequestSession(false)).user;
  } catch (error) {
    if (isUnauthorizedError(error)) throw new Error("Unauthorized");
    throw error;
  }
};

export const requireReviewerSession = async (): Promise<{ pb: PocketBase; user: SessionUser }> => {
  requireSessionMutation();
  try {
    const session = await refreshRequestSession(false);
    if (session.user.role !== "reviewer" && session.user.role !== "admin") {
      throw new Error("Unauthorized");
    }
    return session;
  } catch (error) {
    if (isUnauthorizedError(error)) throw new Error("Unauthorized");
    throw error;
  }
};

export const requireAdmin = async (): Promise<SessionUser> => {
  const user = await requireAuth();
  if (user.role !== "admin") throw new Error("Unauthorized");
  return user;
};

export const requireReviewer = async (): Promise<SessionUser> => {
  const user = await requireAuth();
  if (user.role !== "reviewer" && user.role !== "admin") {
    throw new Error("Unauthorized");
  }
  return user;
};
