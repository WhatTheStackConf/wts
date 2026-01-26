import { clientOnly } from "@solidjs/start";

const AdminUsersTable = clientOnly(() => import("~/components/admin/AdminUsersTable"));

export default function AdminUsers() {
    return <AdminUsersTable />;
}
