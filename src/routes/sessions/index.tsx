import { createResource, For, Show } from "solid-js";
import { Layout } from "~/layouts/Layout";
import {
  fetchHasPublishedSessions,
  fetchPublishedSessions,
} from "~/lib/speakers-public";
import { SessionCard } from "~/components/conference/SessionCard";

export default function Sessions() {
  const [page] = createResource(async () => {
    const has = await fetchHasPublishedSessions();
    if (!has) return { kind: "coming-soon" as const };
    const sessions = await fetchPublishedSessions();
    return { kind: "list" as const, sessions };
  });

  const sessions = () => {
    const data = page();
    return data?.kind === "list" ? data.sessions : undefined;
  };

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
              Talk details, abstracts, and the people taking the stage in Skopje.
            </p>
          </header>

          <Show
            when={!page.loading}
            fallback={
              <div class="flex justify-center py-24">
                <span class="loading loading-bars loading-lg text-primary-500" />
              </div>
            }
          >
            <Show
              when={sessions()}
              fallback={
                <div class="md:pl-2 fade-in-delay-2">
                  <p class="text-2xl md:text-3xl font-star text-white/30 mb-4 tracking-wider uppercase">
                    Coming Soon
                  </p>
                  <p class="max-w-md text-secondary-300 text-lg leading-relaxed">
                    Session announcements will appear here as the programme locks in.
                  </p>
                </div>
              }
            >
              {(items) => (
                <ul class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 sm:gap-8 list-none p-0 m-0 fade-in-delay-2">
                  <For each={items()}>
                    {(session) => (
                      <li class="min-w-0 h-full">
                        <SessionCard session={session} />
                      </li>
                    )}
                  </For>
                </ul>
              )}
            </Show>
          </Show>
        </div>
      </div>
    </Layout>
  );
}
