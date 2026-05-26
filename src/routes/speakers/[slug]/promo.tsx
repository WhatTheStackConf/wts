import { useParams } from "@solidjs/router";
import { createResource, Show } from "solid-js";
import { PromoLayout } from "~/layouts/PromoLayout";
import { SpeakerPromoPage } from "~/components/conference/SpeakerPromoPage";
import { fetchSpeakerPromoBySlug } from "~/lib/speakers-public";
import NotFound from "../../[...404]";

export default function SpeakerPromoRoute() {
  const params = useParams();
  const [promo] = createResource(
    () => params.slug,
    (slug) => fetchSpeakerPromoBySlug(slug),
  );

  return (
    <Show
      when={!promo.loading}
      fallback={
        <PromoLayout title="Loading…">
          <div class="flex justify-center py-24">
            <span class="loading loading-bars loading-lg text-primary-500" />
          </div>
        </PromoLayout>
      }
    >
      <Show when={promo()} fallback={<NotFound />}>
        {(data) => (
          <PromoLayout
            title={`${data().displayName} — WhatTheStack`}
            description={`${data().displayName} is joining WhatTheStack 2026.`}
          >
            <SpeakerPromoPage promo={data()} />
          </PromoLayout>
        )}
      </Show>
    </Show>
  );
}
