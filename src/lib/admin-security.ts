// Re-export server auth functions from the canonical module.
// Kept for backward compatibility — new code should import from ~/lib/server-auth.
export { requireAdmin, requireAuth, requireReviewer } from "~/lib/server-auth";
