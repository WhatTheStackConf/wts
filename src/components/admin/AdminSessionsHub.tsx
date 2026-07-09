import { createEffect, createMemo, createResource, createSignal, For, Show } from "solid-js";
import { Icon } from "@iconify-icon/solid";
import {
  AdminDataPanel,
  AdminFormField,
  AdminFormSection,
  AdminPageShell,
  adminFormPanelClass,
  adminInputClass,
  adminTextareaClass,
  clearAdminControlValidity,
  markAdminControlInvalid,
  syncAdminControlValidity,
  useAdminToast,
} from "~/components/admin/AdminPageShell";
import {
  adminCreateSession,
  adminFetchSessions,
  adminFetchSpeakers,
  adminSetSessionPublished,
  adminUpdateSession,
} from "~/lib/admin-actions";
import type { SessionRecord, SpeakerRecord } from "~/lib/pocketbase-types";
import { slugify } from "~/lib/conference-slug";

function speakerDisplayName(sp: SpeakerRecord): string {
  return sp.display_name || sp.slug;
}

function formatStartsAt(value?: string): string {
  if (!value) return "Not scheduled";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  try {
    return date.toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return value;
  }
}

function toDatetimeLocalValue(value?: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.includes("T") ? value.slice(0, 16) : "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function reducedMotionPreferred(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

export default function AdminSessionsHub() {
  const { toast, showToast } = useAdminToast();
  const [busyId, setBusyId] = createSignal<string | null>(null);
  const [editingId, setEditingId] = createSignal<string | null>(null);
  const [showForm, setShowForm] = createSignal(false);
  const [sessionsError, setSessionsError] = createSignal<string | null>(null);
  const [speakerSearch, setSpeakerSearch] = createSignal("");
  const [requestedEditHandled, setRequestedEditHandled] = createSignal(false);

  const [speakers] = createResource(async () => {
    const res = await adminFetchSpeakers();
    return res.success ? (res.data as SpeakerRecord[]) : [];
  });

  const [sessions, { refetch }] = createResource(async () => {
    const res = await adminFetchSessions();
    if (!res.success) {
      setSessionsError(res.error || "Could not load sessions.");
      return [] as SessionRecord[];
    }
    setSessionsError(null);
    return res.data as SessionRecord[];
  });

  const [title, setTitle] = createSignal("");
  const [slug, setSlug] = createSignal("");
  const [abstract, setAbstract] = createSignal("");
  const [format, setFormat] = createSignal("");
  const [startsAt, setStartsAt] = createSignal("");
  const [track, setTrack] = createSignal("");
  const [room, setRoom] = createSignal("");
  const [selectedSpeakers, setSelectedSpeakers] = createSignal<string[]>([]);
  const [saving, setSaving] = createSignal(false);

  const editingSession = createMemo(() => {
    const id = editingId();
    if (!id) return null;
    return (sessions() || []).find((session) => session.id === id) || null;
  });

  const filteredSpeakers = createMemo(() => {
    const q = speakerSearch().trim().toLowerCase();
    const list = speakers() || [];
    if (!q) return list;
    return list.filter((sp) => speakerDisplayName(sp).toLowerCase().includes(q));
  });

  const resetForm = () => {
    setEditingId(null);
    setTitle("");
    setSlug("");
    setAbstract("");
    setFormat("");
    setStartsAt("");
    setTrack("");
    setRoom("");
    setSelectedSpeakers([]);
    setSpeakerSearch("");
    setShowForm(false);
  };

  const openNewSession = () => {
    resetForm();
    setShowForm(true);
  };

  const loadSession = (session: SessionRecord) => {
    setEditingId(session.id);
    setTitle(session.title);
    setSlug(session.slug);
    setAbstract(session.abstract);
    setFormat(session.format || "");
    setStartsAt(toDatetimeLocalValue(session.starts_at));
    setTrack(session.track || "");
    setRoom(session.room || "");
    setSelectedSpeakers(session.speakers || []);
    setSpeakerSearch("");
    setShowForm(true);
  };

  createEffect(() => {
    if (requestedEditHandled() || sessions.loading) return;

    const requestedId = typeof window === "undefined"
      ? ""
      : new URLSearchParams(window.location.search).get("edit")?.trim() || "";

    if (!requestedId) {
      setRequestedEditHandled(true);
      return;
    }

    const match = (sessions() || []).find((session) => session.id === requestedId);
    if (match) {
      loadSession(match);
      setRequestedEditHandled(true);
      window.requestAnimationFrame(() => {
        document.getElementById("session-edit-form")?.scrollIntoView({
          block: "start",
          behavior: reducedMotionPreferred() ? "auto" : "smooth",
        });
      });
      return;
    }

    setSessionsError("The requested Session could not be found.");
    setRequestedEditHandled(true);
  });

  const toggleSpeaker = (id: string) => {
    const current = selectedSpeakers();
    if (current.includes(id)) {
      setSelectedSpeakers(current.filter((s) => s !== id));
    } else {
      setSelectedSpeakers([...current, id]);
    }
  };

  const submit = async (e: Event) => {
    e.preventDefault();
    if (saving()) return;
    setSaving(true);
    const sessionTitle = title().trim();
    const payload = {
      slug: slug().trim() || slugify(sessionTitle),
      title: sessionTitle,
      abstract: abstract().trim(),
      format: format().trim(),
      starts_at: startsAt(),
      track: track().trim(),
      room: room().trim(),
      speakers: selectedSpeakers(),
    };

    const id = editingId();
    try {
      const res = id ? await adminUpdateSession(id, payload) : await adminCreateSession(payload);

      if (!res.success) {
        showToast("error", res.error || "Could not save session.");
        return;
      }

      showToast(
        "success",
        id
          ? `"${sessionTitle}" updated. Toggle Published when ready for the public site.`
          : `"${sessionTitle}" created as draft. Toggle Published when ready for the public site.`,
      );
      resetForm();
      await refetch();
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Could not save session.");
    } finally {
      setSaving(false);
    }
  };

  const togglePublished = async (session: SessionRecord) => {
    if (busyId()) return;
    setBusyId(session.id);
    try {
      const res = await adminSetSessionPublished(session.id, !session.published);
      if (!res.success) {
        showToast("error", res.error || "Could not update published state.");
        return;
      }

      showToast(
        "success",
        session.published
          ? `"${session.title}" is now a draft.`
          : `"${session.title}" is now published.`,
      );
      await refetch();
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Could not update published state.");
    } finally {
      setBusyId(null);
    }
  };

  const speakerNameById = (id: string) => {
    const sp = (speakers() || []).find((s) => s.id === id);
    return sp ? speakerDisplayName(sp) : id;
  };

  return (
    <AdminPageShell
      layoutTitle="Admin: Sessions"
      layoutDescription="Manage conference sessions"
      title="Sessions"
      subtitle="Programme items & publication"
      hint="Sessions start as drafts. Toggle Published to show on the public site."
      count={sessions()?.length}
      countLoading={sessions.loading}
      accent="secondary"
      toast={toast()}
      headerActions={
        <a href="/admin/speakers" class="btn btn-outline btn-primary font-mono">
          Speakers
        </a>
      }
    >
      <Show when={sessionsError()}>
        <div class="alert alert-error mb-6 font-mono text-sm" role="alert">
          <Icon icon="ph:warning-circle-bold" aria-hidden="true" />
          <span>{sessionsError()}</span>
        </div>
      </Show>

      <div class="mb-8">
        <Show
          when={showForm()}
          fallback={
            <button type="button" class="btn btn-primary font-mono gap-2" onClick={openNewSession}>
              <Icon icon="ph:plus-bold" />
              New session
            </button>
          }
        >
          <form
            id="session-edit-form"
            onSubmit={submit}
            class={adminFormPanelClass}
          >
            <div class="mb-6">
              <div>
                <h2 class="text-lg font-bold text-white">
                  {editingId() ? "Edit session" : "New session"}
                </h2>
                <p class="text-xs text-base-content/60 font-mono mt-1 leading-relaxed">
                  Saves as draft. Toggle Published when ready for the public site.
                </p>
              </div>
            </div>
            <div class="space-y-6">
              <Show when={editingSession()?.cfp_submission}>
                {(submissionId) => (
                  <AdminFormSection
                    title="Source"
                    description="Read-only provenance context for this public Session."
                  >
                    <div class="rounded-xl border border-secondary-500/20 bg-secondary-500/10 p-4">
                      <div class="mb-3 flex flex-wrap items-center gap-2">
                        <span class="badge border-secondary-500/40 bg-secondary-500/20 font-mono text-secondary-100">
                          From CFP
                        </span>
                          <span class="text-xs font-mono text-base-content/65 break-all">
                            Source submission ID: {submissionId()}
                          </span>
                      </div>
                      <p class="max-w-3xl text-xs font-mono leading-relaxed text-base-content/65 text-pretty">
                        This Session was copied once from an accepted CFP Submission. Edit the public
                        Session fields here; CFP private and review fields are not shown or editable in
                        this panel.
                      </p>
                      <a
                        href={`/reviewer/${submissionId()}`}
                        class="btn btn-xs btn-outline btn-secondary mt-3 font-mono"
                      >
                        Open CFP review detail
                      </a>
                    </div>
                  </AdminFormSection>
                )}
              </Show>

              <AdminFormSection
                title="Public identity"
                description="The title and slug used for the public session page."
              >
                <div class="grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-5">
                  <AdminFormField
                    id="session-title"
                    label="Title"
                    required
                    hint="Public session title shown on the website."
                    error="Add a public title before saving."
                    class="lg:col-span-8"
                  >
                    <input
                      id="session-title"
                      name="title"
                      class={adminInputClass()}
                      required
                      autocomplete="off"
                      aria-describedby="session-title-hint"
                      aria-errormessage="session-title-error"
                      value={title()}
                      onInvalid={markAdminControlInvalid}
                      onBlur={syncAdminControlValidity}
                      onInput={(e) => {
                        clearAdminControlValidity(e);
                        setTitle(e.currentTarget.value);
                      }}
                    />
                  </AdminFormField>

                  <AdminFormField
                    id="session-slug"
                    label="Slug"
                    hint="Leave blank to generate it from the title."
                    class="lg:col-span-4"
                  >
                    <input
                      id="session-slug"
                      name="slug"
                      class={adminInputClass("font-mono")}
                      autocomplete="off"
                      placeholder="intro-to-rust"
                      value={slug()}
                      onInput={(e) => setSlug(e.currentTarget.value)}
                    />
                  </AdminFormField>
                </div>
              </AdminFormSection>

              <AdminFormSection title="Schedule" description="Optional programme metadata. Leave fields empty until the schedule is firm.">
                <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 lg:gap-5">
                  <AdminFormField id="session-format" label="Format">
                    <input
                      id="session-format"
                      name="format"
                      class={adminInputClass()}
                      autocomplete="off"
                      placeholder="25+10"
                      value={format()}
                      onInput={(e) => setFormat(e.currentTarget.value)}
                    />
                  </AdminFormField>

                  <AdminFormField id="session-starts-at" label="Starts at">
                    <input
                      id="session-starts-at"
                      name="starts_at"
                      type="datetime-local"
                      class={adminInputClass("font-mono")}
                      value={startsAt()}
                      onInput={(e) => setStartsAt(e.currentTarget.value)}
                    />
                  </AdminFormField>

                  <AdminFormField id="session-track" label="Track">
                    <input
                      id="session-track"
                      name="track"
                      class={adminInputClass()}
                      autocomplete="off"
                      placeholder="Systems"
                      value={track()}
                      onInput={(e) => setTrack(e.currentTarget.value)}
                    />
                  </AdminFormField>

                  <AdminFormField id="session-room" label="Room">
                    <input
                      id="session-room"
                      name="room"
                      class={adminInputClass()}
                      autocomplete="off"
                      placeholder="Main hall"
                      value={room()}
                      onInput={(e) => setRoom(e.currentTarget.value)}
                    />
                  </AdminFormField>
                </div>
              </AdminFormSection>

              <AdminFormSection title="Public copy" description="This text appears on the public session page.">
                <AdminFormField
                  id="session-abstract"
                  label="Public abstract"
                  required
                  hint="Do not paste private CFP review notes here."
                  error="Add a public abstract before saving."
                >
                  <textarea
                    id="session-abstract"
                    name="abstract"
                    class={adminTextareaClass("min-h-36")}
                    required
                    aria-describedby="session-abstract-hint"
                    aria-errormessage="session-abstract-error"
                    value={abstract()}
                    onInvalid={markAdminControlInvalid}
                    onBlur={syncAdminControlValidity}
                    onInput={(e) => {
                      clearAdminControlValidity(e);
                      setAbstract(e.currentTarget.value);
                    }}
                  />
                </AdminFormField>
              </AdminFormSection>

              <Show when={speakers()}>
                <AdminFormSection
                  title="Speakers"
                  description={`Select one or more speakers for this session. ${selectedSpeakers().length > 0 ? `${selectedSpeakers().length} selected.` : "None selected yet."}`}
                >
                  <AdminFormField id="session-speaker-search" label="Filter speakers" class="mb-3">
                    <input
                      id="session-speaker-search"
                      name="speaker_search"
                      type="search"
                      class={adminInputClass("input-sm font-mono w-full")}
                      placeholder="Search by name"
                      value={speakerSearch()}
                      onInput={(e) => setSpeakerSearch(e.currentTarget.value)}
                    />
                  </AdminFormField>
                  <ul class="max-h-56 overflow-y-auto space-y-1 rounded-lg bg-black/20 p-2 border border-white/10" aria-label="Available speakers">
                    <Show
                      when={filteredSpeakers().length > 0}
                      fallback={
                        <li class="text-xs text-base-content/60 font-mono p-4 text-center">
                          {speakerSearch()
                            ? "No speakers match your search."
                            : "No speaker profiles yet. Create speakers first."}
                        </li>
                      }
                    >
                      <For each={filteredSpeakers()}>
                        {(sp) => (
                          <li>
                            <label class="flex min-w-0 items-center gap-3 rounded-lg p-2 cursor-pointer transition-colors hover:bg-white/5 focus-within:bg-white/5">
                              <input
                                type="checkbox"
                                name="speakers"
                                value={sp.id}
                                class="checkbox checkbox-sm checkbox-primary shrink-0"
                                checked={selectedSpeakers().includes(sp.id)}
                                onChange={() => toggleSpeaker(sp.id)}
                              />
                              <span class="min-w-0 flex-1 truncate text-sm text-white">
                                {speakerDisplayName(sp)}
                              </span>
                              <span class="max-w-[45%] truncate text-xs font-mono text-base-content/60">
                                {sp.slug}
                              </span>
                            </label>
                          </li>
                        )}
                      </For>
                    </Show>
                  </ul>
                </AdminFormSection>
              </Show>
            </div>

            <div class="mt-6 border-t border-white/10 pt-5 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3">
              <p class="text-xs text-base-content/45 font-mono">
                Sessions save as drafts until you toggle Published in the list.
              </p>
              <div class="flex flex-wrap gap-2 sm:justify-end">
                <button type="button" class="btn btn-ghost font-mono" onClick={resetForm}>
                  Cancel
                </button>
                <button type="submit" class="btn btn-primary font-mono" disabled={saving()}>
                  <Show when={saving()} fallback={editingId() ? "Update session" : "Create session"}>
                    <span class="loading loading-spinner loading-xs" aria-hidden="true"></span>
                    Saving...
                  </Show>
                </button>
              </div>
            </div>
          </form>
        </Show>
      </div>

      <Show when={sessions.loading}>
        <div class="flex justify-center py-16">
          <span class="loading loading-bars loading-lg text-primary-500"></span>
        </div>
      </Show>

      <Show when={!sessions.loading && (sessions()?.length ?? 0) === 0 && !sessionsError()}>
        <AdminDataPanel>
          <div class="p-12 text-center">
            <Icon icon="ph:calendar-blank-bold" class="text-4xl text-base-content/40 mb-4" aria-hidden="true" />
            <p class="text-white font-bold mb-2">No sessions yet</p>
            <p class="text-sm text-base-content/60 font-mono max-w-md mx-auto mb-4 leading-relaxed text-pretty">
              Create a programme item and link speakers. Publish when the schedule is ready for
              attendees.
            </p>
            <Show when={!showForm()}>
              <button type="button" class="btn btn-primary btn-sm font-mono" onClick={openNewSession}>
                New session
              </button>
            </Show>
          </div>
        </AdminDataPanel>
      </Show>

      <Show when={!sessions.loading && (sessions()?.length ?? 0) > 0}>
        <AdminDataPanel>
          <div class="md:hidden space-y-4 p-4">
            <For each={sessions()}>
              {(session) => (
                <article class="bg-white/5 rounded-xl p-4 border border-white/10 space-y-3">
                  <div class="min-w-0">
                    <h2 class="font-bold text-white [overflow-wrap:anywhere]">{session.title}</h2>
                    <div class="text-xs font-mono text-base-content/60 break-all">{session.slug}</div>
                    <div class="text-xs text-base-content/70 mt-1">{formatStartsAt(session.starts_at)}</div>
                    <div class="mt-2">
                      <Show
                        when={session.cfp_submission}
                        fallback={<span class="badge badge-ghost badge-sm font-mono">Manual</span>}
                      >
                        <span class="badge badge-secondary badge-sm font-mono">From CFP</span>
                      </Show>
                    </div>
                  </div>
                  <Show when={(session.speakers?.length ?? 0) > 0}>
                    <div class="text-xs font-mono text-base-content/60 [overflow-wrap:anywhere]">
                      {(session.speakers || []).map(speakerNameById).join(", ")}
                    </div>
                  </Show>
                  <div class="flex flex-wrap gap-2 pt-3 border-t border-white/5">
                    <button
                      type="button"
                      class={`btn btn-xs font-mono ${session.published ? "btn-success" : "btn-ghost"}`}
                      disabled={busyId() !== null}
                      aria-pressed={session.published}
                      onClick={() => togglePublished(session)}
                    >
                      <Show when={busyId() === session.id} fallback={session.published ? "Published" : "Draft"}>
                        <span class="loading loading-spinner loading-xs" aria-hidden="true"></span>
                        Updating
                      </Show>
                    </button>
                    <button
                      type="button"
                      class="btn btn-xs btn-ghost font-mono"
                      onClick={() => loadSession(session)}
                    >
                      Edit
                    </button>
                    <a
                      href={`/sessions/${session.slug}`}
                      class="btn btn-xs btn-ghost"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Preview
                    </a>
                  </div>
                </article>
              )}
            </For>
          </div>

          <div class="hidden md:block overflow-x-auto">
            <table class="table table-lg w-full">
              <caption class="sr-only">Conference sessions and publication state</caption>
              <thead>
                <tr class="text-white border-b border-white/10 bg-white/5">
                  <th scope="col" class="font-bold text-gray-300">Title</th>
                  <th scope="col" class="font-bold text-gray-300">Schedule</th>
                  <th scope="col" class="font-bold text-gray-300">Speakers</th>
                  <th scope="col" class="font-bold text-gray-300">Source</th>
                  <th scope="col" class="font-bold text-gray-300">Visibility</th>
                  <th scope="col" class="font-bold text-gray-300">Actions</th>
                </tr>
              </thead>
              <tbody>
                <For each={sessions()}>
                  {(session) => (
                    <tr class="hover:bg-white/5 border-b border-white/5">
                      <td class="min-w-64 max-w-md">
                        <div class="font-bold text-white [overflow-wrap:anywhere]">{session.title}</div>
                        <div class="text-xs font-mono text-base-content/60 break-all">{session.slug}</div>
                      </td>
                      <td class="text-sm text-base-content/70 font-mono whitespace-nowrap">
                        {formatStartsAt(session.starts_at)}
                      </td>
                      <td class="text-sm text-base-content/70 max-w-xs">
                        <span class="line-clamp-2 [overflow-wrap:anywhere]">
                        {(session.speakers?.length ?? 0) > 0
                          ? (session.speakers || []).map(speakerNameById).join(", ")
                          : "None"}
                        </span>
                      </td>
                      <td>
                        <Show
                          when={session.cfp_submission}
                          fallback={<span class="badge badge-ghost badge-sm font-mono">Manual</span>}
                        >
                          <span class="badge badge-secondary badge-sm font-mono">From CFP</span>
                        </Show>
                      </td>
                      <td>
                        <button
                          type="button"
                          class={`btn btn-xs font-mono ${session.published ? "btn-success" : "btn-ghost"}`}
                          disabled={busyId() !== null}
                          aria-pressed={session.published}
                          onClick={() => togglePublished(session)}
                        >
                          <Show when={busyId() === session.id} fallback={session.published ? "Published" : "Draft"}>
                            <span class="loading loading-spinner loading-xs" aria-hidden="true"></span>
                            Updating
                          </Show>
                        </button>
                      </td>
                      <td>
                        <div class="flex gap-1">
                          <button
                            type="button"
                            class="btn btn-xs btn-ghost font-mono"
                            onClick={() => loadSession(session)}
                          >
                            Edit
                          </button>
                          <a
                            href={`/sessions/${session.slug}`}
                            class="btn btn-xs btn-ghost"
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            Preview
                          </a>
                        </div>
                      </td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </div>
        </AdminDataPanel>
      </Show>
    </AdminPageShell>
  );
}
