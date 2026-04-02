import { Layout } from "~/layouts/Layout";
import { createResource, For, Show } from "solid-js";
import { getAdminPB } from "~/lib/pocketbase-admin-service";

interface TimelineEvent {
  id: string;
  title: string;
  description: string;
  icon: string;
  event_date: string;
  link_url: string;
  link_text: string;
  is_published: boolean;
}

const fetchTimeline = async (): Promise<TimelineEvent[]> => {
  "use server";
  const adminService = getAdminPB();
  const records = await adminService.fetchAllRecords("timeline_events", {
    filter: "is_published = true",
    sort: "event_date",
  });
  return records as unknown as TimelineEvent[];
};

function isPast(dateStr: string) {
  return new Date(dateStr) < new Date();
}

function isNext(events: TimelineEvent[]) {
  const now = new Date();
  for (let i = 0; i < events.length; i++) {
    if (new Date(events[i].event_date) >= now) return i;
  }
  return -1;
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export default function Timeline() {
  const [events] = createResource(fetchTimeline);

  return (
    <Layout
      title="Timeline - WhatTheStack 2026"
      description="Key dates and milestones for WhatTheStack 2026"
      ogSubtitle="Key dates and milestones"
    >
      <div class="w-full px-4 relative">
        <div class="absolute inset-0 scanline z-10 pointer-events-none"></div>
        <div class="max-w-3xl mx-auto relative z-20">
          <h1 class="text-4xl md:text-5xl font-star font-bold text-transparent bg-clip-text bg-gradient-to-r from-primary-500 to-secondary-300 mb-4 text-center neon-glow fade-in uppercase tracking-widest">
            Timeline
          </h1>
          <p class="text-center text-secondary-300 mb-16 fade-in-delay-1">
            From announcement to conference day — here's what's happening and when.
          </p>

          <Show
            when={!events.loading}
            fallback={
              <div class="flex justify-center py-20">
                <span class="loading loading-bars loading-lg text-primary-500"></span>
              </div>
            }
          >
            <Show when={events()}>
              {(eventList) => {
                const nextIdx = isNext(eventList());
                return (
                  <div class="relative fade-in-delay-2 ml-6 md:ml-10">
                    {/* Vertical line */}
                    <div class="absolute left-0 top-2 bottom-2 w-px bg-gradient-to-b from-primary-500/50 via-accent-500/30 to-primary-500/50"></div>

                    <For each={eventList()}>
                      {(event, i) => {
                        const past = isPast(event.event_date);
                        const isCurrentNext = i() === nextIdx;

                        return (
                          <div
                            class={`relative pb-10 last:pb-0 transition-opacity ${past && !isCurrentNext ? "opacity-50" : ""}`}
                          >
                            {/* Node dot */}
                            <div
                              class={`absolute -left-[7px] w-[14px] h-[14px] rounded-full border-2 top-6 z-10 ${
                                isCurrentNext
                                  ? "border-primary-400 bg-primary-500 shadow-[0_0_12px_rgba(255,0,255,0.6)] animate-pulse"
                                  : past
                                    ? "border-primary-700 bg-primary-900"
                                    : "border-accent-500/50 bg-accent-900/50"
                              }`}
                            ></div>

                            {/* "You are here" marker */}
                            <Show when={isCurrentNext}>
                              <div class="ml-6 pb-1 text-[10px] font-star text-primary-400 uppercase tracking-[0.2em]">
                                &gt; You are here
                              </div>
                            </Show>

                            {/* Content card */}
                            <div
                              class={`ml-6 bg-base-200/50 backdrop-blur-sm border rounded-xl p-5 ${
                                isCurrentNext
                                  ? "border-primary-500/40 shadow-[0_0_20px_rgba(255,0,255,0.15)]"
                                  : "border-white/5"
                              }`}
                            >
                              <div class="flex items-start gap-3">
                                <span class="text-2xl leading-none mt-0.5">{event.icon}</span>
                                <div class="flex-1 min-w-0">
                                  <div class="text-xs font-mono text-accent-400 mb-1">
                                    {formatDate(event.event_date)}
                                  </div>
                                  <h3 class="text-lg font-star text-white uppercase tracking-wider">
                                    {event.title}
                                  </h3>
                                </div>
                              </div>
                              <p class="text-secondary-300 text-sm leading-relaxed mt-3">
                                {event.description}
                              </p>
                              <Show when={event.link_url && event.link_text}>
                                <a
                                  href={event.link_url}
                                  class="inline-block mt-3 text-sm font-bold text-primary-400 hover:text-primary-300 transition-colors"
                                >
                                  {`>`} {event.link_text}
                                </a>
                              </Show>
                            </div>
                          </div>
                        );
                      }}
                    </For>
                  </div>
                );
              }}
            </Show>
          </Show>
        </div>
      </div>
    </Layout>
  );
}
