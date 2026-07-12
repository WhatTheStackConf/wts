import { clientOnly } from "@solidjs/start";
import { Icon } from "@iconify-icon/solid";
import { createResource, For, Show } from "solid-js";
import { Layout } from "~/layouts/Layout";
import { getPublicCommunityPartnerMissions } from "~/lib/gamification-community-public";

const CommunityMissionsPage = () => {
  const [missions] = createResource(getPublicCommunityPartnerMissions);
  return <Layout title="Community Missions // WhatTheStack" description="Organizer-approved WhatTheStack Community Partner Missions">
    <div class="min-h-screen pt-24 pb-20">
      <div class="container mx-auto max-w-5xl px-4 sm:px-6">
        <header class="mb-8 max-w-3xl">
          <p class="font-mono text-xs uppercase tracking-[0.14em] text-primary-300">WTS-managed evidence only</p>
          <h1 class="mt-2 text-4xl font-star text-white sm:text-5xl">COMMUNITY MISSIONS</h1>
          <p class="mt-3 text-sm leading-relaxed text-secondary-200/80">These organizer-approved programmes use WTS Mission codes. External community links, forms, clicks, screenshots, and assertions do not record progress.</p>
        </header>
        <Show when={!missions.loading} fallback={<div class="glass-panel flex min-h-48 items-center justify-center rounded-2xl border border-white/10" role="status"><span class="loading loading-bars loading-lg text-primary" aria-hidden="true" /><span class="ml-3 font-mono text-sm">Loading Community Missions...</span></div>}>
          <Show when={!missions.error && (missions()?.length || 0) > 0} fallback={<div class="glass-panel rounded-2xl border border-dashed border-white/15 p-10 text-center"><h2 class="text-xl font-star text-white">No public Community Missions yet</h2><p class="mt-2 text-sm text-secondary-200/80">Approved programmes will appear here when organizers publish them.</p></div>}>
            <ul class="grid gap-5 md:grid-cols-2" role="list">
              <For each={missions()}>{(mission) => <li class="glass-panel rounded-2xl border border-white/10 p-6">
                <div class="flex items-start justify-between gap-3"><div><p class="font-mono text-xs uppercase tracking-[0.12em] text-primary-300">Community Partner Activity</p><h2 class="mt-2 text-xl font-bold text-white">{mission.title}</h2></div><Icon icon="material-symbols:groups-outline" class="text-2xl text-primary-300" aria-hidden="true" /></div>
                <p class="mt-3 text-sm leading-relaxed text-secondary-200/80">{mission.summary}</p>
                <Show when={mission.badge}>{(badge) => <div class="mt-5 rounded-xl border border-primary-400/20 bg-primary-500/10 p-4"><p class="font-mono text-xs uppercase tracking-[0.1em] text-primary-200">Badge teaser</p><p class="mt-2 font-bold text-white">{badge().name}</p><p class="mt-1 text-sm text-secondary-200/80">{badge().description}</p></div>}</Show>
              </li>}</For>
            </ul>
          </Show>
        </Show>
      </div>
    </div>
  </Layout>;
};

export default clientOnly(async () => ({ default: CommunityMissionsPage }), { lazy: true });
