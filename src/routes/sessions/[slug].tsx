import { useParams } from "@solidjs/router";
import { createResource, For, Show } from "solid-js";
import { Layout } from "~/layouts/Layout";
import { fetchSessionBySlug } from "~/lib/speakers-public";
import { SpeakerAvatar } from "~/components/conference/SpeakerAvatar";
import NotFound from "../[...404]";

function formatScheduleDate(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    weekday: "short",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function SessionDetail() {
  const params = useParams();
  const [session] = createResource(
    () => params.slug,
    (slug) => fetchSessionBySlug(slug),
  );

  const hasSchedule = () => {
    const s = session();
    return !!(s?.startsAt || s?.track || s?.room);
  };

  return (
    <Show
      when={!session.loading}
      fallback={
        <div class="flex justify-center py-32">
          <span class="loading loading-bars loading-lg text-primary-500"></span>
        </div>
      }
    >
      <Show when={session()} fallback={<NotFound />}>
        {(s) => (
          <Layout
            title={`${s().title} - WhatTheStack 2026`}
            description={`Session at WhatTheStack 2026`}
          >
          <div class="w-full px-4 sm:px-6 relative pt-6 md:pt-24 pb-24 speaker-page-bg">
            <div class="absolute inset-0 scanline z-10 pointer-events-none" />

            <div class="max-w-3xl mx-auto relative z-20">
                <a
                  href="/sessions"
                  class="text-sm text-primary-400 hover:text-primary-300 font-mono transition-colors fade-in"
                >
                  &larr; All sessions
                </a>

                <article class="speaker-card mt-8 p-6 sm:p-10 md:p-12 fade-in-delay-1">
                  <p class="speaker-kicker mb-2">Session</p>
                  <h1 class="speaker-heading text-[clamp(2rem,6vw,3.25rem)] uppercase leading-tight mb-2">
                    {s().title}
                  </h1>
                  <Show when={s().format}>
                    <p class="text-sm font-mono text-secondary-500 mb-6">{s().format}</p>
                  </Show>

                  <Show when={hasSchedule()}>
                    <div class="flex flex-wrap gap-4 mb-6 text-sm font-mono text-secondary-300">
                      <Show when={s().startsAt}>
                        <span>{formatScheduleDate(s().startsAt!)}</span>
                      </Show>
                      <Show when={s().track}>
                        <span>Track: {s().track}</span>
                      </Show>
                      <Show when={s().room}>
                        <span>Room: {s().room}</span>
                      </Show>
                    </div>
                  </Show>

                  <div
                    class="prose prose-invert max-w-none text-secondary-200 leading-relaxed"
                    innerHTML={s().abstract}
                  />

                  <div class="mt-10 pt-8 border-t border-white/10">
                    <h2 class="text-lg font-star text-primary-400 uppercase tracking-widest mb-4">
                      Speakers
                    </h2>
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <For each={s().speakers}>
                        {(speaker) => (
                          <a
                            href={`/speakers/${speaker.slug}`}
                            class="flex items-center gap-3 glass-panel p-4 rounded-xl hover:border-primary-500/40 transition-colors"
                          >
                            <SpeakerAvatar
                              name={speaker.displayName}
                              photoUrl={speaker.photoUrl}
                              size="sm"
                            />
                            <div>
                              <div class="font-bold text-white">{speaker.displayName}</div>
                              <Show when={speaker.affiliation}>
                                <div class="text-xs text-secondary-500">
                                  {speaker.affiliation}
                                </div>
                              </Show>
                            </div>
                          </a>
                        )}
                      </For>
                    </div>
                  </div>

                  <Show when={s().relatedSessions.length > 0}>
                    <div class="mt-10 pt-8 border-t border-white/10">
                      <h2 class="text-lg font-star text-primary-400 uppercase tracking-widest mb-4">
                        Related sessions
                      </h2>
                      <div class="space-y-3">
                        <For each={s().relatedSessions}>
                          {(related) => (
                            <a
                              href={`/sessions/${related.slug}`}
                              class="block glass-panel p-4 rounded-xl hover:border-primary-500/40 transition-colors"
                            >
                              <span class="font-bold text-white">{related.title}</span>
                              <Show when={related.format}>
                                <span class="text-sm text-secondary-500 ml-2 font-mono">
                                  {related.format}
                                </span>
                              </Show>
                            </a>
                          )}
                        </For>
                      </div>
                    </div>
                  </Show>
                </article>
              </div>
            </div>
          </Layout>
        )}
      </Show>
    </Show>
  );
}
