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
          <p class="font-mono text-sm uppercase tracking-[0.32em] text-accent-300 mb-5 fade-in">
            Sponsors + partners
          </p>
          <h1 class="font-star text-4xl md:text-6xl lg:text-7xl uppercase tracking-widest text-primary-300 leading-tight mb-6 fade-in-delay-1">
            The signal around WTS
          </h1>
          <div class="grid gap-6 lg:grid-cols-[1fr_auto] lg:items-end fade-in-delay-2">
            <p class="max-w-3xl text-dark-50 text-lg md:text-xl leading-relaxed">
              Every logo here maps to something concrete: stages, booths, coffee, communities, media reach, volunteer energy, and enough hallway-track gravity to make a one-day conference feel bigger than its schedule.
            </p>
            <div class="flex flex-col sm:flex-row lg:flex-col gap-3 sm:items-start">
              <HologramButton href="/partnerships" text="Partner with us" class="px-7 py-3" />
              <a href="mailto:what@wts.sh" class="link text-primary-200 font-black text-lg">
                {`>`} what@wts.sh
              </a>
            </div>
          </div>
        </header>

        <Show when={partnerGroups()} fallback={<PartnersShowcaseSkeleton />}>
          <PartnersShowcase groups={partnerGroups() ?? []} variant="page" />
        </Show>
      </div>
    </Layout>
  );
}
