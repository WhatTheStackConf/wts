import { Show } from "solid-js";
import { clientOnly } from "@solidjs/start";
import { useRequireAdmin } from "~/lib/route-guards";

const AdminGamificationHub = clientOnly(() => import("~/components/admin/gamification/AdminGamificationHub"));

/** Navigation guard only; each admin server function separately calls requireAdmin(). */
export default function AdminGamification() {
  const guard = useRequireAdmin();
  return <Show when={guard.authorized()}><AdminGamificationHub /></Show>;
}
