import { Show } from "solid-js";
import { Layout } from "~/layouts/Layout";
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

    return (
      <Layout title="Reviewer weights" description="Reviewer scoring weights">
        <Show when={guard.authorized()}>
          <p role="status">Opening reviewer weights…</p>
        </Show>
      </Layout>
    );
};

export default clientOnly(async () => ({ default: AdminWeightsRedirect }), {
    lazy: true,
});
