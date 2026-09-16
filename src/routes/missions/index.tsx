import { clientOnly } from "@solidjs/web";
import { Icon } from "~/components/Icon";
import { For, Show } from "solid-js";
import { createAsyncResource as createResource } from "~/lib/async-resource";
import { Layout } from "~/layouts/Layout";
import { getPublicMissionCatalogue } from "~/lib/mission-catalogue-actions";

const MissionCataloguePage = () => {
  const [missions, { refetch }] = createResource(getPublicMissionCatalogue);
  return <Layout title="Missions // WhatTheStack" description="Explore official WhatTheStack QR Missions and collect badges and XP">
    <div class="min-h-screen pt-24 pb-20">
      <div class="container mx-auto max-w-5xl px-4 sm:px-6">
        <header class="mb-8 max-w-3xl">
          <p class="font-mono text-xs uppercase tracking-[0.14em] text-primary-300">Official WTS activities</p>
          <h1 class="mt-2 text-4xl font-star text-white sm:text-5xl">MISSIONS</h1>
          <p class="mt-3 text-sm leading-relaxed text-secondary-200/80">Find an official Mission QR and scan it with your phone's camera. Sign in to save your progress. Some codes record a reward immediately; others open questions to complete first.</p>
          <p class="mt-3 text-sm leading-relaxed text-secondary-200/80">Rewards follow each activity's scoring limits. Not all XP counts towards the leaderboard. Hidden discoveries stay off this list.</p>
          <div class="mt-5 flex flex-wrap gap-3">
            <a href="/missions/redeem" class="btn btn-primary min-h-12 font-mono">Enter a code</a>
            <a href="/user/profile#gamification" class="btn btn-outline btn-secondary min-h-12 font-mono">My achievements</a>
          </div>
        </header>
        <Show when={!missions.loading} fallback={<div class="glass-panel flex min-h-48 items-center justify-center rounded-2xl border border-white/10" role="status"><span class="loading loading-bars loading-lg text-primary" aria-hidden="true" /><span class="ml-3 font-mono text-sm">Loading Missions...</span></div>}>
          <Show when={!missions.error} fallback={<div class="alert alert-error" role="alert"><span>Missions could not be loaded. Your saved progress is unchanged.</span><button type="button" class="btn btn-sm min-h-12" onClick={() => void refetch().catch(() => undefined)}>Try again</button></div>}>
          <Show when={(missions()?.length || 0) > 0} fallback={<div class="glass-panel rounded-2xl border border-dashed border-white/15 p-10 text-center"><h2 class="text-xl font-star text-white">No public Missions ready yet</h2><p class="mt-2 text-sm text-secondary-200/80">Missions appear here after organizers publish their activities and register their codes. Already found an official code? You can enter it above.</p></div>}>
            <ul class="grid gap-5 md:grid-cols-2" role="list">
              <For each={missions()}>{(mission) => <li class="glass-panel rounded-2xl border border-white/10 p-6">
                <div class="flex items-start justify-between gap-3"><div><p class="font-mono text-xs uppercase tracking-[0.12em] text-primary-300">{mission.category.replaceAll("_", " ")}</p><h2 class="mt-2 text-xl font-bold text-white">{mission.title}</h2></div><Icon icon="material-symbols:groups-outline" class="shrink-0 text-2xl text-primary-300" aria-hidden="true" /></div>
                <p class="mt-3 text-sm leading-relaxed text-secondary-200/80">{mission.summary}</p>
                <p class="mt-5 text-sm font-mono text-primary-200"><Show when={mission.state === "upcoming"} fallback="Find its official QR to take part.">Opens {new Date(mission.opensAt!).toLocaleString("en-GB", { timeZone: "Europe/Skopje", dateStyle: "medium", timeStyle: "short" })} (Skopje time).</Show></p>
              </li>}</For>
            </ul>
          </Show>
          </Show>
        </Show>
      </div>
    </div>
  </Layout>;
};

export default clientOnly(async () => ({ default: MissionCataloguePage }), { lazy: true });
