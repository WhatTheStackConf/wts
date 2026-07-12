import { createGamificationAccountingStore } from "~/lib/gamification-accounting-store";
import { runAuthenticatedGamificationOperation } from "~/lib/gamification-authorization";
import {
  GamificationOperationsService,
  type AdminActivityDraftInput,
  type AdminAchievementDraftInput,
  type AdminCodeGenerationInput,
  type AdminCodeInvalidationInput,
  type AdminCodeLookupInput,
  type AdminCodeReissueInput,
  type AdminCommunityPartnerMissionDraftInput,
  type AdminConfiguredEventMissionDraftInput,
  type AdminEasterEggMissionDraftInput,
  type AdminLifecycleInput,
  type AdminMissionDraftInput,
  type AdminSessionAttendanceMissionDraftInput,
  type AdminScoreScheduleDraftInput,
  type GamificationDefinitionKind,
} from "~/lib/gamification-operations";
import { requireAdmin } from "~/lib/server-auth";

function actionError(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "Gamification administration failed.";
}

function codePepper(): string {
  const pepper = process.env.GAMIFICATION_CODE_PEPPER;
  if (!pepper) throw new Error("GAMIFICATION_CODE_PEPPER is required for Mission code operations.");
  return pepper;
}

async function withAdmin<T>(operation: (service: GamificationOperationsService, actor: { id: string; role: "admin" }) => Promise<T>) {
  return runAuthenticatedGamificationOperation(requireAdmin, async (admin) =>
    operation(new GamificationOperationsService(createGamificationAccountingStore(), codePepper()), { id: admin.id, role: "admin" }),
  );
}

async function withAdminRead<T>(operation: (service: GamificationOperationsService) => Promise<T>) {
  return runAuthenticatedGamificationOperation(requireAdmin, async () =>
    operation(new GamificationOperationsService(createGamificationAccountingStore(), codePepper())),
  );
}

export const adminFetchGamificationOperations = async () => {
  "use server";
  try {
    return { success: true, data: await withAdminRead((service) => service.operations()) };
  } catch (error) {
    return { success: false, error: actionError(error) };
  }
};

export const adminSaveGamificationAchievementDraft = async (input: AdminAchievementDraftInput) => {
  "use server";
  try {
    return { success: true, data: await withAdmin((service, actor) => service.saveAchievementDraft(input, actor)) };
  } catch (error) {
    return { success: false, error: actionError(error) };
  }
};

export const adminSaveGamificationMissionDraft = async (input: AdminMissionDraftInput) => {
  "use server";
  try {
    return { success: true, data: await withAdmin((service, actor) => service.saveMissionDraft(input, actor)) };
  } catch (error) {
    return { success: false, error: actionError(error) };
  }
};

export const adminSaveGamificationActivityDraft = async (input: AdminActivityDraftInput) => {
  "use server";
  try {
    return { success: true, data: await withAdmin((service, actor) => service.saveActivityDraft(input, actor)) };
  } catch (error) {
    return { success: false, error: actionError(error) };
  }
};

export const adminSaveSessionAttendanceMissionDraft = async (input: AdminSessionAttendanceMissionDraftInput) => {
  "use server";
  try {
    return { success: true, data: await withAdmin((service, actor) => service.saveSessionAttendanceMissionDraft(input, actor)) };
  } catch (error) {
    return { success: false, error: actionError(error) };
  }
};

export const adminSaveConfiguredEventMissionDraft = async (input: AdminConfiguredEventMissionDraftInput) => {
  "use server";
  try {
    return { success: true, data: await withAdmin((service, actor) => service.saveConfiguredEventMissionDraft(input, actor)) };
  } catch (error) {
    return { success: false, error: actionError(error) };
  }
};

export const adminSaveCommunityPartnerMissionDraft = async (input: AdminCommunityPartnerMissionDraftInput) => {
  "use server";
  try {
    return { success: true, data: await withAdmin((service, actor) => service.saveCommunityPartnerMissionDraft(input, actor)) };
  } catch (error) {
    return { success: false, error: actionError(error) };
  }
};

export const adminSaveEasterEggMissionDraft = async (input: AdminEasterEggMissionDraftInput) => {
  "use server";
  try {
    return { success: true, data: await withAdmin((service, actor) => service.saveEasterEggMissionDraft(input, actor)) };
  } catch (error) {
    return { success: false, error: actionError(error) };
  }
};

export const adminCreateGamificationScoreScheduleDraft = async (input: AdminScoreScheduleDraftInput) => {
  "use server";
  try {
    return { success: true, data: await withAdmin((service, actor) => service.createScoreScheduleDraft(input, actor)) };
  } catch (error) {
    return { success: false, error: actionError(error) };
  }
};

export const adminActivateGamificationDefinition = async (kind: GamificationDefinitionKind, input: AdminLifecycleInput) => {
  "use server";
  try {
    return { success: true, data: await withAdmin((service, actor) => service.activateDefinition(kind, input, actor)) };
  } catch (error) {
    return { success: false, error: actionError(error) };
  }
};

export const adminRetireGamificationDefinition = async (kind: GamificationDefinitionKind, input: AdminLifecycleInput) => {
  "use server";
  try {
    return { success: true, data: await withAdmin((service, actor) => service.retireDefinition(kind, input, actor)) };
  } catch (error) {
    return { success: false, error: actionError(error) };
  }
};

export const adminActivateGamificationScoreSchedule = async (scheduleId: string, input: AdminLifecycleInput) => {
  "use server";
  try {
    return { success: true, data: await withAdmin((service, actor) => service.activateScoreSchedule(scheduleId, input, actor)) };
  } catch (error) {
    return { success: false, error: actionError(error) };
  }
};

export const adminGenerateGamificationCodes = async (input: AdminCodeGenerationInput) => {
  "use server";
  try {
    return { success: true, data: await withAdmin((service, actor) => service.generateCodes(input, actor)) };
  } catch (error) {
    return { success: false, error: actionError(error) };
  }
};

export const adminLookupGamificationCodes = async (input: AdminCodeLookupInput) => {
  "use server";
  try {
    return { success: true, data: await withAdminRead((service) => service.lookupCodes(input)) };
  } catch (error) {
    return { success: false, error: actionError(error) };
  }
};

export const adminInvalidateGamificationCode = async (input: AdminCodeInvalidationInput) => {
  "use server";
  try {
    return { success: true, data: await withAdmin((service, actor) => service.invalidateCode(input, actor)) };
  } catch (error) {
    return { success: false, error: actionError(error) };
  }
};

export const adminReissueGamificationCode = async (input: AdminCodeReissueInput) => {
  "use server";
  try {
    return { success: true, data: await withAdmin((service, actor) => service.reissueCode(input, actor)) };
  } catch (error) {
    return { success: false, error: actionError(error) };
  }
};
