import { Show } from "solid-js";
import { clientOnly } from "@solidjs/start";
import { useRequireAdmin } from "~/lib/route-guards";

const AdminSessionsHub = clientOnly(() => import("~/components/admin/AdminSessionsHub"));

export default function AdminSessions() {
    const guard = useRequireAdmin();

    return (
        <Show when={guard.authorized()}>
            <AdminSessionsHub />
        </Show>
    );
}
