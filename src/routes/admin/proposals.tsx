import { Show } from "solid-js";
import { clientOnly } from "@solidjs/start";
import { useRequireAdmin } from "~/lib/route-guards";

const AdminProposalsTable = clientOnly(() => import("~/components/admin/AdminProposalsTable"));

export default function AdminProposals() {
    const guard = useRequireAdmin();

    return (
        <Show when={guard.authorized()}>
            <AdminProposalsTable />
        </Show>
    );
}
