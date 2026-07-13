import { requireAdmin } from "~/lib/server-auth";
import { AdminActions } from "~/lib/admin-action-ledger";
import { createPocketBaseAdminActionStore } from "~/lib/admin-action-store";
import {
  PartnerAdministration,
  type PartnerDraftInput,
  type PartnerLogoPayload,
  type PartnerPatch,
} from "~/lib/partner-administration";
import { createPocketBasePartnerAdministrationStore } from "~/lib/partner-administration-store";

export type { PartnerDraftInput, PartnerLogoPayload, PartnerPatch };

function partnerAdministration(userId: string): PartnerAdministration {
  return new PartnerAdministration(
    createPocketBasePartnerAdministrationStore(),
    { mode: "human_admin", userId, source: "admin_ui" },
    new AdminActions(createPocketBaseAdminActionStore()),
  );
}

function actionFailure(error: unknown) {
  return {
    success: false as const,
    code: "infrastructure" as const,
    error: error instanceof Error && error.message ? error.message : "Partner request failed.",
  };
}

export const adminFetchPartners = async () => {
  "use server";
  try {
    const user = await requireAdmin();
    const administration = partnerAdministration(user.id);
    const [partners, history] = await Promise.all([
      administration.listPartners(),
      administration.listHistory(),
    ]);
    return { success: true as const, data: { partners, history } };
  } catch (error) {
    console.error("Admin fetch Partners failed", error);
    return actionFailure(error);
  }
};

export const adminFetchPartnerHistory = async (targetId: string) => {
  "use server";
  try {
    const user = await requireAdmin();
    const id = targetId?.trim();
    if (!id || id.length > 128) return actionFailure(new Error("Choose a valid Partner."));
    return {
      success: true as const,
      data: await partnerAdministration(user.id).listHistory(id, 100),
    };
  } catch (error) {
    console.error("Admin fetch Partner history failed", error);
    return actionFailure(error);
  }
};

export const adminCreatePartner = async (operationId: string, input: PartnerDraftInput) => {
  "use server";
  try {
    const user = await requireAdmin();
    return await partnerAdministration(user.id).createDraft(input, operationId);
  } catch (error) {
    console.error("Admin create Partner failed", error);
    return actionFailure(error);
  }
};

export const adminUpdatePartner = async (
  operationId: string,
  id: string,
  expectedVersion: string,
  patch: PartnerPatch,
) => {
  "use server";
  try {
    const user = await requireAdmin();
    return await partnerAdministration(user.id).updatePartner(id, expectedVersion, patch, operationId);
  } catch (error) {
    console.error("Admin update Partner failed", error);
    return actionFailure(error);
  }
};

export const adminSetPartnerPublished = async (
  operationId: string,
  id: string,
  expectedVersion: string,
  published: boolean,
) => {
  "use server";
  try {
    const user = await requireAdmin();
    return await partnerAdministration(user.id).setPublication(id, expectedVersion, published, operationId);
  } catch (error) {
    console.error("Admin set Partner publication failed", error);
    return actionFailure(error);
  }
};

export const adminSetPartnerNoteApproval = async (
  operationId: string,
  id: string,
  expectedVersion: string,
  approved: boolean,
) => {
  "use server";
  try {
    const user = await requireAdmin();
    return await partnerAdministration(user.id).setNoteApproval(id, expectedVersion, approved, operationId);
  } catch (error) {
    console.error("Admin set Partner Note approval failed", error);
    return actionFailure(error);
  }
};

export const adminDeletePartner = async (
  operationId: string,
  id: string,
  expectedVersion: string,
) => {
  "use server";
  try {
    const user = await requireAdmin();
    return await partnerAdministration(user.id).deletePartner(id, expectedVersion, operationId);
  } catch (error) {
    console.error("Admin delete Partner failed", error);
    return actionFailure(error);
  }
};
