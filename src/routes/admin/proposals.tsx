import { createEffect } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { useAuth } from "~/lib/auth-context";
import { clientOnly } from "@solidjs/start";

const AdminProposalsTable = clientOnly(() => import("~/components/admin/AdminProposalsTable"));

export default function AdminProposals() {
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

    return <AdminProposalsTable />;
}
