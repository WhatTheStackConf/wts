import { createResource, For, Show } from "solid-js";
import { Layout } from "~/layouts/Layout";
import { fetchPublishedSpeakers } from "~/lib/speakers-public";
import { SpeakerCard } from "~/components/conference/SpeakerCard";

export default function Speakers() {
  const [speakers] = createResource(() => fetchPublishedSpeakers());

  return (
    <Layout
      title="Speakers — WhatTheStack 2026"
      description="Meet the speakers at WhatTheStack 2026"
      ogSubtitle="Conference speakers"
    >
      <div class="w-full px-4 sm:px-6 relative pt-6 md:pt-24 pb-24">
        <div class="max-w-6xl mx-auto relative z-20">
          <header class="mb-12 md:mb-16 md:pl-2 fade-in">
            <h1 class="speaker-heading text-[clamp(2.5rem,8vw,4.5rem)] uppercase leading-none">
              Speakers
            </h1>
            <p class="mt-5 max-w-xl text-lg text-secondary-200/90 leading-relaxed fade-in-delay-1">
              The people bringing ideas to the stage in Skopje. Browse the programme roster.
            </p>
          </header>

          <Show
            when={!speakers.loading}
            fallback={
              <div class="flex justify-center py-24">
                <span class="loading loading-bars loading-lg text-primary-500" />
              </div>
            }
          >
            <Show
              when={(speakers()?.length ?? 0) > 0}
              fallback={
                <p class="text-secondary-400 text-lg fade-in-delay-2 md:pl-2">
                  Speaker announcements coming soon.
                </p>
              }
            >
              <ul class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 sm:gap-8 list-none p-0 m-0 fade-in-delay-2">
                <For each={speakers()}>
                  {(speaker) => (
                    <li class="min-w-0 h-full">
                      <SpeakerCard speaker={speaker} layout="grid" />
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </Show>
        </div>
      </div>
    </Layout>
  );
}
