import { createResource, For, Show } from "solid-js";
import { Layout } from "~/layouts/Layout";
import { fetchPublicAgenda, type PublicAgendaSlot } from "~/lib/speakers-public";
import { conferenceLocation } from "~/lib/conference-guide-content";
import { SCHEDULE_TIME_ZONE } from "~/lib/programme";

const TIME_ZONE = SCHEDULE_TIME_ZONE;

function formatDay(localDate: string): string {
  return new Date(`${localDate}T12:00:00.000Z`).toLocaleDateString("en-US", {
    timeZone: TIME_ZONE,
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function formatTime(instant: string): string {
  return new Date(instant).toLocaleTimeString("en-US", {
    timeZone: TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
  });
}

function localDateKey(instant: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(instant));
}

function formatEndDay(instant: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(instant));
}

function formatKind(kind: PublicAgendaSlot["kind"]): string {
  return kind.charAt(0).toUpperCase() + kind.slice(1).replaceAll("_", " ");
}

function agendaTitle(slot: PublicAgendaSlot): string {
  return slot.session?.title || slot.title || "Programme item";
}

export default function Agenda() {
  const [agenda, { refetch }] = createResource(fetchPublicAgenda);

  return (
    <Layout
      title="Agenda | WhatTheStack 2026"
      description="The WhatTheStack 2026 conference programme in Skopje."
    >
      <div class="w-full px-4 pb-20 pt-24 md:pt-32">
        <div class="mx-auto max-w-5xl">
          <header class="mb-10 max-w-3xl">
            <p class="speaker-kicker mb-3">WhatTheStack 2026</p>
            <h1 class="font-star text-4xl font-bold text-secondary-300 md:text-6xl">Agenda</h1>
            <p class="mt-4 font-mono text-sm leading-relaxed text-secondary-200/75">
              All times are local to {conferenceLocation}.
            </p>
          </header>

          <Show
            when={!agenda.loading}
            fallback={
              <div class="flex justify-center py-24">
                <span class="loading loading-bars loading-lg text-primary-500" aria-label="Loading agenda" />
              </div>
            }
          >
            <Show when={!agenda.error} fallback={
              <div class="alert alert-error flex-col items-start sm:flex-row sm:items-center sm:justify-between" role="alert">
                <span>The public agenda could not be loaded. Draft or partial programme data is not being shown.</span>
                <button type="button" class="btn btn-sm btn-outline min-h-11 font-mono" onClick={() => void refetch()}>Try again</button>
              </div>
            }>
              <Show
                when={(agenda()?.days.length || 0) > 0}
              fallback={
                <section class="glass-panel rounded-2xl p-8 text-center md:p-12">
                  <h2 class="text-xl font-bold text-white">Agenda coming soon</h2>
                  <p class="mx-auto mt-3 max-w-xl text-sm font-mono leading-relaxed text-secondary-200/70">
                    The programme will appear here once its Conference Days and Slots are published.
                  </p>
                </section>
              }
            >
              <div class="space-y-10">
                <For each={agenda()?.days || []}>
                  {(day) => (
                    <section class="glass-panel overflow-hidden rounded-2xl border border-white/10" aria-labelledby={`agenda-day-${day.key}`}>
                      <header class="border-b border-white/10 bg-secondary-900/15 px-5 py-5 md:px-8">
                        <p class="font-mono text-xs uppercase tracking-[0.14em] text-secondary-400">{formatDay(day.localDate)}</p>
                        <h2 id={`agenda-day-${day.key}`} class="mt-1 text-2xl font-bold text-white md:text-3xl">{day.title}</h2>
                      </header>
                      <Show
                        when={day.slots.length > 0}
                        fallback={<p class="px-5 py-6 font-mono text-sm text-secondary-200/65 md:px-8">Programme details coming soon.</p>}
                      >
                        <ol class="divide-y divide-white/10" aria-label={`${day.title} programme`}>
                          <For each={day.slots}>
                            {(slot) => (
                              <li class="grid gap-3 px-5 py-5 sm:grid-cols-[9rem_minmax(0,1fr)] md:px-8">
                                <p class="font-mono text-sm text-secondary-300">
                                  <time datetime={slot.startAt}>{formatTime(slot.startAt)}</time> -{" "}
                                  <time datetime={slot.endAt}>{formatTime(slot.endAt)}</time>
                                  <Show when={localDateKey(slot.startAt) !== localDateKey(slot.endAt)}>
                                    <span class="block text-xs text-secondary-200/75">Ends {formatEndDay(slot.endAt)}</span>
                                  </Show>
                                </p>
                                <div class="min-w-0">
                                  <div class="flex flex-wrap items-center gap-2">
                                    <Show
                                      when={slot.session}
                                      fallback={<h3 class="text-lg font-bold text-white">{agendaTitle(slot)}</h3>}
                                    >
                                      {(session) => (
                                        <a href={`/sessions/${session().slug}`} class="text-lg font-bold text-white transition-colors hover:text-primary-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-primary-300">
                                          {session().title}
                                        </a>
                                      )}
                                    </Show>
                                    <span class="badge border-secondary-500/40 bg-secondary-500/10 font-mono text-xs text-secondary-200">
                                      {slot.track?.name || "All attendees"}
                                    </span>
                                    <Show when={!slot.session}>
                                      <span class="badge badge-ghost font-mono text-xs">{formatKind(slot.kind)}</span>
                                    </Show>
                                  </div>
                                  <Show when={slot.session?.format}>
                                    <p class="mt-1 font-mono text-xs text-secondary-400">{slot.session?.format}</p>
                                  </Show>
                                  <Show when={slot.summary}>
                                    <p class="mt-2 max-w-3xl text-sm leading-relaxed text-secondary-100/75">{slot.summary}</p>
                                  </Show>
                                  <Show when={slot.locationLabel}>
                                    <p class="mt-2 font-mono text-xs text-secondary-300/75">Location: {slot.locationLabel}</p>
                                  </Show>
                                </div>
                              </li>
                            )}
                          </For>
                        </ol>
                      </Show>
                    </section>
                  )}
                </For>
                </div>
              </Show>
            </Show>
          </Show>
        </div>
      </div>
    </Layout>
  );
}
