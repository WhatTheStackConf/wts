import { clientOnly } from "@solidjs/start";

const AdminProposalsTable = clientOnly(() => import("~/components/admin/AdminProposalsTable"));

export default function AdminProposals() {
    return <AdminProposalsTable />;
}
