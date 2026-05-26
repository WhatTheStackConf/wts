import { Show } from "solid-js";
import { clientOnly } from "@solidjs/start";
import { useRequireAdmin } from "~/lib/route-guards";

const AdminUsersTable = clientOnly(() => import("~/components/admin/AdminUsersTable"));

export default function AdminUsers() {
    const guard = useRequireAdmin();

    return (
        <Show when={guard.authorized()}>
            <AdminUsersTable />
        </Show>
    );
}
