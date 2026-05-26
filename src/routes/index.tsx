import { createResource, For, Show } from "solid-js";
import { Layout } from "../layouts/Layout";
import { Hero } from "../components/Hero";
import {
  fetchPublicSpeakerTeaser,
  TEASER_SPEAKER_LIMIT,
} from "~/lib/speakers-public";
import { SpeakerCard } from "~/components/conference/SpeakerCard";

export default function Home() {
  const [speakers] = createResource(fetchPublicSpeakerTeaser);

  return (
    <Layout
      title="WhatTheStack 2026"
      description="Refracting the boundaries between reality and the machine."
    >
      <div class="relative">
        <Hero />

        <Show when={(speakers()?.preview.length ?? 0) > 0}>
          <section class="px-3 md:px-0 pt-16 md:pt-20 pb-12 md:pb-16 fade-in-delay-2">
            <header class="mb-10 md:mb-12 fade-in">
              <h2 class="font-star text-3xl md:text-4xl uppercase tracking-widest text-primary-500 mb-4">
                Speakers
              </h2>
              <p class="max-w-md text-dark-50 text-lg font-light leading-relaxed">
                Meet some of the voices joining us at WTS 2026
              </p>
            </header>

            <ul class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-8 list-none p-0 m-0 fade-in-delay-2">
              <For each={speakers()?.preview}>
                {(speaker) => (
                  <li class="min-w-0 h-full">
                    <SpeakerCard speaker={speaker} layout="grid" />
                  </li>
                )}
              </For>
            </ul>

            <div class="mt-10 md:mt-12 flex flex-col items-center gap-3 text-center fade-in-delay-3">
              <Show when={(speakers()?.total ?? 0) < TEASER_SPEAKER_LIMIT}>
                <p class="text-secondary-400 font-mono text-sm m-0">
                  More speakers announced soon.
                </p>
              </Show>
              <a
                href="/speakers"
                class="link text-primary-200 font-black text-xl"
              >
                {`>`}{" "}
                {(speakers()?.total ?? 0) > TEASER_SPEAKER_LIMIT
                  ? "View all speakers"
                  : "View full speakers lineup"}
              </a>
            </div>
          </section>
        </Show>

        <section class="max-w-6xl mx-auto pt-8 md:pt-12 pb-24 px-6">
          <div class="glass-panel p-12 rounded-3xl grid-scan fade-in-delay-3">
            <h2 class="text-3xl font-star text-primary-500 mb-6 uppercase tracking-widest">
              More info coming soon!
            </h2>
            <div class="text-lg text-secondary-200 font-light leading-relaxed max-w-3xl">
              Meanwhile:
              <ul class="flex flex-col gap-4 pt-4 text-xl font-black">
                <li>
                  <a href="/tickets" class="link  text-primary-200">
                    {`>`} Grab a ticket
                  </a>
                </li>
                <li>
                  <a href="/cfp/01-intro" class="link  text-primary-200">
                    {`>`} Apply to speak
                  </a>
                </li>
                <li>
                  <a href="/partnerships" class="link  text-primary-200">
                    {`>`} Partner with us
                  </a>
                </li>
                <li>
                  <a
                    href="https://www.youtube.com/@WhatTheStackConference"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="link  text-primary-200"
                  >
                    {`>`} Watch previous year's talks
                  </a>
                </li>
              </ul>
            </div>
          </div>
        </section>
      </div>
    </Layout>
  );
}
