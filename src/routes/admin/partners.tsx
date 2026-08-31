import { Show } from "solid-js";
import { clientOnly } from "@solidjs/web";
import { useRequireAdmin } from "~/lib/route-guards";

const AdminPartnersHub = clientOnly(() => import("~/components/admin/AdminPartnersHub"));

export default function AdminPartners() {
  const guard = useRequireAdmin();

  return <Show when={guard.authorized()}><AdminPartnersHub /></Show>;
}
