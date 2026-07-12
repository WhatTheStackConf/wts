import {
  GamificationAccountingService,
  type AccountingUser,
  type GamificationVisibilitySettingsInput,
} from "~/lib/gamification-accounting";
import { createGamificationAccountingStore } from "~/lib/gamification-accounting-store";
import { runAuthenticatedGamificationOperation } from "~/lib/gamification-authorization";
import { requireAuth } from "~/lib/server-auth";

function asAccountingUser(user: { id: string; name?: string; email?: string }): AccountingUser {
  return { id: user.id, name: user.name, email: user.email };
}

/** Returns the allowlisted Gamification Profile summary for the currently authenticated User only. */
export const getMyGamificationProfileSummary = async () => {
  "use server";
  return runAuthenticatedGamificationOperation(requireAuth, async (user) => {
    const accounting = new GamificationAccountingService(createGamificationAccountingStore());
    return accounting.summaryForUser(asAccountingUser(user));
  });
};

/** Returns only the safe, cached public projection. It never reads claims, XP events, or source data. */
export const getPublicOpsBoard = async (page = 1, perPage = 50) => {
  "use server";
  const accounting = new GamificationAccountingService(createGamificationAccountingStore());
  return accounting.publicOpsBoardPage(page, perPage);
};

/** The current User is derived from auth; callers cannot alter another User's public settings. */
export const updateMyGamificationVisibility = async (input: GamificationVisibilitySettingsInput) => {
  "use server";
  return runAuthenticatedGamificationOperation(requireAuth, async (user) => {
    const accounting = new GamificationAccountingService(createGamificationAccountingStore());
    return accounting.updateVisibilitySettings(asAccountingUser(user), input);
  });
};

/** The Badge ID is checked against the server-derived current User before it can be updated. */
export const updateMyGamificationBadgeVisibility = async (badgeId: string, publicVisible: boolean) => {
  "use server";
  return runAuthenticatedGamificationOperation(requireAuth, async (user) => {
    const accounting = new GamificationAccountingService(createGamificationAccountingStore());
    return accounting.updateBadgeVisibility(asAccountingUser(user), badgeId, publicVisible);
  });
};
