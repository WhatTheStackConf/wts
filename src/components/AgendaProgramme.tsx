import { createMemo, createSignal, For, Show } from "solid-js";
import type { PublicAgendaSession, PublicAgendaSlot, PublicEventProgramme } from "~/lib/programme-public";
import { SCHEDULE_TIME_ZONE } from "~/lib/programme";
import { SpeakerAvatar } from "~/components/conference/SpeakerAvatar";

const timeFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: SCHEDULE_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const dateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: SCHEDULE_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const endDayFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: SCHEDULE_TIME_ZONE,
  weekday: "short",
  month: "short",
  day: "numeric",
});
const linkClass = "underline decoration-white/30 underline-offset-4 hover:text-primary-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary-300";

function AgendaSpeakers(props: { speakers: PublicAgendaSession["speakers"]; label?: string }) {
  return (
    <Show when={props.speakers.length}>
      <ul class="mt-3 space-y-2 text-sm leading-snug text-secondary-100" aria-label={props.label || "Speakers"}>
        <For each={props.speakers}>
          {(speaker) => (
            <li>
              <a href={`/speakers/${speaker.slug}`} class={`flex min-h-11 items-center gap-2.5 ${linkClass}`}>
                <SpeakerAvatar name={speaker.name} photoUrl={speaker.photoUrl || null} size="xs" glow={false} decorative />
                <span class="min-w-0 [overflow-wrap:anywhere]">{speaker.name}</span>
              </a>
            </li>
          )}
        </For>
      </ul>
    </Show>
  );
}

function SlotContent(props: { slot: PublicAgendaSlot }) {
  return (
    <>
      <p class="font-mono text-xs leading-5 tabular-nums text-secondary-200">
        <time datetime={props.slot.startAt}>{timeFormatter.format(new Date(props.slot.startAt))}</time>
        {" – "}
        <time datetime={props.slot.endAt}>{timeFormatter.format(new Date(props.slot.endAt))}</time>
        <Show when={dateFormatter.format(new Date(props.slot.startAt)) !== dateFormatter.format(new Date(props.slot.endAt))}>
          <span class="block">Ends {endDayFormatter.format(new Date(props.slot.endAt))}</span>
        </Show>
      </p>
      <p class="mt-1 font-mono text-xs leading-5 text-secondary-200/80">
        {props.slot.track?.name || "Programme-wide"}
        <Show when={props.slot.session?.format}> · {props.slot.session?.format}</Show>
      </p>
      <h4 class="mt-2 text-base font-bold leading-snug text-white [overflow-wrap:anywhere]">
        <Show when={props.slot.session} fallback={props.slot.title || "Programme item"}>
          {(session) => <a href={`/sessions/${session().slug}`} class={linkClass}>{session().title}</a>}
        </Show>
      </h4>
      <Show when={props.slot.session?.speakers.length || props.slot.speakers?.length}>
        <AgendaSpeakers speakers={props.slot.session?.speakers || props.slot.speakers || []} />
      </Show>
      <Show when={props.slot.summary}>
        <p class="mt-2 max-w-3xl text-sm leading-relaxed text-secondary-100/85">{props.slot.summary}</p>
      </Show>
      <Show when={props.slot.locationLabel}>
        <p class="mt-2 font-mono text-xs leading-5 text-secondary-200/80">Location: {props.slot.locationLabel}</p>
      </Show>
    </>
  );
}

interface AgendaProgrammeProps {
  programme: PublicEventProgramme;
  id: string;
}

