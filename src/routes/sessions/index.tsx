import { createResource, For, Show } from "solid-js";
import { Layout } from "~/layouts/Layout";
import { ComingSoon } from "~/components/ComingSoon";
import {
  fetchHasPublishedSessions,
  fetchPublishedSessions,
} from "~/lib/speakers-public";

export default function Sessions() {
  const [page] = createResource(async () => {
    const has = await fetchHasPublishedSessions();
    if (!has) return { kind: "coming-soon" as const };
    const sessions = await fetchPublishedSessions();
    return { kind: "list" as const, sessions };
  });

  return (
    <Show
      when={!page.loading && page()?.kind === "list"}
      fallback={
        <Show
          when={!page.loading}
          fallback={
            <div class="flex justify-center py-32">
              <span class="loading loading-bars loading-lg text-primary-500"></span>
            </div>
          }
        >
          <ComingSoon
            title="Sessions"
            subtitle="Talk details, abstracts, and speaker bios, all in one place. Soon."
          />
        </Show>
      }
    >
      {(data) => (
        <Layout
          title="Sessions — WhatTheStack 2026"
          description="Conference sessions at WhatTheStack 2026"
          ogSubtitle="Conference sessions"
        >
          <div class="w-full px-4 sm:px-6 relative pt-6 md:pt-24 pb-24 speaker-page-bg">
            <div class="absolute inset-0 scanline z-10 pointer-events-none" />
            <div class="absolute inset-0 speaker-grid-texture z-[5] pointer-events-none" />

            <div class="max-w-4xl mx-auto relative z-20">
              <header class="mb-12 md:mb-16 fade-in">
                <h1 class="speaker-heading text-[clamp(2.5rem,8vw,4.5rem)] uppercase leading-none">
                  Sessions
                </h1>
                <p class="mt-5 max-w-xl text-lg text-secondary-200/90 leading-relaxed fade-in-delay-1">
                  Talks on the WhatTheStack 2026 programme.
                </p>
              </header>

              <div class="space-y-6 fade-in-delay-2">
                <For each={data().sessions}>
                  {(session) => (
                    <a
                      href={`/sessions/${session.slug}`}
                      class="block glass-panel p-6 md:p-8 rounded-2xl hover:border-primary-500/50 transition-all duration-300 group"
                    >
                      <h2 class="text-xl md:text-2xl font-bold text-white group-hover:text-primary-400 transition-colors">
                        {session.title}
                      </h2>
                      <Show when={session.format}>
                        <p class="text-sm text-secondary-500 font-mono mt-2">
                          {session.format}
                        </p>
                      </Show>
                    </a>
                  )}
                </For>
              </div>
            </div>
          </div>
        </Layout>
      )}
    </Show>
  );
}
