import { getAdminPB } from "~/lib/pocketbase-admin-service";
import type { CrewRaffleRow } from "~/lib/crew-raffle";

interface RaffleProfile {
  user: string;
  ops_board_display_name: string;
  leaderboard_xp: number;
  unlocked_badge_count: number;
  expand?: { user?: { id: string; name: string; email: string; username: string; role: string } };
}

/** Read only scored profiles, including public opt-outs; never create/rebuild one. */
export async function loadCrewRaffleRows(): Promise<CrewRaffleRow[]> {
  const signal = AbortSignal.timeout(10_000);
  const pb = await getAdminPB().getInstance();
  signal.throwIfAborted();
  const rows: CrewRaffleRow[] = [];
  for (let page = 1; ; page++) {
    const result = await pb.collection("gamification_profiles").getList<RaffleProfile>(page, 200, {
      filter: "leaderboard_xp > 0",
      sort: "id",
      expand: "user",
      fields: "user,ops_board_display_name,leaderboard_xp,unlocked_badge_count,expand.user.id,expand.user.name,expand.user.email,expand.user.username,expand.user.role",
      signal,
    });
    if (result.totalItems > 5000 || page > 25) throw new Error("Raffle result limit exceeded");
    for (const profile of result.items) {
      const user = profile.expand?.user;
      if (!user || user.id !== profile.user) throw new Error("Missing account identity");
      rows.push({
        accountId: user.id, name: user.name || "", email: user.email || "", username: user.username || "",
        publicHandle: profile.ops_board_display_name || "", role: user.role || "user",
        xp: profile.leaderboard_xp, achievements: profile.unlocked_badge_count,
      });
    }
    if (page >= result.totalPages) break;
  }
  return rows;
}
