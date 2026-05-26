import { Show } from "solid-js";
import { clientOnly } from "@solidjs/start";
import { useRequireAdmin } from "~/lib/route-guards";

const AdminSpeakersHub = clientOnly(() => import("~/components/admin/AdminSpeakersHub"));

export default function AdminSpeakers() {
    const guard = useRequireAdmin();

    return (
        <Show when={guard.authorized()}>
            <AdminSpeakersHub />
        </Show>
    );
}
