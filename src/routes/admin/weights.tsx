import { createEffect } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { clientOnly } from "@solidjs/start";
import { useRequireAdmin } from "~/lib/route-guards";

const AdminWeightsRedirect = () => {
    const guard = useRequireAdmin();
    const navigate = useNavigate();

    createEffect(() => {
        if (guard.authorized()) {
            navigate("/reviewer/weights", { replace: true });
        }
    });

    return null;
};

export default clientOnly(async () => ({ default: AdminWeightsRedirect }), {
    lazy: true,
});
