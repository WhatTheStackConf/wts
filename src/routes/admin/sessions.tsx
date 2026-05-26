import { createEffect } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { useAuth } from "~/lib/auth-context";
import { clientOnly } from "@solidjs/start";

const AdminSessionsHub = clientOnly(() => import("~/components/admin/AdminSessionsHub"));

export default function AdminSessions() {
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

  return <AdminSessionsHub />;
}
