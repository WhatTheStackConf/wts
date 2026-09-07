import { createMemo, For, Show } from "solid-js";
import { AgendaProgramme } from "~/components/AgendaProgramme";
import { conferenceGuideContent } from "~/lib/conference-guide-content";
import type { PublicAgendaDay } from "~/lib/programme-public";
import { SCHEDULE_TIME_ZONE } from "~/lib/programme";

interface AgendaDaysProps {
  days: PublicAgendaDay[];
  selectedDay?: string | string[];
  onSelect: (day: string) => void;
}

const mainDay = conferenceGuideContent.event.date.localDate;
const dayFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: SCHEDULE_TIME_ZONE, weekday: "long", month: "long", day: "numeric",
});
const pickerFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: SCHEDULE_TIME_ZONE, weekday: "short", day: "numeric", month: "short",
});

/** Invalid/unavailable URLs fall back to the main day, or the first available day. */
export function resolveAgendaDay(days: PublicAgendaDay[], requested?: string | string[]): string {
  if (requested === "all") return "all";
  if (typeof requested === "string" && days.some((day) => day.localDate === requested)) return requested;
  return days.find((day) => day.localDate === mainDay)?.localDate || days[0]?.localDate || "";
}

function dayLabel(day: PublicAgendaDay): string {
  const label = pickerFormatter.format(new Date(`${day.localDate}T12:00:00Z`));
  return day.localDate === mainDay ? `${label} · Main day` : label;
}

export function AgendaDays(props: AgendaDaysProps) {
  const selected = createMemo(() => resolveAgendaDay(props.days, props.selectedDay));
  const visibleDays = createMemo(() => selected() === "all" ? props.days : props.days.filter((day) => day.localDate === selected()));
  const choices = createMemo(() => [
    ...props.days.map((day) => ({ value: day.localDate, label: dayLabel(day) })),
    { value: "all", label: "Full week agenda" },
  ]);

  return (
    <>
      <div class="mb-6">
        <div class="sm:hidden">
          <label for="agenda-day-picker" class="mb-2 block text-sm font-bold text-white">Choose a day</label>
          <select id="agenda-day-picker" name="day" value={selected()} onChange={(event) => props.onSelect(event.currentTarget.value)}
            class="select min-h-12 w-full border-white/25 bg-dark-800 text-base text-white focus-visible:outline-primary-300" aria-controls="agenda-days">
            <For each={choices()}>{(choice) => <option value={choice.value}>{choice.label}</option>}</For>
          </select>
        </div>
        <nav aria-label="Agenda day" class="hidden flex-wrap gap-2 sm:flex">
          <For each={choices()}>
            {(choice) => (
              <a href={`/agenda?day=${choice.value}`} aria-current={selected() === choice.value ? "page" : undefined}
                class={`inline-flex min-h-11 items-center rounded-lg border px-4 py-2 text-sm font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary-300 ${selected() === choice.value ? "border-primary-400 bg-primary-500/20 text-white" : "border-white/20 text-secondary-200 hover:border-primary-400 hover:text-white"}`}>
                {choice.label}
              </a>
            )}
          </For>
        </nav>
        <p role="status" aria-live="polite" class="mt-3 text-sm text-secondary-200">
          {selected() === "all" ? "Full week agenda" : visibleDays()[0]?.title}
        </p>
      </div>
      <div id="agenda-days" class="space-y-10">
        <For each={visibleDays()}>
          {(day) => (
            <section class="glass-panel overflow-hidden rounded-2xl border border-white/10" aria-labelledby={`agenda-day-${day.key}`}>
              <header class="border-b border-white/10 bg-secondary-900/15 px-5 py-5 md:px-8">
                <p class="font-mono text-sm text-secondary-200">{dayFormatter.format(new Date(`${day.localDate}T12:00:00Z`))}</p>
                <h2 id={`agenda-day-${day.key}`} class="mt-1 text-2xl font-bold text-white md:text-3xl">{day.title}</h2>
              </header>
              <Show when={day.programmes.length > 0} fallback={<p class="px-5 py-6 font-mono text-sm text-secondary-200 md:px-8">No sessions scheduled for this day yet.</p>}>
                <div class="divide-y divide-white/10">
                  <For each={day.programmes}>
                    {(programme, index) => <AgendaProgramme programme={programme} id={`agenda-programme-${day.key}-${index()}`} />}
                  </For>
                </div>
              </Show>
            </section>
          )}
        </For>
      </div>
    </>
  );
}
