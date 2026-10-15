export interface MissionCatalogueItem {
  title: string;
  summary: string;
  category: string;
  state: "open" | "upcoming";
  opensAt?: string;
}

interface CatalogueMission {
  id: string;
  title: string;
  summary: string;
  category: string;
  status: string;
  visibility: string;
  starts_at?: string;
  ends_at?: string;
}
interface CatalogueActivity {
  id: string;
  mission?: string;
  status: string;
  enabled: boolean;
  active_from?: string;
  active_until?: string;
}
interface CatalogueCode {
  activity: string;
  status: string;
  enabled: boolean;
  starts_at?: string;
  ends_at?: string;
}

function instant(value: string | undefined, fallback: number): number {
  return value ? Date.parse(value) : fallback;
}

/** Public catalogue is a copy allowlist, never an evidence or question-key projection. */
export function buildMissionCatalogue(
  missions: CatalogueMission[],
  activities: CatalogueActivity[],
  codes: CatalogueCode[],
  now: string,
): MissionCatalogueItem[] {
  const time = Date.parse(now);
  if (!Number.isFinite(time)) throw new Error("A valid catalogue time is required.");
  return missions.filter((mission) => mission.status === "active" && mission.visibility === "public")
    .flatMap((mission): MissionCatalogueItem[] => {
      const starts: number[] = [];
      for (const activity of activities.filter((candidate) => candidate.mission === mission.id && candidate.status === "active" && candidate.enabled)) {
        for (const code of codes.filter((candidate) => candidate.activity === activity.id && candidate.status === "active" && candidate.enabled)) {
          const start = Math.max(instant(mission.starts_at, -Infinity), instant(activity.active_from, -Infinity), instant(code.starts_at, -Infinity));
          const end = Math.min(instant(mission.ends_at, Infinity), instant(activity.active_until, Infinity), instant(code.ends_at, Infinity));
          if (Number.isNaN(start) || Number.isNaN(end) || start >= end || end <= time) continue;
          starts.push(start);
        }
      }
      if (starts.length === 0) return [];
      const opensAt = Math.min(...starts);
      return [{
        title: mission.title,
        summary: mission.summary,
        category: mission.category,
        state: opensAt > time ? "upcoming" : "open",
        ...(Number.isFinite(opensAt) ? { opensAt: new Date(opensAt).toISOString() } : {}),
      }];
    }).sort((left, right) => left.title.localeCompare(right.title));
}