export function AgendaProgramme(props: AgendaProgrammeProps) {
  return (
    <Show when={props.programme.untimed} fallback={<TimedAgendaProgramme programme={props.programme} id={props.id} />}>
      {(untimed) => (
        <section aria-labelledby={props.id}>
          <header class="bg-black/15 px-5 py-5 md:px-8">
            <h3 id={props.id} class="text-xl font-bold text-white">{untimed().title || props.programme.event.name}</h3>
            <p class="mt-2 font-mono text-sm font-bold text-primary-300"><Show when={untimed().endTime} fallback={<Show when={untimed().startTime} fallback={<Show when={untimed().sessions.some((session) => session.schedule)} fallback="Starting time: TBA">Confirmed session times below</Show>}>{`Starting time: ${untimed().startTime}`}</Show>}>
                {untimed().startTime}–{untimed().endTime}
              </Show><Show when={untimed().startTime}> · Skopje time</Show></p>
            <Show when={untimed().locationLabel}><p class="mt-2 text-sm text-secondary-200">Location: {untimed().locationLabel}</p></Show>
            <p class="mt-3 max-w-3xl text-sm leading-relaxed text-secondary-100/85">{untimed().summary}</p>
            <Show when={untimed().speakers?.length}>
              <p class="mt-4 text-sm font-bold text-white">Announced speakers</p>
              <AgendaSpeakers speakers={untimed().speakers || []} label="Announced speakers" />
            </Show>
            <Show when={!untimed().speakers?.length && untimed().highlights?.length}>
              <ul class="mt-3 space-y-1 text-sm text-secondary-100" aria-label="Announced speakers">
                <For each={untimed().highlights}>{(name) => <li>{name}</li>}</For>
              </ul>
            </Show>
            <Show when={untimed().access}><p class="mt-3 text-sm text-secondary-200">{untimed().access}</p></Show>
            <Show when={untimed().cta}>
              {(cta) => <a href={cta().href} class={`mt-3 inline-flex min-h-11 items-center text-sm text-white ${linkClass}`}>{cta().label}</a>}
            </Show>
            <Show when={props.programme.event.destinationUrl && props.programme.event.destinationUrl !== untimed().cta?.href}>
              <a href={props.programme.event.destinationUrl} class={`mt-2 block w-fit py-3 text-sm text-secondary-200 ${linkClass}`}>Event details</a>
            </Show>
          </header>
          <div class="px-5 py-5 md:px-8">
            <Show when={untimed().sessions.length > 0} fallback={<p class="text-sm text-secondary-200">Session lineup: TBA</p>}>
              <p class="mb-4 text-sm text-secondary-200"><Show when={untimed().sessions.some((session) => session.schedule)} fallback="Confirmed sessions. Running order and session times: TBA.">
                Confirmed session starts below. Unannounced end times remain TBA.
              </Show></p>
              <ul class="grid gap-4 md:grid-cols-2" aria-label={`${props.programme.event.name} — sessions${untimed().sessions.some((session) => session.schedule) ? "" : ", times TBA"}`}>
                <For each={untimed().sessions}>
                  {(session) => (
                    <li class="min-w-0 rounded-lg border border-white/15 bg-dark-800 p-4">
                      <Show when={session.schedule}>
                        {(schedule) => <p class="mb-2 font-mono text-sm font-bold text-primary-300">
                          <time datetime={schedule().startAt}>{timeFormatter.format(new Date(schedule().startAt))}</time>
                          <Show when={schedule().endAt} fallback=" · End time TBA">
                            {(end) => <> – <time datetime={end()}>{timeFormatter.format(new Date(end()))}</time></>}
                          </Show>
                        </p>}
                      </Show>
                      <Show when={session.format}><p class="font-mono text-xs text-secondary-200">{session.format}</p></Show>
                      <h4 class="mt-2 text-base font-bold leading-snug text-white [overflow-wrap:anywhere]">
                        <a href={`/sessions/${session.slug}`} class={linkClass}>{session.title}</a>
                      </h4>
                      <AgendaSpeakers speakers={session.speakers} />
                    </li>
                  )}
                </For>
              </ul>
            </Show>
            <Show when={untimed().unassignedSpeakers?.length}>
              <ul class="mt-4 grid gap-4 md:grid-cols-2" role="list" aria-label={`${props.programme.event.name} — speakers, topics TBD`}>
                <For each={untimed().unassignedSpeakers}>
                  {(speaker) => (
                    <li class="min-w-0 rounded-lg border border-white/15 bg-dark-800 p-4">
                      <h4 class="text-base font-bold leading-snug text-white">Topic: TBD</h4>
                      <AgendaSpeakers speakers={[speaker]} />
                      <p class="mt-2 text-sm leading-relaxed text-secondary-200">Programme to be announced.</p>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </div>
        </section>
      )}
    </Show>
  );
}

function TimedAgendaProgramme(props: AgendaProgrammeProps) {
  const [selectedStage, setSelectedStage] = createSignal("");
  const tracks = createMemo(() => props.programme.tracks);
  const slots = createMemo(() => [...props.programme.slots].sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt)));
  const stage = createMemo(() => tracks().find((track) => track.key === selectedStage()) || tracks()[0]);
  const hasStageSlots = (key: string) => slots().some((slot) => slot.track?.key === key);
  const mobileSlots = createMemo(() => slots().filter((slot) => !slot.track || slot.track.key === stage()?.key));
  // Every actual boundary gets its own grid line: no rounding to 30/60-minute slots.
  // Rows may grow for long titles or larger text without clipping or breaking alignment.
  const boundaries = createMemo(() => [...new Set(slots().flatMap((slot) => [Date.parse(slot.startAt), Date.parse(slot.endAt)]))].sort((a, b) => a - b));
  const rowTemplate = createMemo(() => ["auto", ...boundaries().slice(1).map((end, index) => `minmax(${((end - boundaries()[index]) / 60000) * 0.4}rem, auto)`)].join(" "));
  const slotRow = (slot: PublicAgendaSlot) => `${boundaries().indexOf(Date.parse(slot.startAt)) + 2} / ${boundaries().indexOf(Date.parse(slot.endAt)) + 2}`;
  const slotColumn = (slot: PublicAgendaSlot) => slot.track ? `${tracks().findIndex((track) => track.key === slot.track?.key) + 2}` : "2 / -1";

  return (
    <section aria-labelledby={props.id}>
      <header class="bg-black/15 px-5 py-5 md:px-8">
        <h3 id={props.id} class="text-xl font-bold text-white">{props.programme.event.name}</h3>
        <Show when={props.programme.details}>
          {(details) => <>
            <p class="mt-3 max-w-3xl text-sm leading-relaxed text-secondary-100/85">{details().summary}</p>
            <Show when={details().access}><p class="mt-3 text-sm text-secondary-200">{details().access}</p></Show>
            <Show when={details().cta}>
              {(cta) => <a href={cta().href} class={`mt-3 inline-flex min-h-11 items-center text-sm text-white ${linkClass}`}>{cta().label}</a>}
            </Show>
            <Show when={details().unassignedSpeakers?.length}>
              <p class="mt-4 text-sm font-bold text-white">Additional announced speakers · times and topics TBD</p>
              <AgendaSpeakers speakers={details().unassignedSpeakers || []} label="Additional announced speakers" />
            </Show>
          </>}
        </Show>
        <Show when={tracks().length > 1}>
          <p class="mt-2 text-sm leading-relaxed text-secondary-100/85">Choose your stage, or compare parallel sessions on a larger screen. Programme-wide items are for everyone.</p>
        </Show>
      </header>
      <Show when={slots().length > 0} fallback={<p class="px-5 py-6 font-mono text-sm text-secondary-200 md:px-8">No sessions scheduled for this programme yet.</p>}>
        <div class="lg:hidden">
          <Show when={tracks().length > 0}>
            <div class="border-b border-white/10 px-5 py-4">
              <label for={`${props.id}-stage`} class="mb-2 block text-sm font-bold text-white">Choose a stage</label>
              <select
                id={`${props.id}-stage`}
                name="stage"
                class="select w-full min-h-12 border-white/25 bg-dark-800 text-base text-white focus-visible:outline-primary-300"
                value={stage()?.key || ""}
                onChange={(event) => setSelectedStage(event.currentTarget.value)}
                aria-controls={`${props.id}-mobile-slots`}
              >
                <For each={tracks()}>
                  {(track) => <option value={track.key}>{track.name}{hasStageSlots(track.key) ? "" : " · TBD"}</option>}
                </For>
              </select>
              <Show when={stage()?.locationLabel}><p class="mt-2 text-sm text-secondary-200">{stage()?.locationLabel}</p></Show>
              <p class="mt-2 text-sm leading-relaxed text-secondary-100/85">Includes all programme-wide opening, breaks and closing items.</p>
            </div>
          </Show>
          <div id={`${props.id}-mobile-slots`}>
            <div role="status" aria-live="polite" class="px-5 pt-4 text-sm text-secondary-200">
              <Show when={stage()}>{(track) => <p>{track().name}{hasStageSlots(track().key) ? " programme" : " · TBD — sessions to be announced. Programme-wide items are shown below."}</p>}</Show>
            </div>
            <ol class="divide-y divide-white/10" aria-label={`${props.programme.event.name} — ${stage()?.name || "programme-wide"}`}>
              <For each={mobileSlots()}>{(slot) => <li class="px-5 py-5"><SlotContent slot={slot} /></li>}</For>
            </ol>
          </div>
        </div>
        <div class="hidden lg:block">
          <p id={`${props.id}-grid-help`} class="px-5 pt-4 text-sm text-secondary-100/85 md:px-8">Read down for time, across for stages. Scroll sideways to see more stages if needed.</p>
          <div class="overflow-x-auto p-5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-300 md:px-8" role="region" aria-label={`${props.programme.event.name} stage timetable`} aria-describedby={`${props.id}-grid-help`} tabindex={0}>
            <div class="grid" style={{ "grid-template-columns": `4.5rem repeat(${Math.max(tracks().length, 1)}, minmax(12rem, 1fr))`, "grid-template-rows": rowTemplate() }}>
              <p class="pb-4 font-mono text-xs text-secondary-200" style={{ "grid-column": "1", "grid-row": "1" }}>Time</p>
              <Show when={tracks().length > 0} fallback={<p class="pb-4 font-bold text-white" style={{ "grid-column": "2", "grid-row": "1" }}>Programme</p>}>
                <For each={tracks()}>
                  {(track, index) => (
                    <div class="border-l border-white/10 px-3 pb-4" style={{ "grid-column": `${index() + 2}`, "grid-row": "1" }}>
                      <p class="font-bold text-white">{track.name}</p>
                      <Show when={track.locationLabel}><p class="mt-1 text-xs leading-5 text-secondary-200/80">{track.locationLabel}</p></Show>
                      <Show when={!hasStageSlots(track.key)}><p class="mt-2 text-sm text-secondary-200">TBD · Sessions to be announced</p></Show>
                    </div>
                  )}
                </For>
              </Show>
              <For each={boundaries()}>
                {(instant, index) => <p aria-hidden="true" class="border-t border-white/15 pt-2 font-mono text-xs tabular-nums text-secondary-200" style={{ "grid-row": `${index() + 2}`, "grid-column": "1" }}>{timeFormatter.format(new Date(instant))}</p>}
              </For>
              <ol class="contents" role="list" aria-label={`${props.programme.event.name} — all stages, chronological order`}>
                <For each={slots()}>
                  {(slot) => (
                    <li
                      class={`min-w-0 border border-white/15 p-3 ${slot.track ? "bg-dark-800" : "bg-secondary-900/20"}`}
                      style={{ "grid-row": slotRow(slot), "grid-column": slotColumn(slot) }}
                    >
                      <SlotContent slot={slot} />
                    </li>
                  )}
                </For>
              </ol>
            </div>
          </div>
        </div>
      </Show>
    </section>
  );
}
