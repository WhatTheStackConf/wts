import { useParams } from "@solidjs/router";
import { createMemo, createResource, Show } from "solid-js";
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

  const pageTitle = createMemo(() => {
    const data = promo();
    if (data) return `${data.displayName} — Promo | WhatTheStack`;
    return "Speaker Promo | WhatTheStack";
  });

  const pageDescription = createMemo(() => {
    const data = promo();
    if (data) return `${data.displayName} is joining WhatTheStack 2026.`;
    return "Speaker at WhatTheStack 2026.";
  });

  const ogImage = createMemo(() => promo()?.photoUrl);
  const ogSubtitle = createMemo(() => promo()?.roleLine ?? "WhatTheStack 2026");

  return (
    <PromoLayout
      title={pageTitle()}
      description={pageDescription()}
      ogImage={ogImage()}
      ogSubtitle={ogSubtitle()}
    >
      <Show
        when={!promo.loading}
        fallback={
          <div class="flex justify-center py-24">
            <span class="loading loading-bars loading-lg text-primary-500" />
          </div>
        }
      >
        <Show when={promo()} fallback={<NotFound />}>
          {(data) => <SpeakerPromoPage promo={data()} />}
        </Show>
      </Show>
    </PromoLayout>
  );
}
