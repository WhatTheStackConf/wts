import {
  getSessionCore,
  serverLoginCore,
  serverLoginWithTokenCore,
  serverLogoutCore,
} from "~/lib/server-auth-core";
import type { SessionUser } from "~/lib/session-policy";

export {
  requireAdmin,
  requireAuth,
  requireReviewer,
  requireReviewerSession,
} from "~/lib/server-auth-core";

export const serverLogin = async (email: string, password: string): Promise<SessionUser> => {
  "use server";
  return serverLoginCore(email, password);
};

export const serverLoginWithToken = async (token: string): Promise<SessionUser> => {
  "use server";
  return serverLoginWithTokenCore(token);
};

export const getSession = async (): Promise<SessionUser | null> => {
  "use server";
  return getSessionCore();
};

export const serverLogout = async (): Promise<void> => {
  "use server";
  return serverLogoutCore();
};
