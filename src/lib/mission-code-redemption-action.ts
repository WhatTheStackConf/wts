import { getRequestEvent } from "@solidjs/web";
import { createGamificationAccountingStore } from "~/lib/gamification-accounting-store";
import { runAuthenticatedGamificationOperation } from "~/lib/gamification-authorization";
import {
  DatabaseMissionCodeRateLimiter,
  MissionCodeRedemptionService,
} from "~/lib/mission-code-redemption";
import { hashMissionRequestFingerprint } from "~/lib/mission-code-crypto";
import { requireAuth } from "~/lib/server-auth";
import { assertMissionUser } from "~/lib/mission-questions";

function missionCodePepper(): string {
  const pepper = process.env.GAMIFICATION_CODE_PEPPER;
  if (!pepper) throw new Error("GAMIFICATION_CODE_PEPPER is required for Mission code operations.");
  return pepper;
}

function serverRequestFingerprint(pepper: string): string {
  const event = getRequestEvent();
  const forwardedFor = event?.request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "";
  const userAgent = event?.request.headers.get("user-agent") || "";
  return hashMissionRequestFingerprint(`${forwardedFor}\n${userAgent}`, pepper);
}

/** Redeems a bearer code for the authenticated User only; all other award inputs are server-derived. */
export const redeemMissionCode = async (rawCode: string, source: string, expectedUserId: string) => {
  "use server";
  return runAuthenticatedGamificationOperation(requireAuth, async (user) => {
    assertMissionUser(expectedUserId, user.id);
    const pepper = missionCodePepper();
    const store = createGamificationAccountingStore();
    const redemption = new MissionCodeRedemptionService(
      store,
      pepper,
      { rateLimiter: new DatabaseMissionCodeRateLimiter(store) },
    );
    return redemption.redeem({
      user: { id: user.id, name: user.name, email: user.email },
      rawCode,
      sourceHint: source,
      requestFingerprint: serverRequestFingerprint(pepper),
    });
  });
};

export const submitMissionAnswers = async (input: { challengeId: string; operationId: string; answers: Record<string, string> }, expectedUserId: string) => {
  "use server";
  return runAuthenticatedGamificationOperation(requireAuth, async (user) => {
    assertMissionUser(expectedUserId, user.id);
    const pepper = missionCodePepper();
    const store = createGamificationAccountingStore();
    return new MissionCodeRedemptionService(store, pepper, { rateLimiter: new DatabaseMissionCodeRateLimiter(store) }).submitAnswers({
      user: { id: user.id, name: user.name, email: user.email }, challengeId: input.challengeId, operationId: input.operationId, answers: input.answers,
      requestFingerprint: serverRequestFingerprint(pepper),
    });
  });
};
