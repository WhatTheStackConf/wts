import { Show } from "solid-js";
import { clientOnly } from "@solidjs/start";
import { useRequireAdmin } from "~/lib/route-guards";

const AdminMcpTokensHub = clientOnly(() => import("~/components/admin/AdminMcpTokensHub"));

export default function AdminMcpTokens() {
  const guard = useRequireAdmin();

  return (
    <Show when={guard.authorized()}>
      <AdminMcpTokensHub />
    </Show>
  );
}
