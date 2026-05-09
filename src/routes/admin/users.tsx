import { createEffect } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { useAuth } from "~/lib/auth-context";
import { clientOnly } from "@solidjs/start";

const AdminUsersTable = clientOnly(() => import("~/components/admin/AdminUsersTable"));

export default function AdminUsers() {
    const auth = useAuth();
    const navigate = useNavigate();

    createEffect(() => {
        if (auth.isLoading()) return;
        if (!auth.isAuthenticated()) {
            navigate("/login");
            return;
        }
        if (auth.user?.role !== "admin") {
            navigate("/");
        }
    });

    return <AdminUsersTable />;
}
