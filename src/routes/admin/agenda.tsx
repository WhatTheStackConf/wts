import { Show } from "solid-js";
import { clientOnly } from "@solidjs/web";
import { useRequireAdmin } from "~/lib/route-guards";

const AdminAgendaHub = clientOnly(() => import("~/components/admin/AdminAgendaHub"));

export default function AdminAgenda() {
  const guard = useRequireAdmin();

  return (
    <Show when={guard.authorized()}>
      <AdminAgendaHub />
    </Show>
  );
}
