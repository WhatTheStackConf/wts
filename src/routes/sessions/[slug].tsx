import { useParams } from "@solidjs/router";
import { createEffect, createMemo, createResource, For, Show } from "solid-js";
import { Layout } from "~/layouts/Layout";
import { fetchSessionBySlug } from "~/lib/speakers-public";
import { SpeakerAvatar } from "~/components/conference/SpeakerAvatar";
import { proseArticleClasses } from "~/components/MDXContent";
import { sanitizeHtml } from "~/lib/sanitize-html";
import NotFound from "../[...404]";

function formatScheduleDate(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    timeZone: "Europe/Skopje",
    weekday: "short",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatScheduleEnd(iso: string) {
  return new Date(iso).toLocaleTimeString("en-US", {
    timeZone: "Europe/Skopje",
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

  const pageTitle = createMemo(() => {
    const data = session();
    if (data) return `${data.title} — WhatTheStack 2026`;
    return "Session — WhatTheStack 2026";
  });

  const pageDescription = createMemo(() => {
    const data = session();
    if (data?.format) return `${data.format} at WhatTheStack 2026`;
    return "Session at WhatTheStack 2026";
  });

  const hasSchedule = () => {
    const s = session();
    return Boolean(s?.schedule);
  };

  createEffect(() => {
    if (session()) document.title = pageTitle();
  });

  return (
    <Show
      when={!session.loading}
      fallback={
        <Layout title={pageTitle()} description={pageDescription()}>
          <div class="w-full px-4 relative pt-4 md:pt-12 pb-20">
            <div class="flex justify-center py-24">
              <span class="loading loading-bars loading-lg text-primary-500" aria-label="Loading session" />
            </div>
          </div>
        </Layout>
      }
    >
      <Show when={session()} fallback={<NotFound />}>
        {(s) => (
          <Layout
            title={`${s().title} — WhatTheStack 2026`}
            description={pageDescription()}
            ogSubtitle={s().format || "Conference session"}
          >
            <div class="w-full h-full px-4 relative pt-4 md:pt-12 pb-20">
              <div class="max-w-4xl mx-auto relative z-20">
                <article class="glass-panel p-6 md:p-12 rounded-2xl fade-in-delay-1 relative z-30">
                  <header class="mb-8 md:mb-10">
                    <p class="speaker-kicker mb-3">Session</p>
                    <h1 class="font-star text-3xl md:text-4xl lg:text-5xl font-bold text-secondary-400 leading-tight text-balance">
                      {s().title}
                    </h1>
                    <Show when={s().format}>
                      <p class="speaker-session-chip mt-5 w-fit">{s().format}</p>
                    </Show>

                    <Show when={hasSchedule()}>
                      <ul class="mt-6 flex flex-wrap gap-3 list-none p-0 m-0 text-sm font-mono text-secondary-300">
                        <li class="inline-flex items-center gap-2 rounded-full border border-secondary-500/25 bg-secondary-600/10 px-3 py-1.5">
                          <span class="text-secondary-500">Time</span>
                          <span>
                            <time datetime={s().schedule!.startAt}>{formatScheduleDate(s().schedule!.startAt)}</time> -{" "}
                            <time datetime={s().schedule!.endAt}>{formatScheduleEnd(s().schedule!.endAt)}</time>
                          </span>
                        </li>
                        <li class="inline-flex items-center gap-2 rounded-full border border-secondary-500/25 bg-secondary-600/10 px-3 py-1.5">
                          <span class="text-secondary-500">Audience</span>
                          <span>{s().schedule?.trackName || "All attendees"}</span>
                        </li>
                        <Show when={s().schedule?.locationLabel}>
                          <li class="inline-flex items-center gap-2 rounded-full border border-secondary-500/25 bg-secondary-600/10 px-3 py-1.5">
                            <span class="text-secondary-500">Location</span>
                            <span>{s().schedule?.locationLabel}</span>
                          </li>
                        </Show>
                      </ul>
                    </Show>
                  </header>

                  <Show
                    when={s().abstract}
                    fallback={
                      <p class="text-primary-200/60 italic">
                        Abstract coming soon.
                      </p>
                    }
                  >
                    {(abstract) => (
                      <div
                        class={proseArticleClasses}
                        innerHTML={sanitizeHtml(abstract())}
                      />
                    )}
                  </Show>

                  <section class="mt-10 pt-8 border-t border-white/10">
                    <h2 class="text-xl md:text-2xl font-bold text-white mb-6">
                      Speakers
                    </h2>
                    <Show
                      when={s().speakers.length > 0}
                      fallback={
                        <p class="text-primary-200/60 italic">
                          Speaker details coming soon.
                        </p>
                      }
                    >
                      <ul class="grid grid-cols-1 sm:grid-cols-2 gap-4 list-none p-0 m-0">
                        <For each={s().speakers}>
                          {(speaker) => (
                            <li>
                              <a
                                href={`/speakers/${speaker.slug}`}
                                class="flex items-center gap-4 glass-panel p-4 md:p-5 rounded-2xl hover:border-primary-500/50 transition-all duration-300 group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400/60"
                              >
                                <SpeakerAvatar
                                  name={speaker.displayName}
                                  photoUrl={speaker.photoUrl}
                                  size="sm"
                                />
                                <span class="min-w-0">
                                  <span class="block font-bold text-white group-hover:text-primary-400 transition-colors truncate">
                                    {speaker.displayName}
                                  </span>
                                  <Show when={speaker.affiliation}>
                                    <span class="block text-xs text-secondary-500 truncate">
                                      {speaker.affiliation}
                                    </span>
                                  </Show>
                                </span>
                              </a>
                            </li>
                          )}
                        </For>
                      </ul>
                    </Show>
                  </section>

                  <Show when={s().relatedSessions.length > 0}>
                    <section class="mt-10 pt-8 border-t border-white/10">
                      <h2 class="text-xl md:text-2xl font-bold text-white mb-6">
                        Related sessions
                      </h2>
                      <ul class="space-y-4 list-none p-0 m-0">
                        <For each={s().relatedSessions}>
                          {(related) => (
                            <li>
                              <a
                                href={`/sessions/${related.slug}`}
                                class="block glass-panel p-6 md:p-8 rounded-2xl hover:border-primary-500/50 transition-all duration-300 group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400/60"
                              >
                                <h3 class="text-lg md:text-xl font-bold text-white group-hover:text-primary-400 transition-colors">
                                  {related.title}
                                </h3>
                                <Show when={related.format}>
                                  <p class="text-sm text-secondary-500 font-mono mt-2">
                                    {related.format}
                                  </p>
                                </Show>
                              </a>
                            </li>
                          )}
                        </For>
                      </ul>
                    </section>
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
