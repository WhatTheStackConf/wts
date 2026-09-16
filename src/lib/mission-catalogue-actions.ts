import { createGamificationAccountingStore } from "~/lib/gamification-accounting-store";
import { GAMIFICATION_COLLECTIONS } from "~/lib/gamification-accounting";
import { buildMissionCatalogue, type MissionCatalogueItem } from "~/lib/mission-catalogue";
import type { GamificationMissionRecord, GamificationActivityRecord, GamificationCodeRecord } from "~/lib/pocketbase-types";

export async function getPublicMissionCatalogue(): Promise<MissionCatalogueItem[]> {
  "use server";
  const store = createGamificationAccountingStore();
  const [missions, activities, codes] = await Promise.all([
    store.list<GamificationMissionRecord>(GAMIFICATION_COLLECTIONS.missions, { status: "active", visibility: "public" }, { limit: 2001, fields: "id,title,summary,category,status,visibility,starts_at,ends_at" }),
    store.list<GamificationActivityRecord>(GAMIFICATION_COLLECTIONS.activities, { status: "active", enabled: true }, { limit: 2001, fields: "id,mission,status,enabled,active_from,active_until" }),
    store.list<GamificationCodeRecord>(GAMIFICATION_COLLECTIONS.codes, { status: "active", enabled: true }, { limit: 10001, fields: "activity,status,enabled,starts_at,ends_at" }),
  ]);
  if (missions.length > 2000 || activities.length > 2000 || codes.length > 10000) throw new Error("The Mission catalogue is temporarily unavailable.");
  return buildMissionCatalogue(missions, activities, codes, new Date().toISOString());
}
