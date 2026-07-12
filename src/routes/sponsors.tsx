import { createResource, Show } from "solid-js";
import { HologramButton } from "~/components/HologramButton";
import {
  PartnersShowcase,
  PartnersShowcaseSkeleton,
} from "~/components/conference/PartnersShowcase";
import { fetchPublicPartnerGroups } from "~/lib/partners-public";
import { Layout } from "~/layouts/Layout";

export default function Sponsors() {
  const [partnerGroups] = createResource(fetchPublicPartnerGroups);

  return (
    <Layout
      title="Sponsors and Partners | WhatTheStack 2026"
      description="Meet the sponsors, organizers, media partners, supporters, and community partners behind WhatTheStack 2026."
    >
      <div class="w-full px-4 pt-8 md:pt-24 pb-20">
        <header class="max-w-6xl mx-auto mb-10 md:mb-14">
          <h1 class="font-star text-4xl md:text-6xl lg:text-7xl uppercase tracking-widest text-primary-300 leading-tight mb-8 fade-in">
            Sponsors and partners
          </h1>
          <div class="flex flex-col sm:flex-row gap-3 sm:items-center fade-in-delay-1">
            <HologramButton href="/partnerships" text="Partner with us" class="px-7 py-3" />
            <a href="mailto:what@wts.sh" class="link text-primary-200 font-black text-lg">
              {`>`} what@wts.sh
            </a>
          </div>
        </header>

        <Show when={partnerGroups()} fallback={<PartnersShowcaseSkeleton />}>
          <PartnersShowcase groups={partnerGroups() ?? []} variant="page" />
        </Show>
      </div>
    </Layout>
  );
}
