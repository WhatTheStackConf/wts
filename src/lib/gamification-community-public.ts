import { createGamificationAccountingStore } from "~/lib/gamification-accounting-store";
import { GAMIFICATION_COLLECTIONS } from "~/lib/gamification-accounting";
import {
  buildCommunityPartnerMissionPresentations,
  type CommunityPartnerMissionPresentation,
} from "~/lib/gamification-community-partners";
import type {
  GamificationAchievementRecord,
  GamificationActivityRecord,
  GamificationMissionRecord,
} from "~/lib/pocketbase-types";

/** Public read with an explicit allowlist; partner relations and operations data never cross this boundary. */
export const getPublicCommunityPartnerMissions = async (): Promise<CommunityPartnerMissionPresentation[]> => {
  "use server";
  const store = createGamificationAccountingStore();
  const [missions, activities, achievements] = await Promise.all([
    store.list<GamificationMissionRecord>(GAMIFICATION_COLLECTIONS.missions),
    store.list<GamificationActivityRecord>(GAMIFICATION_COLLECTIONS.activities),
    store.list<GamificationAchievementRecord>(GAMIFICATION_COLLECTIONS.achievements),
  ]);
  return buildCommunityPartnerMissionPresentations({ missions, activities, achievements });
};
