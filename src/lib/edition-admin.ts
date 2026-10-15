import { requireAdmin } from "~/lib/server-auth-core";

export function isApproved2027Admin(userId: string, role: string, approvedIds: string): boolean {
  if (role !== "admin") return false;
  return approvedIds.split(",").some((value) => value.trim() === userId && /^[a-zA-Z0-9]{15}$/.test(value.trim()));
}

export async function requireApproved2027Admin() {
  const user = await requireAdmin();
  if (!isApproved2027Admin(user.id, user.role, process.env.WTS_2027_ADMIN_USER_IDS || "")) {
    throw new Error("Unauthorized");
  }
  return user;
}
