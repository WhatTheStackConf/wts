import { createMemo, createResource, createSignal, For, Show } from "solid-js";
import { Icon } from "@iconify-icon/solid";
import {
  AdminDataPanel,
  AdminFormField,
  AdminFormSection,
  AdminPageShell,
  adminFormPanelClass,
  adminInputClass,
  adminSelectClass,
  adminTextareaClass,
  useAdminToast,
} from "~/components/admin/AdminPageShell";
import {
  adminCreateAgendaSlot,
  adminCreateAgendaTrack,
  adminCreateConferenceDay,
  adminFetchProgramme,
  adminSetAgendaSlotPublished,
  adminSetConferenceDayPublished,
  adminUpdateAgendaSlot,
  adminUpdateAgendaTrack,
  adminUpdateConferenceDay,
  type AdminAgendaSlotInput,
  type AdminProgrammeData,
} from "~/lib/programme-admin-actions";
import {
  AGENDA_SLOT_KINDS,
  SCHEDULE_TIME_ZONE,
  scheduleLocalDateTimeToInstant,
  type AgendaSlotKind,
  type ProgrammeDayRef,
  type ProgrammeSlotRef,
  type ProgrammeTrackRef,
} from "~/lib/programme";

function localDateTimeInput(instant?: string): string {
  if (!instant || Number.isNaN(Date.parse(instant))) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: SCHEDULE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(instant)).reduce<Record<string, string>>((result, part) => {
    if (part.type !== "literal") result[part.type] = part.value;
    return result;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

function displayDateTime(instant: string): string {
  return new Date(instant).toLocaleString("en-US", {
    timeZone: SCHEDULE_TIME_ZONE,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function slotLabel(slot: ProgrammeSlotRef, data: AdminProgrammeData): string {
  if (slot.kind !== "session") return slot.title || "Untitled programme item";
  return data.sessions.find((session) => session.id === slot.sessionId)?.title || "Session";
}

export default function AdminAgendaHub() {
  const { toast, showToast } = useAdminToast();
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const [programme, { refetch }] = createResource(async () => {
    const result = await adminFetchProgramme();
    if (!result.success) {
      setError(result.error || "Could not load the agenda.");
      return null;
    }
    setError(null);
    return result.data as AdminProgrammeData;
  });

  const [dayEditingId, setDayEditingId] = createSignal<string | null>(null);
  const [dayKey, setDayKey] = createSignal("");
  const [dayDate, setDayDate] = createSignal("");
  const [dayTitle, setDayTitle] = createSignal("");
  const [dayOrder, setDayOrder] = createSignal("0");

  const [trackEditingId, setTrackEditingId] = createSignal<string | null>(null);
  const [trackDayId, setTrackDayId] = createSignal("");
  const [trackKey, setTrackKey] = createSignal("");
  const [trackName, setTrackName] = createSignal("");
  const [trackLocation, setTrackLocation] = createSignal("");
  const [trackOrder, setTrackOrder] = createSignal("0");

  const [slotEditingId, setSlotEditingId] = createSignal<string | null>(null);
  const [slotDayId, setSlotDayId] = createSignal("");
  const [slotTrackId, setSlotTrackId] = createSignal("");
  const [slotStart, setSlotStart] = createSignal("");
  const [slotEnd, setSlotEnd] = createSignal("");
  const [slotKind, setSlotKind] = createSignal<AgendaSlotKind>("session");
  const [slotOrder, setSlotOrder] = createSignal("0");
  const [slotLocation, setSlotLocation] = createSignal("");
  const [slotSessionId, setSlotSessionId] = createSignal("");
  const [slotTitle, setSlotTitle] = createSignal("");
  const [slotSummary, setSlotSummary] = createSignal("");

  const availableTracks = createMemo(() =>
    (programme()?.tracks || []).filter((track) => track.dayId === slotDayId()),
  );

  const resetDay = () => {
    setDayEditingId(null);
    setDayKey("");
    setDayDate("");
    setDayTitle("");
    setDayOrder("0");
  };

  const resetTrack = () => {
    setTrackEditingId(null);
    setTrackDayId("");
    setTrackKey("");
    setTrackName("");
    setTrackLocation("");
    setTrackOrder("0");
  };

  const resetSlot = () => {
    setSlotEditingId(null);
    setSlotDayId("");
    setSlotTrackId("");
    setSlotStart("");
    setSlotEnd("");
    setSlotKind("session");
    setSlotOrder("0");
    setSlotLocation("");
    setSlotSessionId("");
    setSlotTitle("");
    setSlotSummary("");
  };

  const editDay = (day: ProgrammeDayRef) => {
    setDayEditingId(day.id);
    setDayKey(day.key);
    setDayDate(day.localDate);
    setDayTitle(day.title);
    setDayOrder(String(day.displayOrder));
  };

  const editTrack = (track: ProgrammeTrackRef) => {
    setTrackEditingId(track.id);
    setTrackDayId(track.dayId);
    setTrackKey(track.key);
    setTrackName(track.name);
    setTrackLocation(track.locationLabel || "");
    setTrackOrder(String(track.displayOrder));
  };

  const editSlot = (slot: ProgrammeSlotRef) => {
    setSlotEditingId(slot.id);
    setSlotDayId(slot.dayId);
    setSlotTrackId(slot.trackId || "");
    setSlotStart(localDateTimeInput(slot.startAt));
    setSlotEnd(localDateTimeInput(slot.endAt));
    setSlotKind(slot.kind);
    setSlotOrder(String(slot.displayOrder));
    setSlotLocation(slot.locationLabel || "");
    setSlotSessionId(slot.sessionId || "");
    setSlotTitle(slot.title || "");
    setSlotSummary(slot.summary || "");
  };

  const submitDay = async (event: Event) => {
    event.preventDefault();
    if (busy()) return;
    setBusy(true);
    try {
      const id = dayEditingId();
      const result = id
        ? await adminUpdateConferenceDay(id, {
            localDate: dayDate(),
            title: dayTitle(),
            displayOrder: Number(dayOrder()),
          })
        : await adminCreateConferenceDay({
            key: dayKey(),
            localDate: dayDate(),
            title: dayTitle(),
            displayOrder: Number(dayOrder()),
          });
      if (!result.success) {
        showToast("error", result.error || "Could not save Conference Day.");
        return;
      }
      showToast("success", id ? "Conference Day updated." : "Conference Day created as draft.");
      resetDay();
      await refetch();
    } finally {
      setBusy(false);
    }
  };

  const submitTrack = async (event: Event) => {
    event.preventDefault();
    if (busy()) return;
    setBusy(true);
    try {
      const id = trackEditingId();
      const result = id
        ? await adminUpdateAgendaTrack(id, {
            name: trackName(),
            locationLabel: trackLocation(),
            displayOrder: Number(trackOrder()),
          })
        : await adminCreateAgendaTrack({
            dayId: trackDayId(),
            key: trackKey(),
            name: trackName(),
            locationLabel: trackLocation(),
            displayOrder: Number(trackOrder()),
          });
      if (!result.success) {
        showToast("error", result.error || "Could not save Track.");
        return;
      }
      showToast("success", id ? "Track updated." : "Track created.");
      resetTrack();
      await refetch();
    } finally {
      setBusy(false);
    }
  };

  const slotPayload = (): AdminAgendaSlotInput => ({
    dayId: slotDayId(),
    trackId: slotTrackId(),
    startAt: scheduleLocalDateTimeToInstant(slotStart()),
    endAt: scheduleLocalDateTimeToInstant(slotEnd()),
    kind: slotKind(),
    displayOrder: Number(slotOrder()),
    locationLabel: slotLocation(),
    sessionId: slotSessionId(),
    title: slotTitle(),
    summary: slotSummary(),
  });

  const submitSlot = async (event: Event) => {
    event.preventDefault();
    if (busy()) return;
    setBusy(true);
    try {
      const payload = slotPayload();
      const id = slotEditingId();
      const result = id
        ? await adminUpdateAgendaSlot(id, payload)
        : await adminCreateAgendaSlot(payload);
      if (!result.success) {
        showToast("error", result.error || "Could not save Agenda Slot.");
        return;
      }
      showToast("success", id ? "Agenda Slot updated." : "Agenda Slot created as draft.");
      resetSlot();
      await refetch();
    } catch (reason) {
      showToast("error", reason instanceof Error ? reason.message : "Could not save Agenda Slot.");
    } finally {
      setBusy(false);
    }
  };

  const toggleDayPublication = async (day: ProgrammeDayRef) => {
    if (busy()) return;
    const confirmed = window.confirm(day.published
      ? `Move ${day.title} back to draft? Its public Agenda Slots will disappear from the agenda.`
      : `Publish ${day.title}? Its published Agenda Slots will become visible on the public agenda.`);
    if (!confirmed) return;
    setBusy(true);
    try {
      const result = await adminSetConferenceDayPublished(day.id, !day.published);
      if (!result.success) showToast("error", result.error || "Could not change Day visibility.");
      else {
        showToast("success", day.published ? "Conference Day is now a draft." : "Conference Day is public.");
        await refetch();
      }
    } finally {
      setBusy(false);
    }
  };

  const toggleSlotPublication = async (slot: ProgrammeSlotRef) => {
    if (busy()) return;
    const label = programme() ? slotLabel(slot, programme()!) : "this Agenda Slot";
    const confirmed = window.confirm(slot.published
      ? `Move ${label} back to draft? It will disappear from the public agenda.`
      : `Publish ${label}? Session Slots also publish the linked Session on public programme surfaces.`);
    if (!confirmed) return;
    setBusy(true);
    try {
      const result = await adminSetAgendaSlotPublished(slot.id, !slot.published);
      if (!result.success) showToast("error", result.error || "Could not change Slot visibility.");
      else {
        showToast("success", slot.published ? "Agenda Slot is now a draft." : "Agenda Slot is public.");
        await refetch();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <AdminPageShell
      layoutTitle="Admin: Agenda"
      layoutDescription="Manage the public conference programme"
      title="Agenda"
      subtitle="Conference Days, day-specific Tracks, and Slots"
      hint={`All schedule times are interpreted in ${SCHEDULE_TIME_ZONE}. Publishing a Session Slot also publishes its linked Session.`}
      count={programme()?.slots.length}
      countLoading={programme.loading}
      accent="secondary"
      toast={toast()}
      headerActions={
        <a href="/admin/sessions" class="btn btn-outline btn-primary font-mono">
          Sessions
        </a>
      }
    >
      <Show when={error()}>
        <div class="alert alert-error mb-6 font-mono text-sm" role="alert">
          <Icon icon="ph:warning-circle-bold" aria-hidden="true" />
          <span>{error()}</span>
        </div>
      </Show>

      <div class="grid gap-8 xl:grid-cols-2">
        <form class={adminFormPanelClass} onSubmit={submitDay}>
          <AdminFormSection title={dayEditingId() ? "Edit Conference Day" : "New Conference Day"} description="Keys are immutable after creation. The local date is evaluated in Europe/Skopje.">
            <div class="grid gap-4 sm:grid-cols-2">
              <AdminFormField id="agenda-day-key" label="Key" required hint="Example: workshop-day">
                <input id="agenda-day-key" class={adminInputClass("font-mono")} required disabled={Boolean(dayEditingId())} value={dayKey()} onInput={(event) => setDayKey(event.currentTarget.value)} />
              </AdminFormField>
              <AdminFormField id="agenda-day-date" label="Local date" required>
                <input id="agenda-day-date" type="date" class={adminInputClass("font-mono")} required value={dayDate()} onInput={(event) => setDayDate(event.currentTarget.value)} />
              </AdminFormField>
              <AdminFormField id="agenda-day-title" label="Title" required class="sm:col-span-2">
                <input id="agenda-day-title" class={adminInputClass()} required value={dayTitle()} onInput={(event) => setDayTitle(event.currentTarget.value)} />
              </AdminFormField>
              <AdminFormField id="agenda-day-order" label="Display order" required>
                <input id="agenda-day-order" type="number" step="1" class={adminInputClass("font-mono")} required value={dayOrder()} onInput={(event) => setDayOrder(event.currentTarget.value)} />
              </AdminFormField>
            </div>
          </AdminFormSection>
          <div class="mt-5 flex justify-end gap-2 border-t border-white/10 pt-5">
            <button type="button" class="btn btn-ghost font-mono" onClick={resetDay}>Clear</button>
            <button type="submit" class="btn btn-secondary font-mono" disabled={busy()}>{dayEditingId() ? "Update Day" : "Create Day"}</button>
          </div>
        </form>

        <form class={adminFormPanelClass} onSubmit={submitTrack}>
          <AdminFormSection title={trackEditingId() ? "Edit Track" : "New Track"} description="Tracks are scoped to exactly one Conference Day and their keys are immutable.">
            <div class="grid gap-4 sm:grid-cols-2">
              <AdminFormField id="agenda-track-day" label="Conference Day" required>
                <select id="agenda-track-day" class={adminSelectClass()} required disabled={Boolean(trackEditingId())} value={trackDayId()} onChange={(event) => setTrackDayId(event.currentTarget.value)}>
                  <option value="">Choose a Day</option>
                  <For each={programme()?.days || []}>{(day) => <option value={day.id}>{day.localDate} - {day.title}</option>}</For>
                </select>
              </AdminFormField>
              <AdminFormField id="agenda-track-key" label="Day-local key" required hint="Example: main">
                <input id="agenda-track-key" class={adminInputClass("font-mono")} required disabled={Boolean(trackEditingId())} value={trackKey()} onInput={(event) => setTrackKey(event.currentTarget.value)} />
              </AdminFormField>
              <AdminFormField id="agenda-track-name" label="Name" required>
                <input id="agenda-track-name" class={adminInputClass()} required value={trackName()} onInput={(event) => setTrackName(event.currentTarget.value)} />
              </AdminFormField>
              <AdminFormField id="agenda-track-location" label="Default location">
                <input id="agenda-track-location" class={adminInputClass()} value={trackLocation()} onInput={(event) => setTrackLocation(event.currentTarget.value)} />
              </AdminFormField>
              <AdminFormField id="agenda-track-order" label="Display order" required>
                <input id="agenda-track-order" type="number" step="1" class={adminInputClass("font-mono")} required value={trackOrder()} onInput={(event) => setTrackOrder(event.currentTarget.value)} />
              </AdminFormField>
            </div>
          </AdminFormSection>
          <div class="mt-5 flex justify-end gap-2 border-t border-white/10 pt-5">
            <button type="button" class="btn btn-ghost font-mono" onClick={resetTrack}>Clear</button>
            <button type="submit" class="btn btn-secondary font-mono" disabled={busy()}>{trackEditingId() ? "Update Track" : "Create Track"}</button>
          </div>
        </form>
      </div>

      <form class={`${adminFormPanelClass} mt-8`} onSubmit={submitSlot}>
        <AdminFormSection title={slotEditingId() ? "Edit Agenda Slot" : "New Agenda Slot"} description="Untracked Slots are all-attendee entries. They cannot overlap any Track or following-Day Slot.">
          <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <AdminFormField id="agenda-slot-day" label="Conference Day" required>
              <select id="agenda-slot-day" class={adminSelectClass()} required value={slotDayId()} onChange={(event) => { setSlotDayId(event.currentTarget.value); setSlotTrackId(""); }}>
                <option value="">Choose a Day</option>
                <For each={programme()?.days || []}>{(day) => <option value={day.id}>{day.localDate} - {day.title}</option>}</For>
              </select>
            </AdminFormField>
            <AdminFormField id="agenda-slot-track" label="Track">
              <select id="agenda-slot-track" class={adminSelectClass()} value={slotTrackId()} onChange={(event) => setSlotTrackId(event.currentTarget.value)}>
                <option value="">All attendees (no Track)</option>
                <For each={availableTracks()}>{(track) => <option value={track.id}>{track.name}</option>}</For>
              </select>
            </AdminFormField>
            <AdminFormField id="agenda-slot-start" label="Start" required hint="Europe/Skopje local time.">
              <input id="agenda-slot-start" type="datetime-local" class={adminInputClass("font-mono")} required value={slotStart()} onInput={(event) => setSlotStart(event.currentTarget.value)} />
            </AdminFormField>
            <AdminFormField id="agenda-slot-end" label="End" required hint="Can run past midnight.">
              <input id="agenda-slot-end" type="datetime-local" class={adminInputClass("font-mono")} required value={slotEnd()} onInput={(event) => setSlotEnd(event.currentTarget.value)} />
            </AdminFormField>
            <AdminFormField id="agenda-slot-kind" label="Kind" required>
              <select id="agenda-slot-kind" class={adminSelectClass()} value={slotKind()} onChange={(event) => { setSlotKind(event.currentTarget.value as AgendaSlotKind); setSlotSessionId(""); setSlotTitle(""); setSlotSummary(""); }}>
                <For each={AGENDA_SLOT_KINDS}>{(kind) => <option value={kind}>{kind}</option>}</For>
              </select>
            </AdminFormField>
            <AdminFormField id="agenda-slot-location" label="Location override">
              <input id="agenda-slot-location" class={adminInputClass()} value={slotLocation()} onInput={(event) => setSlotLocation(event.currentTarget.value)} />
            </AdminFormField>
            <AdminFormField id="agenda-slot-order" label="Display order" required>
              <input id="agenda-slot-order" type="number" step="1" class={adminInputClass("font-mono")} required value={slotOrder()} onInput={(event) => setSlotOrder(event.currentTarget.value)} />
            </AdminFormField>
          </div>
          <Show when={slotKind() === "session"} fallback={
            <div class="mt-4 grid gap-4 md:grid-cols-2">
              <AdminFormField id="agenda-slot-title" label="Programme title" required>
                <input id="agenda-slot-title" class={adminInputClass()} required value={slotTitle()} onInput={(event) => setSlotTitle(event.currentTarget.value)} />
              </AdminFormField>
              <AdminFormField id="agenda-slot-summary" label="Summary" required>
                <textarea id="agenda-slot-summary" class={adminTextareaClass("min-h-24")} required value={slotSummary()} onInput={(event) => setSlotSummary(event.currentTarget.value)} />
              </AdminFormField>
            </div>
          }>
            <div class="mt-4 max-w-2xl">
              <AdminFormField id="agenda-slot-session" label="Session" required hint="Publishing this Slot also publishes the linked Session.">
                <select id="agenda-slot-session" class={adminSelectClass()} required value={slotSessionId()} onChange={(event) => setSlotSessionId(event.currentTarget.value)}>
                  <option value="">Choose a Session</option>
                  <For each={programme()?.sessions || []}>{(session) => <option value={session.id}>{session.title} {session.published ? "(published)" : "(draft)"}</option>}</For>
                </select>
              </AdminFormField>
            </div>
          </Show>
        </AdminFormSection>
        <div class="mt-5 flex justify-end gap-2 border-t border-white/10 pt-5">
          <button type="button" class="btn btn-ghost font-mono" onClick={resetSlot}>Clear</button>
          <button type="submit" class="btn btn-secondary font-mono" disabled={busy()}>{slotEditingId() ? "Update Slot" : "Create Slot"}</button>
        </div>
      </form>

      <div class="mt-8 grid gap-8 xl:grid-cols-2">
        <AdminDataPanel>
          <div class="border-b border-white/10 p-5"><h2 class="font-bold text-white">Conference Days</h2></div>
          <ul class="divide-y divide-white/10" role="list">
            <For each={programme()?.days || []}>{(day) => (
              <li class="flex flex-wrap items-center justify-between gap-3 p-4">
                <div><p class="font-bold text-white">{day.localDate} - {day.title}</p><p class="text-xs font-mono text-base-content/55">{day.key} / order {day.displayOrder}</p></div>
                <div class="flex gap-2">
                  <button type="button" class="btn btn-xs btn-ghost font-mono" onClick={() => editDay(day)}>Edit</button>
                  <button type="button" class={`btn btn-xs font-mono ${day.published ? "btn-success" : "btn-ghost"}`} onClick={() => toggleDayPublication(day)}>{day.published ? "Published" : "Draft"}</button>
                </div>
              </li>
            )}</For>
            <Show when={(programme()?.days.length || 0) === 0}><li class="p-5 text-sm font-mono text-base-content/60">Create a Conference Day to begin.</li></Show>
          </ul>
        </AdminDataPanel>
        <AdminDataPanel>
          <div class="border-b border-white/10 p-5"><h2 class="font-bold text-white">Tracks</h2></div>
          <ul class="divide-y divide-white/10" role="list">
            <For each={programme()?.tracks || []}>{(track) => (
              <li class="flex flex-wrap items-center justify-between gap-3 p-4">
                <div><p class="font-bold text-white">{track.name}</p><p class="text-xs font-mono text-base-content/55">{track.key} / {track.locationLabel || "No default location"}</p></div>
                <button type="button" class="btn btn-xs btn-ghost font-mono" onClick={() => editTrack(track)}>Edit</button>
              </li>
            )}</For>
            <Show when={(programme()?.tracks.length || 0) === 0}><li class="p-5 text-sm font-mono text-base-content/60">Tracks are optional.</li></Show>
          </ul>
        </AdminDataPanel>
      </div>

      <AdminDataPanel>
        <div class="mt-8 border-b border-white/10 p-5"><h2 class="font-bold text-white">Agenda Slots</h2></div>
        <ul class="divide-y divide-white/10" role="list">
          <For each={programme()?.slots || []}>{(slot) => (
            <li class="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div class="min-w-0">
                <p class="font-bold text-white break-words">{slotLabel(slot, programme()!)}</p>
                <p class="text-xs font-mono text-base-content/60">{displayDateTime(slot.startAt)} - {displayDateTime(slot.endAt)} / {slot.kind}</p>
              </div>
              <div class="flex shrink-0 gap-2">
                <button type="button" class="btn btn-xs btn-ghost font-mono" onClick={() => editSlot(slot)}>Edit</button>
                <button type="button" class={`btn btn-xs font-mono ${slot.published ? "btn-success" : "btn-ghost"}`} onClick={() => toggleSlotPublication(slot)}>{slot.published ? "Published" : "Draft"}</button>
              </div>
            </li>
          )}</For>
          <Show when={(programme()?.slots.length || 0) === 0}><li class="p-5 text-sm font-mono text-base-content/60">No Agenda Slots yet.</li></Show>
        </ul>
      </AdminDataPanel>
    </AdminPageShell>
  );
}
