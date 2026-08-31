import { For, Show } from "solid-js";
import { createAsyncResource as createResource } from "~/lib/async-resource";
import { Layout } from "~/layouts/Layout";
import { fetchPublishedSessions } from "~/lib/speakers-public";
import { SessionCard } from "~/components/conference/SessionCard";

export default function Sessions() {
  const [sessions, { refetch }] = createResource(fetchPublishedSessions);

  return (
    <Layout
      title="Sessions — WhatTheStack 2026"
      description="Conference sessions at WhatTheStack 2026"
      ogSubtitle="Conference sessions"
    >
      <div class="w-full px-4 sm:px-6 relative pt-6 md:pt-24 pb-24">
        <div class="max-w-6xl mx-auto relative z-20">
          <header class="mb-12 md:mb-16 md:pl-2 fade-in">
            <h1 class="speaker-heading text-[clamp(2.5rem,8vw,4.5rem)] uppercase leading-none">
              Sessions
            </h1>
            <p class="mt-5 max-w-xl text-lg text-secondary-200/90 leading-relaxed fade-in-delay-1">
              The timetable lives on the agenda page. This one is for browsing talk abstracts and speakers.
            </p>
          </header>

          <Show
             when={!sessions.loading}
            fallback={
              <div class="flex justify-center py-24">
                 <span class="loading loading-bars loading-lg text-primary-500" aria-label="Loading sessions" />
              </div>
            }
          >
            <Show when={!sessions.error} fallback={
              <div class="alert alert-error flex-col items-start sm:flex-row sm:items-center sm:justify-between" role="alert">
                <span>We couldn't load the sessions. Try again in a moment.</span>
                <button type="button" class="btn btn-sm btn-outline min-h-11 font-mono" onClick={() => void refetch()}>Try again</button>
              </div>
            }>
              <Show
              when={(sessions()?.length || 0) > 0}
              fallback={
                <div class="md:pl-2 fade-in-delay-2">
                  <p class="text-2xl md:text-3xl font-star text-white/30 mb-4 tracking-wider uppercase">
                    No sessions announced yet
                  </p>
                  <p class="max-w-md text-secondary-300 text-lg leading-relaxed">
                    We'll add each talk here once it's confirmed.
                  </p>
                </div>
              }
            >
              <ul class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 sm:gap-8 list-none p-0 m-0 fade-in-delay-2">
                  <For each={sessions()}>
                    {(session) => (
                      <li class="min-w-0 h-full">
                        <SessionCard session={session} />
                      </li>
                    )}
                  </For>
              </ul>
              </Show>
            </Show>
          </Show>
        </div>
      </div>
    </Layout>
  );
}
