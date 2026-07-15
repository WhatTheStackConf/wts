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
  adminClearSessionLegacySchedule,
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
  const [selectedSpeakers, setSelectedSpeakers] = createSignal<string[]>([]);
  const [saving, setSaving] = createSignal(false);
  const [clearingLegacy, setClearingLegacy] = createSignal(false);

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

  const speakerNameById = (id: string) => {
    const sp = (speakers() || []).find((s) => s.id === id);
    return sp ? speakerDisplayName(sp) : id;
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

  const clearLegacySchedule = async () => {
    const session = editingSession();
    if (!session || clearingLegacy()) return;
    if (!window.confirm("Clear the legacy start time, track, and room fields? This cannot be undone.")) return;
    setClearingLegacy(true);
    try {
      const result = await adminClearSessionLegacySchedule(session.id);
      if (!result.success) {
        showToast("error", result.error || "Could not clear legacy schedule data.");
        return;
      }
      showToast("success", "Legacy schedule data cleared. The Agenda Slot remains canonical.");
      await refetch();
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : "Could not clear legacy schedule data.");
    } finally {
      setClearingLegacy(false);
    }
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
        <>
          <a href="/admin/speakers" class="btn btn-outline btn-primary font-mono">
            Speakers
          </a>
          <a href="/admin/agenda" class="btn btn-outline btn-secondary font-mono">
            Agenda
          </a>
        </>
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

              <AdminFormSection title="Format" description="Optional public format label.">
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4 lg:gap-5">
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
                </div>
              </AdminFormSection>

              <AdminFormSection
                title="Legacy schedule migration data"
                description="These historical Session fields are read-only. Configure canonical Day, Track, time range, and location in Agenda."
              >
                <Show
                  when={editingSession()}
                  fallback={<p class="text-sm text-base-content/60 font-mono">Save the Session, then configure its schedule in Agenda.</p>}
                >
                  {(session) => (
                    <>
                      <dl class="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm font-mono">
                        <div class="rounded-lg border border-white/10 bg-black/20 p-3">
                          <dt class="text-xs uppercase tracking-[0.1em] text-base-content/55">Starts at</dt>
                          <dd class="mt-1 text-base-content/85 break-words">{session().starts_at || "None"}</dd>
                        </div>
                        <div class="rounded-lg border border-white/10 bg-black/20 p-3">
                          <dt class="text-xs uppercase tracking-[0.1em] text-base-content/55">Track</dt>
                          <dd class="mt-1 text-base-content/85 break-words">{session().track || "None"}</dd>
                        </div>
                        <div class="rounded-lg border border-white/10 bg-black/20 p-3">
                          <dt class="text-xs uppercase tracking-[0.1em] text-base-content/55">Room</dt>
                          <dd class="mt-1 text-base-content/85 break-words">{session().room || "None"}</dd>
                        </div>
                      </dl>
                      <Show when={session().starts_at || session().track || session().room}>
                        <button type="button" class="btn btn-xs btn-outline btn-warning mt-3 font-mono" disabled={clearingLegacy()} onClick={clearLegacySchedule}>
                          <Show when={clearingLegacy()} fallback="Clear legacy schedule data">
                            <span class="loading loading-spinner loading-xs" aria-hidden="true" />
                            Clearing...
                          </Show>
                        </button>
                      </Show>
                    </>
                  )}
                </Show>
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
                    <div class="text-xs text-base-content/70 mt-1">Schedule managed in Agenda</div>
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
                      <Show
                        when={busyId() === session.id}
                        fallback={<Show when={session.published} fallback="Draft">Published</Show>}
                      >
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
                    <a href="/admin/agenda" class="btn btn-xs btn-ghost font-mono">
                      Agenda
                    </a>
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
                        <a href="/admin/agenda" class="link link-hover text-secondary-300">
                          Manage in Agenda
                        </a>
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
                          <Show
                            when={busyId() === session.id}
                            fallback={<Show when={session.published} fallback="Draft">Published</Show>}
                          >
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
                          <a href="/admin/agenda" class="btn btn-xs btn-ghost font-mono">
                            Agenda
                          </a>
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
