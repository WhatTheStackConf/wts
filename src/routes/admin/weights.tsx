import { createEffect } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { clientOnly } from "@solidjs/web";
import { useRequireAdmin } from "~/lib/route-guards";

const AdminWeightsRedirect = () => {
    const guard = useRequireAdmin();
    const navigate = useNavigate();

    createEffect(
      () => guard.authorized(),
      (authorized) => {
        if (authorized) {
            navigate("/reviewer/weights", { replace: true });
        }
      },
    );

    return null;
};

export default clientOnly(async () => ({ default: AdminWeightsRedirect }), {
    lazy: true,
});
