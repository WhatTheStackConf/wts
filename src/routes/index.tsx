import { createResource, For, Show } from "solid-js";
import { Layout } from "../layouts/Layout";
import { Hero } from "../components/Hero";
import {
  fetchPublicSpeakerTeaser,
  TEASER_SPEAKER_LIMIT,
} from "~/lib/speakers-public";
import { SpeakerCard } from "~/components/conference/SpeakerCard";
import {
  PartnersShowcase,
  PartnersShowcaseSkeleton,
} from "~/components/conference/PartnersShowcase";
import { fetchPublicPartnerGroups } from "~/lib/partners-public";
import { conferenceGuideContent } from "~/lib/conference-guide-content";

export default function Home() {
  const [speakers] = createResource(fetchPublicSpeakerTeaser);
  const [partnerGroups] = createResource(fetchPublicPartnerGroups);

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

        <section class="px-3 md:px-0 pt-4 md:pt-8 pb-12 md:pb-16 fade-in-delay-2">
          <header class="max-w-6xl mx-auto mb-6 md:mb-8 fade-in">
            <h2 class="font-star text-3xl md:text-4xl uppercase tracking-widest text-primary-500">
              Sponsors and partners
            </h2>
          </header>

          <Show when={partnerGroups()} fallback={<PartnersShowcaseSkeleton />}>
            <PartnersShowcase groups={partnerGroups() ?? []} variant="home" />
          </Show>

          <div class="mt-8 md:mt-10 flex justify-center fade-in-delay-3">
            <a href="/sponsors" class="link text-primary-200 font-black text-xl">
              {`>`} View sponsors and partners
            </a>
          </div>
        </section>

        <section class="w-full max-w-6xl mx-auto pt-8 md:pt-12 pb-24 px-3 md:px-0 fade-in-delay-3">
          <div class="border-y border-primary-500/40 py-10 md:py-14">
            <div class="grid gap-10 lg:grid-cols-[minmax(0,1.15fr)_minmax(18rem,0.85fr)] lg:gap-16">
              <div>
                <p class="mb-4 font-mono text-sm font-bold uppercase tracking-[0.18em] text-secondary-300">
                  Venue announced
                </p>
                <h2 class="max-w-3xl text-balance font-star text-4xl font-bold uppercase leading-tight text-primary-500 md:text-5xl">
                  We're taking over the {conferenceGuideContent.mainVenue.name}
                </h2>
                <p class="mt-6 max-w-2xl text-pretty text-lg font-light leading-relaxed text-dark-50">
                  One conference across three neighboring faculties in Skopje, built as a full campus experience with talks, workshops, an expo, games, food, coffee, and an outdoor after-party.
                </p>

                <div class="mt-8 flex flex-wrap gap-x-8 gap-y-3 border-t border-white/15 pt-6 text-lg font-black text-secondary-200">
                  <span>{conferenceGuideContent.mainVenue.spaces.outdoorStages} outdoor stages</span>
                  <span aria-hidden="true" class="hidden text-primary-500 sm:inline">//</span>
                  <span>{conferenceGuideContent.mainVenue.spaces.indoorStages} indoor stages</span>
                </div>
              </div>

              <div class="lg:border-l lg:border-white/15 lg:pl-10">
                <h3 class="mb-5 text-xl font-bold text-secondary-300">Across the campus</h3>
                <ul class="border-t border-white/15">
                  <For each={conferenceGuideContent.mainVenue.campuses}>
                    {(campus) => (
                      <li class="border-b border-white/15 py-4 text-base leading-snug text-dark-50">
                        {campus}
                      </li>
                    )}
                  </For>
                </ul>
                <h3 class="mb-3 mt-7 text-xl font-bold text-secondary-300">On site</h3>
                <ul class="flex flex-wrap gap-x-5 gap-y-2 text-sm text-dark-50">
                  <For each={conferenceGuideContent.mainVenue.spaces.amenities}>
                    {(amenity) => <li>{`>`} {amenity}</li>}
                  </For>
                </ul>
                <a
                  href="https://www.google.com/maps/search/?api=1&query=Technical+Campus+Skopje"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="link mt-8 inline-block text-lg font-black text-primary-200"
                >
                  {`>`} Open in Google Maps
                </a>
              </div>
            </div>
          </div>
        </section>
      </div>
    </Layout>
  );
}
