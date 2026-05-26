import { createMemo, createResource, createSignal, For, Show } from "solid-js";
import { Icon } from "@iconify-icon/solid";
import {
  AdminDataPanel,
  AdminPageShell,
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
  try {
    return new Date(value).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return value;
  }
}

export default function AdminSessionsHub() {
  const { toast, showToast } = useAdminToast();
  const [busyId, setBusyId] = createSignal<string | null>(null);
  const [editingId, setEditingId] = createSignal<string | null>(null);
  const [showForm, setShowForm] = createSignal(false);
  const [sessionsError, setSessionsError] = createSignal<string | null>(null);
  const [speakerSearch, setSpeakerSearch] = createSignal("");

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
    setStartsAt(session.starts_at || "");
    setTrack(session.track || "");
    setRoom(session.room || "");
    setSelectedSpeakers(session.speakers || []);
    setSpeakerSearch("");
    setShowForm(true);
  };

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
    setSaving(true);
    const payload = {
      slug: slug() || slugify(title()),
      title: title(),
      abstract: abstract(),
      format: format(),
      starts_at: startsAt(),
      track: track(),
      room: room(),
      speakers: selectedSpeakers(),
    };

    const id = editingId();
    const res = id ? await adminUpdateSession(id, payload) : await adminCreateSession(payload);

    if (!res.success) {
      showToast("error", res.error || "Could not save session.");
    } else {
      showToast(
        "success",
        id
          ? `"${title()}" updated. Toggle Published when ready for the public site.`
          : `"${title()}" created as draft. Toggle Published when ready for the public site.`,
      );
      resetForm();
      await refetch();
    }
    setSaving(false);
  };

  const togglePublished = async (session: SessionRecord) => {
    setBusyId(session.id);
    const res = await adminSetSessionPublished(session.id, !session.published);
    if (!res.success) {
      showToast("error", res.error || "Could not update published state.");
    } else {
      showToast(
        "success",
        session.published
          ? `"${session.title}" is now a draft.`
          : `"${session.title}" is now published.`,
      );
      await refetch();
    }
    setBusyId(null);
  };

  const speakerNameById = (id: string) => {
    const sp = (speakers() || []).find((s) => s.id === id);
    return sp ? speakerDisplayName(sp) : id;
  };

  return (
    <AdminPageShell
      layoutTitle="Admin — Sessions"
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
            onSubmit={submit}
            class="glass-panel p-6 rounded-2xl border border-white/10 shadow-xl backdrop-blur-xl bg-black/40"
          >
            <div class="flex flex-wrap justify-between items-center gap-3 mb-4">
              <div>
                <h2 class="text-lg font-bold text-white">
                  {editingId() ? "Edit session" : "New session"}
                </h2>
                <p class="text-xs text-gray-500 font-mono mt-1">
                  Saves as draft. Toggle Published when ready for the public site.
                </p>
              </div>
              <button type="button" class="btn btn-ghost btn-sm font-mono" onClick={resetForm}>
                Cancel
              </button>
            </div>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <input
                class="input input-bordered bg-black/40"
                placeholder="Title *"
                required
                value={title()}
                onInput={(e) => setTitle(e.currentTarget.value)}
              />
              <input
                class="input input-bordered bg-black/40 font-mono"
                placeholder="Slug"
                value={slug()}
                onInput={(e) => setSlug(e.currentTarget.value)}
              />
              <input
                class="input input-bordered bg-black/40"
                placeholder="Format (e.g. 25+10)"
                value={format()}
                onInput={(e) => setFormat(e.currentTarget.value)}
              />
              <input
                type="datetime-local"
                class="input input-bordered bg-black/40 font-mono"
                value={startsAt()}
                onInput={(e) => setStartsAt(e.currentTarget.value)}
              />
              <input
                class="input input-bordered bg-black/40"
                placeholder="Track"
                value={track()}
                onInput={(e) => setTrack(e.currentTarget.value)}
              />
              <input
                class="input input-bordered bg-black/40"
                placeholder="Room"
                value={room()}
                onInput={(e) => setRoom(e.currentTarget.value)}
              />
              <textarea
                class="textarea textarea-bordered bg-black/40 md:col-span-2 min-h-32"
                placeholder="Public abstract *"
                required
                value={abstract()}
                onInput={(e) => setAbstract(e.currentTarget.value)}
              />
            </div>

            <Show when={speakers()}>
              <fieldset class="mt-4 border border-white/10 rounded-xl p-4">
                <legend class="text-xs font-mono text-gray-400 uppercase px-2">Speakers</legend>
                <p class="text-xs text-gray-500 font-mono mb-3">
                  Select one or more speakers for this session.
                  {selectedSpeakers().length > 0
                    ? ` ${selectedSpeakers().length} selected.`
                    : " None selected yet."}
                </p>
                <input
                  type="search"
                  class="input input-bordered input-sm bg-black/40 font-mono w-full mb-3"
                  placeholder="Filter speakers by name…"
                  value={speakerSearch()}
                  onInput={(e) => setSpeakerSearch(e.currentTarget.value)}
                />
                <div class="max-h-48 overflow-y-auto space-y-1 rounded-lg bg-black/20 p-2">
                  <Show
                    when={filteredSpeakers().length > 0}
                    fallback={
                      <p class="text-xs text-gray-500 font-mono p-2 text-center">
                        {speakerSearch()
                          ? "No speakers match your search."
                          : "No speaker profiles yet. Create speakers first."}
                      </p>
                    }
                  >
                    <For each={filteredSpeakers()}>
                      {(sp) => (
                        <label class="flex items-center gap-3 p-2 rounded-lg hover:bg-white/5 cursor-pointer">
                          <input
                            type="checkbox"
                            class="checkbox checkbox-sm checkbox-primary"
                            checked={selectedSpeakers().includes(sp.id)}
                            onChange={() => toggleSpeaker(sp.id)}
                          />
                          <span class="text-sm text-white">{speakerDisplayName(sp)}</span>
                          <span class="text-xs font-mono text-gray-500 ml-auto">{sp.slug}</span>
                        </label>
                      )}
                    </For>
                  </Show>
                </div>
              </fieldset>
            </Show>

            <div class="flex gap-2 mt-4">
              <button type="submit" class="btn btn-primary font-mono" disabled={saving()}>
                {saving() ? "Saving…" : editingId() ? "Update session" : "Create session"}
              </button>
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
            <Icon icon="ph:calendar-blank-bold" class="text-4xl text-gray-600 mb-4" />
            <p class="text-white font-bold mb-2">No sessions yet</p>
            <p class="text-sm text-gray-500 font-mono max-w-md mx-auto mb-4">
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
                <div class="bg-white/5 rounded-xl p-4 border border-white/10 space-y-3">
                  <div>
                    <div class="font-bold text-white">{session.title}</div>
                    <div class="text-xs font-mono text-gray-500">{session.slug}</div>
                    <div class="text-xs text-gray-400 mt-1">{formatStartsAt(session.starts_at)}</div>
                  </div>
                  <Show when={(session.speakers?.length ?? 0) > 0}>
                    <div class="text-xs font-mono text-gray-500">
                      {(session.speakers || []).map(speakerNameById).join(", ")}
                    </div>
                  </Show>
                  <div class="flex flex-wrap gap-2 pt-3 border-t border-white/5">
                    <button
                      type="button"
                      class={`btn btn-xs font-mono ${session.published ? "btn-success" : "btn-ghost"}`}
                      disabled={busyId() === session.id}
                      aria-pressed={session.published}
                      onClick={() => togglePublished(session)}
                    >
                      {session.published ? "Published" : "Draft"}
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
                </div>
              )}
            </For>
          </div>

          <div class="hidden md:block overflow-x-auto">
            <table class="table table-lg w-full">
              <thead>
                <tr class="text-white border-b border-white/10 bg-white/5">
                  <th class="font-bold text-gray-300">Title</th>
                  <th class="font-bold text-gray-300">Schedule</th>
                  <th class="font-bold text-gray-300">Speakers</th>
                  <th class="font-bold text-gray-300">Visibility</th>
                  <th class="font-bold text-gray-300">Actions</th>
                </tr>
              </thead>
              <tbody>
                <For each={sessions()}>
                  {(session) => (
                    <tr class="hover:bg-white/5 border-b border-white/5">
                      <td>
                        <div class="font-bold text-white">{session.title}</div>
                        <div class="text-xs font-mono text-gray-500">{session.slug}</div>
                      </td>
                      <td class="text-sm text-gray-400 font-mono">
                        {formatStartsAt(session.starts_at)}
                      </td>
                      <td class="text-sm text-gray-400 max-w-xs truncate">
                        {(session.speakers?.length ?? 0) > 0
                          ? (session.speakers || []).map(speakerNameById).join(", ")
                          : "None"}
                      </td>
                      <td>
                        <button
                          type="button"
                          class={`btn btn-xs font-mono ${session.published ? "btn-success" : "btn-ghost"}`}
                          disabled={busyId() === session.id}
                          aria-pressed={session.published}
                          onClick={() => togglePublished(session)}
                        >
                          {session.published ? "Published" : "Draft"}
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
