import { createGamificationAccountingStore } from "~/lib/gamification-accounting-store";
import { runAuthenticatedGamificationOperation } from "~/lib/gamification-authorization";
import { MissionQuestionAdminService, type SaveMissionQuestionnaireInput } from "~/lib/mission-question-admin";
import { assertMissionUser } from "~/lib/mission-questions";
import { requireAdmin } from "~/lib/server-auth";

function service() {
  const pepper = process.env.GAMIFICATION_CODE_PEPPER;
  if (!pepper) throw new Error("Mission code configuration is unavailable.");
  return new MissionQuestionAdminService(createGamificationAccountingStore(), pepper);
}
export const adminListMissionQuestionnaires = async (expectedUserId: string) => {
  "use server";
  return runAuthenticatedGamificationOperation(requireAdmin, async user => { assertMissionUser(expectedUserId, user.id); return service().list(); });
};
export const adminReadMissionQuestionnaire = async (activityId: string, expectedUserId: string) => {
  "use server";
  return runAuthenticatedGamificationOperation(requireAdmin, async user => { assertMissionUser(expectedUserId, user.id); return service().read(activityId); });
};
export const adminSaveMissionQuestionnaire = async (input: SaveMissionQuestionnaireInput, expectedUserId: string) => {
  "use server";
  return runAuthenticatedGamificationOperation(requireAdmin, async user => { assertMissionUser(expectedUserId, user.id); return service().save(input, { id: user.id, role: "admin" }); });
};