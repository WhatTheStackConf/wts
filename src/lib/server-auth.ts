import {
  getSessionCore,
  serverLoginResultCore,
  serverLoginWithTokenResultCore,
  serverLogoutCore,
} from "~/lib/server-auth-core";
import type { SessionUser } from "~/lib/session-policy";
import type { AuthResult } from "~/lib/auth-errors";

export {
  requireAdmin,
  requireAuth,
  requireCheckinOperatorSession,
  requireReviewer,
  requireReviewerSession,
} from "~/lib/server-auth-core";

export const serverLogin = async (email: string, password: string): Promise<AuthResult<SessionUser>> => {
  "use server";
  return serverLoginResultCore(email, password);
};

export const serverLoginWithToken = async (token: string): Promise<AuthResult<SessionUser>> => {
  "use server";
  return serverLoginWithTokenResultCore(token);
};

export const getSession = async (): Promise<SessionUser | null> => {
  "use server";
  return getSessionCore();
};

export const serverLogout = async (): Promise<void> => {
  "use server";
  return serverLogoutCore();
};
