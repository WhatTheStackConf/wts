import { createGamificationAccountingStore } from "~/lib/gamification-accounting-store";
import { runAuthenticatedGamificationOperation } from "~/lib/gamification-authorization";
import {
  GamificationHiEventsEvidenceService,
  type AdminHiEventsReconciliationDto,
  type HiEventsProfileStatusDto,
} from "~/lib/gamification-hievents-evidence";
import { requireAdmin, requireAuth } from "~/lib/server-auth";

function actionError(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "Hi.Events status is temporarily unavailable.";
}

export const getMyHiEventsEvidenceStatus = async (): Promise<HiEventsProfileStatusDto> => {
  "use server";
  return runAuthenticatedGamificationOperation(requireAuth, async (user) =>
    new GamificationHiEventsEvidenceService(createGamificationAccountingStore()).statusForUser({
      id: user.id,
      name: user.name,
      email: user.email,
    }));
};

/** The authenticated WTS email is derived on the server; no attendee input crosses this boundary. */
export const refreshMyHiEventsEvidence = async (): Promise<HiEventsProfileStatusDto> => {
  "use server";
  return runAuthenticatedGamificationOperation(requireAuth, async (user) =>
    new GamificationHiEventsEvidenceService(createGamificationAccountingStore()).refreshCurrentUser({
      id: user.id,
      name: user.name,
      email: user.email,
    }));
};

export const adminPreviewHiEventsReconciliation = async (): Promise<{ success: boolean; data?: AdminHiEventsReconciliationDto; error?: string }> => {
  "use server";
  try {
    const data = await runAuthenticatedGamificationOperation(requireAdmin, async () =>
      new GamificationHiEventsEvidenceService(createGamificationAccountingStore()).previewAdminReconciliation());
    return { success: true, data };
  } catch (error) {
    return { success: false, error: actionError(error) };
  }
};

/** A browser must explicitly confirm after inspecting a preview; application refetches source before it writes. */
export const adminApplyHiEventsReconciliation = async (
  confirmation: boolean,
  snapshotFingerprint: string,
  operationId: string,
): Promise<{ success: boolean; data?: AdminHiEventsReconciliationDto; error?: string }> => {
  "use server";
  if (confirmation !== true) return { success: false, error: "Review the Hi.Events preview before syncing." };
  try {
    const data = await runAuthenticatedGamificationOperation(requireAdmin, async (admin) =>
      new GamificationHiEventsEvidenceService(createGamificationAccountingStore()).applyAdminReconciliation(
        { id: admin.id, name: admin.name, email: admin.email },
        snapshotFingerprint,
        operationId,
      ));
    return { success: true, data };
  } catch (error) {
    return { success: false, error: actionError(error) };
  }
};
