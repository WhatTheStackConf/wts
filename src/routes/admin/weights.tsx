import { createEffect } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { clientOnly } from "@solidjs/start";
import { useAuth } from "~/lib/auth-context";

const AdminWeightsRedirect = () => {
    const auth = useAuth();
    const navigate = useNavigate();

    createEffect(() => {
        if (auth.isLoading()) return;
        if (!auth.isAuthenticated()) {
            navigate("/login");
            return;
        }
        const role = auth.user?.role;
        if (role === "reviewer" || role === "admin") {
            navigate("/reviewer/weights", { replace: true });
            return;
        }
        navigate("/");
    });

    return null;
};

export default clientOnly(async () => ({ default: AdminWeightsRedirect }), {
    lazy: true,
});
