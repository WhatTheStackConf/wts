import { Show } from "solid-js";
import { useSearchParams } from "@solidjs/router";
import { createAsyncResource as createResource } from "~/lib/async-resource";
import { Layout } from "~/layouts/Layout";
import { fetchPublicAgenda } from "~/lib/speakers-public";
import { conferenceLocation } from "~/lib/conference-guide-content";
import { SCHEDULE_TIME_ZONE } from "~/lib/programme";
import { AgendaDays } from "~/components/AgendaDays";

export default function Agenda() {
  const [agenda, controls] = createResource(fetchPublicAgenda);
  const [searchParams, setSearchParams] = useSearchParams();

  return (
    <Layout
      title="Agenda | WhatTheStack 2026"
      description="The WhatTheStack 2026 conference programme in Skopje."
    >
      <div class="w-full px-4 pb-20 pt-24 md:pt-32">
        <div class="mx-auto max-w-[90rem]">
          <header class="mb-10 max-w-3xl">
            <p class="speaker-kicker mb-3">WhatTheStack 2026</p>
            <h1 class="font-star text-4xl font-bold text-secondary-300 md:text-6xl">Agenda</h1>
            <p class="mt-4 font-mono text-sm leading-relaxed text-secondary-200/85">
              All times are local to {conferenceLocation} ({SCHEDULE_TIME_ZONE}), in 24-hour format.
            </p>
          </header>

          <Show
            when={!agenda.loading}
            fallback={
              <div class="flex justify-center py-24" role="status">
                <span class="loading loading-bars loading-lg text-primary-500" aria-label="Loading agenda" />
              </div>
            }
          >
            <Show when={!agenda.error} fallback={
              <div class="alert alert-error flex-col items-start sm:flex-row sm:items-center sm:justify-between" role="alert">
                <span>We couldn't load the agenda. Try again in a moment.</span>
                <button type="button" class="btn btn-sm btn-outline min-h-11 font-mono" onClick={() => void controls.refetch()}>Try again</button>
              </div>
            }>
              <Show
                when={(agenda()?.days.length || 0) > 0}
                fallback={
                  <section class="glass-panel rounded-2xl p-8 text-center md:p-12">
                    <h2 class="text-xl font-bold text-white">Agenda not published yet</h2>
                    <p class="mx-auto mt-3 max-w-xl text-sm font-mono leading-relaxed text-secondary-200/85">
                      We'll add times, rooms, and sessions here once they're final.
                    </p>
                  </section>
                }
              >
                <AgendaDays days={agenda()?.days || []} selectedDay={searchParams.day}
                  onSelect={(day) => setSearchParams({ day }, { replace: false })} />
              </Show>
            </Show>
          </Show>
        </div>
      </div>
    </Layout>
  );
}
