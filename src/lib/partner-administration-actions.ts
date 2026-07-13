import { requireAdmin } from "~/lib/server-auth";
import {
  PartnerAdministration,
  type PartnerDraftInput,
  type PartnerLogoPayload,
  type PartnerPatch,
} from "~/lib/partner-administration";
import { createPocketBasePartnerAdministrationStore } from "~/lib/partner-administration-store";

export type { PartnerDraftInput, PartnerLogoPayload, PartnerPatch };

function partnerAdministration(): PartnerAdministration {
  return new PartnerAdministration(createPocketBasePartnerAdministrationStore(), "human_admin");
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
    await requireAdmin();
    return { success: true as const, data: await partnerAdministration().listPartners() };
  } catch (error) {
    console.error("Admin fetch Partners failed", error);
    return actionFailure(error);
  }
};

export const adminCreatePartner = async (input: PartnerDraftInput) => {
  "use server";
  try {
    await requireAdmin();
    return await partnerAdministration().createDraft(input);
  } catch (error) {
    console.error("Admin create Partner failed", error);
    return actionFailure(error);
  }
};

export const adminUpdatePartner = async (
  id: string,
  expectedVersion: string,
  patch: PartnerPatch,
) => {
  "use server";
  try {
    await requireAdmin();
    return await partnerAdministration().updatePartner(id, expectedVersion, patch);
  } catch (error) {
    console.error("Admin update Partner failed", error);
    return actionFailure(error);
  }
};

export const adminSetPartnerPublished = async (
  id: string,
  expectedVersion: string,
  published: boolean,
) => {
  "use server";
  try {
    await requireAdmin();
    return await partnerAdministration().setPublication(id, expectedVersion, published);
  } catch (error) {
    console.error("Admin set Partner publication failed", error);
    return actionFailure(error);
  }
};

export const adminSetPartnerNoteApproval = async (
  id: string,
  expectedVersion: string,
  approved: boolean,
) => {
  "use server";
  try {
    await requireAdmin();
    return await partnerAdministration().setNoteApproval(id, expectedVersion, approved);
  } catch (error) {
    console.error("Admin set Partner Note approval failed", error);
    return actionFailure(error);
  }
};

export const adminDeletePartner = async (id: string, expectedVersion: string) => {
  "use server";
  try {
    await requireAdmin();
    return await partnerAdministration().deletePartner(id, expectedVersion);
  } catch (error) {
    console.error("Admin delete Partner failed", error);
    return actionFailure(error);
  }
};
