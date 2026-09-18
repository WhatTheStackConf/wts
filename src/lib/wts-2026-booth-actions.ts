import { createGamificationAccountingStore } from "~/lib/gamification-accounting-store";
import { runAuthenticatedGamificationOperation } from "~/lib/gamification-authorization";
import { assertMissionUser } from "~/lib/mission-questions";
import { requireAdmin } from "~/lib/server-auth";
import { WTS_2026_BOOTH_ACHIEVEMENTS } from "~/lib/wts-2026-booth-achievements";
import { prepareBoothAchievements, type BoothSetupInput } from "~/lib/wts-2026-booth-setup";

export async function adminReadBoothAchievementCatalogue(expectedUserId: string) {
  "use server";
  return runAuthenticatedGamificationOperation(requireAdmin, async user => {
    assertMissionUser(expectedUserId, user.id);
    return WTS_2026_BOOTH_ACHIEVEMENTS.map(entry => ({ ...entry, choices: [...entry.choices] }));
  });
}
export async function adminPrepareBoothAchievements(input: BoothSetupInput, expectedUserId: string) {
  "use server";
  return runAuthenticatedGamificationOperation(requireAdmin, async user => {
    assertMissionUser(expectedUserId, user.id);
    const pepper = process.env.GAMIFICATION_CODE_PEPPER;
    if (!pepper) throw new Error("Mission code configuration is unavailable.");
    return prepareBoothAchievements(createGamificationAccountingStore(), pepper, input, { id: user.id, role: "admin" });
  });
}
