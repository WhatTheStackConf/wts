import { getAdminPB } from "~/lib/pocketbase-admin-service";
import { requireAuth } from "~/lib/server-auth";
import { sessionUser, type SessionUser } from "~/lib/session-policy";

export const updateMyProfile = async (input: { name: string }): Promise<SessionUser> => {
  "use server";
  const user = await requireAuth();
  const name = input.name.trim();
  if (!name || name.length > 150) throw new Error("Enter a valid name.");
  const updated = await getAdminPB().updateRecord("users", user.id, { name });
  return sessionUser(updated as unknown as Record<string, unknown>);
};
