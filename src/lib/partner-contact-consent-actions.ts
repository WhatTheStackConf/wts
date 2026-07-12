import { createGamificationAccountingStore } from "~/lib/gamification-accounting-store";
import { runAuthenticatedGamificationOperation } from "~/lib/gamification-authorization";
import { PartnerContactConsentService } from "~/lib/partner-contact-consent";
import { requireAdmin, requireAuth } from "~/lib/server-auth";

export const getMyPartnerContactConsentSummaries = async () => {
  "use server";
  return runAuthenticatedGamificationOperation(requireAuth, async (user) =>
    new PartnerContactConsentService(createGamificationAccountingStore()).summariesForUser(user.id));
};

export const grantMyPartnerContactConsent = async (activityId: string) => {
  "use server";
  return runAuthenticatedGamificationOperation(requireAuth, async (user) =>
    new PartnerContactConsentService(createGamificationAccountingStore()).grant(
      { id: user.id, name: user.name, email: user.email },
      activityId,
    ));
};

export const withdrawMyPartnerContactConsent = async (consentId: string) => {
  "use server";
  return runAuthenticatedGamificationOperation(requireAuth, async (user) =>
    new PartnerContactConsentService(createGamificationAccountingStore()).withdraw(user.id, consentId));
};

/** Deliberately not exposed to partners or a bulk export surface. */
export const adminHandoffPartnerContactConsent = async (input: { consentId: string; confirmation: boolean }) => {
  "use server";
  if (!input.confirmation) throw new Error("Partner contact handoff requires confirmation.");
  if (!input.consentId.trim()) throw new Error("A partner contact consent ID is required.");
  return runAuthenticatedGamificationOperation(requireAdmin, async (admin) =>
    new PartnerContactConsentService(createGamificationAccountingStore()).handoff(input.consentId.trim(), admin.id));
};
