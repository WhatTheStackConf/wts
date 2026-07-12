import { createGamificationAccountingStore } from "~/lib/gamification-accounting-store";
import {
  GamificationAdminSupportService,
  type AdminGamificationCaseSearchDto,
} from "~/lib/gamification-admin-support";
import type {
  AdminManualAwardInput,
  AdminXpCorrectionInput,
} from "~/lib/gamification-accounting";
import { runAuthenticatedGamificationOperation } from "~/lib/gamification-authorization";
import { requireAdmin } from "~/lib/server-auth";

export interface AdminManualAwardRequest extends AdminManualAwardInput {
  targetUserId: string;
  reason: string;
  confirmation: boolean;
  operationId: string;
}

export interface AdminXpCorrectionRequest extends AdminXpCorrectionInput {
  targetUserId: string;
  reason: string;
  confirmation: boolean;
  operationId: string;
}

export interface AdminBadgeRevocationRequest {
  userAchievementId: string;
  targetUserId: string;
  reason: string;
  confirmation: boolean;
  operationId: string;
}

export interface AdminXpVoidRequest {
  xpEventId: string;
  targetUserId: string;
  reason: string;
  confirmation: boolean;
  operationId: string;
}

export interface AdminActivityClaimVoidRequest {
  activityClaimId: string;
  targetUserId: string;
  reason: string;
  confirmation: boolean;
  operationId: string;
}

export interface AdminProfileRebuildRequest {
  targetUserId: string;
  reason: string;
  confirmation: boolean;
  operationId: string;
}

function actionError(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "Gamification support operation failed.";
}

function requireConfirmation(confirmed: boolean, action: string): void {
  if (!confirmed) throw new Error(`${action} requires confirmation.`);
}

async function withAdmin<T>(operation: (service: GamificationAdminSupportService, actor: { id: string; role: "admin" }) => Promise<T>) {
  return runAuthenticatedGamificationOperation(requireAdmin, async (admin) =>
    operation(new GamificationAdminSupportService(createGamificationAccountingStore()), { id: admin.id, role: "admin" }),
  );
}

function auditInput(request: { targetUserId: string; reason: string; operationId: string }, actor: { id: string; role: "admin" }) {
  return {
    actor: actor.id,
    actorRole: actor.role,
    targetUser: request.targetUserId,
    reason: request.reason,
    operationId: request.operationId,
  } as const;
}

/** Exact support lookup only. An empty query never returns a User export. */
export const adminSearchGamificationCase = async (
  query: string,
  historyPage = 1,
  historyPerPage = 50,
): Promise<{ success: boolean; data?: AdminGamificationCaseSearchDto; error?: string }> => {
  "use server";
  try {
    return { success: true, data: await withAdmin((service) => service.search(query, historyPage, historyPerPage)) };
  } catch (error) {
    return { success: false, error: actionError(error) };
  }
};

export const adminManualAwardGamificationAchievement = async (request: AdminManualAwardRequest) => {
  "use server";
  try {
    return {
      success: true,
      data: await withAdmin((service, actor) => {
        requireConfirmation(request.confirmation, "A manual award");
        return service.manualAward(request, auditInput(request, actor));
      }),
    };
  } catch (error) {
    return { success: false, error: actionError(error) };
  }
};

export const adminApplyGamificationXpCorrection = async (request: AdminXpCorrectionRequest) => {
  "use server";
  try {
    return {
      success: true,
      data: await withAdmin((service, actor) => {
        requireConfirmation(request.confirmation, "An XP correction");
        return service.correctXp(request, auditInput(request, actor));
      }),
    };
  } catch (error) {
    return { success: false, error: actionError(error) };
  }
};

export const adminVoidGamificationXpEvent = async (request: AdminXpVoidRequest) => {
  "use server";
  try {
    return {
      success: true,
      data: await withAdmin((service, actor) => {
        requireConfirmation(request.confirmation, "An XP Event void");
        return service.voidXpEvent(request.xpEventId, auditInput(request, actor));
      }),
    };
  } catch (error) {
    return { success: false, error: actionError(error) };
  }
};

export const adminVoidGamificationActivityClaim = async (request: AdminActivityClaimVoidRequest) => {
  "use server";
  try {
    return {
      success: true,
      data: await withAdmin((service, actor) => {
        requireConfirmation(request.confirmation, "An Activity Claim void");
        return service.voidActivityClaim(request.activityClaimId, auditInput(request, actor));
      }),
    };
  } catch (error) {
    return { success: false, error: actionError(error) };
  }
};

export const adminRevokeGamificationBadge = async (request: AdminBadgeRevocationRequest) => {
  "use server";
  try {
    return {
      success: true,
      data: await withAdmin((service, actor) => {
        requireConfirmation(request.confirmation, "A Badge revocation");
        return service.revokeBadge(request.userAchievementId, auditInput(request, actor));
      }),
    };
  } catch (error) {
    return { success: false, error: actionError(error) };
  }
};

export const adminRebuildGamificationProfile = async (request: AdminProfileRebuildRequest) => {
  "use server";
  try {
    return {
      success: true,
      data: await withAdmin((service, actor) => {
        requireConfirmation(request.confirmation, "A profile rebuild");
        return service.rebuildProfile(request.targetUserId, auditInput(request, actor));
      }),
    };
  } catch (error) {
    return { success: false, error: actionError(error) };
  }
};
