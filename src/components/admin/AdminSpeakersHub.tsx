import { createResource, createSignal, For, Show } from "solid-js";
import { Icon } from "@iconify-icon/solid";
import {
  AdminDataPanel,
  AdminFilterBar,
  AdminFilterGroup,
  AdminFormField,
  AdminFormSection,
  AdminPageShell,
  adminFileInputClass,
  adminFilterButtonClass,
  adminFormPanelClass,
  adminInputClass,
  adminTextareaClass,
  clearAdminControlValidity,
  markAdminControlInvalid,
  syncAdminControlValidity,
  useAdminToast,
} from "~/components/admin/AdminPageShell";
import {
  adminCreateInviteSpeaker,
  adminPublishFromApplicant,
  adminFetchAcceptedApplicantsWithoutSpeaker,
  adminFetchSpeakers,
  adminSetSpeakerPublished,
  type InviteSpeakerPhotoPayload,
} from "~/lib/admin-actions";
import type { SpeakerRecord } from "~/lib/pocketbase-types";
import { slugify } from "~/lib/conference-slug";

type SpeakerRow = SpeakerRecord & {
  expand?: {
    cfp_applicant?: { expand?: { user?: { name?: string; email?: string } } };
    user?: { name?: string; email?: string };
  };
};

const ORIGIN_OPTIONS = [
  { value: "all" as const, label: "All" },
  { value: "cfp" as const, label: "CFP" },
  { value: "invite" as const, label: "Invited" },
];

const VISIBILITY_OPTIONS = [
  { value: "all" as const, label: "All" },
  { value: "yes" as const, label: "Published" },
  { value: "no" as const, label: "Draft" },
];

function speakerLabel(row: SpeakerRow): string {
  if (row.display_name) return row.display_name;
  if (row.origin === "cfp") {
    return (
      row.expand?.cfp_applicant?.expand?.user?.name ||
      row.expand?.user?.name ||
      row.slug
    );
  }
  return row.display_name || row.slug;
}

export default function AdminSpeakersHub() {
  const { toast, showToast } = useAdminToast();
  const [originFilter, setOriginFilter] = createSignal<"all" | "cfp" | "invite">("all");
  const [publishedFilter, setPublishedFilter] = createSignal<"all" | "yes" | "no">("all");
  const [busyId, setBusyId] = createSignal<string | null>(null);
  const [showInviteForm, setShowInviteForm] = createSignal(false);

  const [speakersError, setSpeakersError] = createSignal<string | null>(null);
  const [pendingError, setPendingError] = createSignal<string | null>(null);
  const [pendingWarning, setPendingWarning] = createSignal<string | null>(null);

  const [speakers, { refetch }] = createResource(async () => {
    const res = await adminFetchSpeakers();
    if (!res.success) {
      setSpeakersError(res.error || "Could not load speakers.");
      return [] as SpeakerRow[];
    }
    setSpeakersError(null);
    return res.data as SpeakerRow[];
  });

  const [pendingApplicants, { refetch: refetchPending }] = createResource(async () => {
    const res = await adminFetchAcceptedApplicantsWithoutSpeaker();
    if (!res.success) {
      setPendingError(res.error || "Could not load accepted CFP applicants.");
      setPendingWarning(null);
      return [];
    }
    setPendingError(null);
    setPendingWarning(res.warning ?? null);
    return res.data;
  });

  const filtered = () => {
    let list = [...(speakers() || [])];
    const origin = originFilter();
    const pub = publishedFilter();
    if (origin !== "all") list = list.filter((s) => s.origin === origin);
    if (pub === "yes") list = list.filter((s) => s.published);
    if (pub === "no") list = list.filter((s) => !s.published);
    return list.sort((a, b) => speakerLabel(a).localeCompare(speakerLabel(b)));
  };

  const filtersActive = () => originFilter() !== "all" || publishedFilter() !== "all";

  const togglePublished = async (row: SpeakerRow) => {
    setBusyId(row.id);
    const res = await adminSetSpeakerPublished(row.id, !row.published);
    if (!res.success) {
      showToast("error", res.error || "Could not update published state.");
    } else {
      showToast(
        "success",
        row.published
          ? `"${speakerLabel(row)}" is now a draft.`
          : `"${speakerLabel(row)}" is now published.`,
      );
      await refetch();
    }
    setBusyId(null);
  };

  const createFromApplicant = async (applicantId: string) => {
    setBusyId(applicantId);
    try {
      const res = await adminPublishFromApplicant(applicantId);
      if (!res.success) showToast("error", res.error || "Could not create speaker profile.");
      else {
        showToast(
          "success",
          "Draft speaker profile created. Toggle Published when ready for the public site.",
        );
        await refetch();
        await refetchPending();
      }
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Could not create speaker profile.");
    } finally {
      setBusyId(null);
    }
  };

  const [inviteName, setInviteName] = createSignal("");
  const [inviteSlug, setInviteSlug] = createSignal("");
  const [inviteAffiliation, setInviteAffiliation] = createSignal("");
  const [inviteBio, setInviteBio] = createSignal("");
  const [inviteSocial, setInviteSocial] = createSignal("");
  const [invitePhoto, setInvitePhoto] = createSignal<File | null>(null);
  const [creatingInvite, setCreatingInvite] = createSignal(false);

  const readPhotoPayload = async (
    file: File | null,
  ): Promise<InviteSpeakerPhotoPayload | null> => {
    if (!file || file.size === 0) return null;
    if (file.size > 5 * 1024 * 1024) {
      throw new Error("Photo must be 5 MB or smaller.");
    }
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      throw new Error("Photo must be JPEG, PNG, or WebP.");
    }
    const data = Array.from(new Uint8Array(await file.arrayBuffer()));
    return { name: file.name, type: file.type, data };
  };

  const submitInvite = async (e: Event) => {
    e.preventDefault();
    const displayName = inviteName().trim();
    if (!displayName) {
      showToast("error", "Display name is required.");
      return;
    }

    setCreatingInvite(true);
    try {
      const handles = inviteSocial()
        .split("\n")
        .map((h) => h.trim())
        .filter(Boolean);
      const photo = await readPhotoPayload(invitePhoto());
      const res = await adminCreateInviteSpeaker({
        slug: inviteSlug() || slugify(displayName),
        display_name: displayName,
        affiliation: inviteAffiliation(),
        bio: inviteBio(),
        social_handles: handles,
        photo,
      });
      if (!res.success) {
        showToast("error", res.error || "Could not create invite speaker.");
        return;
      }
      setInviteName("");
      setInviteSlug("");
      setInviteAffiliation("");
      setInviteBio("");
      setInviteSocial("");
      setInvitePhoto(null);
      setShowInviteForm(false);
      const fileInput = document.getElementById("invite-speaker-photo") as HTMLInputElement | null;
      if (fileInput) fileInput.value = "";
      showToast(
        "success",
        `Draft profile for "${displayName}" created. Toggle Published when ready for the public site.`,
      );
      await refetch();
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Could not create invite speaker.");
    } finally {
      setCreatingInvite(false);
    }
  };

  const renderSpeakerRow = (row: SpeakerRow) => (
    <>
      <td class="font-bold text-white">{speakerLabel(row)}</td>
      <td class="font-mono text-sm text-gray-400">{row.slug}</td>
      <td>
        <span class="badge badge-ghost font-mono">
          {row.origin === "cfp" ? "CFP" : "Invited"}
        </span>
      </td>
      <td>
        <button
          type="button"
          class={`btn btn-xs font-mono ${row.published ? "btn-success" : "btn-ghost"}`}
          disabled={busyId() === row.id}
          aria-pressed={row.published}
          onClick={() => togglePublished(row)}
        >
          {row.published ? "Published" : "Draft"}
        </button>
      </td>
      <td>
        <a
          href={`/speakers/${row.slug}`}
          class="btn btn-xs btn-ghost"
          target="_blank"
          rel="noopener noreferrer"
        >
          Preview
        </a>
      </td>
    </>
  );

  return (
    <AdminPageShell
      layoutTitle="Admin: Speakers"
      layoutDescription="Manage conference speakers"
      title="Speakers"
      subtitle="Speaker profiles & publication"
      hint="Profiles start as drafts. Toggle Published to show on the public site."
      count={speakers()?.length}
      countLoading={speakers.loading}
      toast={toast()}
      headerActions={
        <a href="/admin/sessions" class="btn btn-outline btn-secondary font-mono">
          Sessions
        </a>
      }
    >
      <Show when={speakersError()}>
        <div class="alert alert-warning mb-6 font-mono text-sm" role="alert">
          <span>{speakersError()}</span>
        </div>
      </Show>

      <Show when={pendingError()}>
        <div class="alert alert-error mb-6 font-mono text-sm" role="alert">
          <span>{pendingError()}</span>
        </div>
      </Show>

      <Show when={pendingWarning() && !pendingError()}>
        <div class="alert alert-warning mb-6 font-mono text-sm" role="status">
          <span>{pendingWarning()}</span>
        </div>
      </Show>

      <div class="glass-panel p-6 rounded-2xl mb-8 border border-warning-500/20 shadow-xl backdrop-blur-xl bg-black/40">
        <div class="flex flex-wrap justify-between items-start gap-3 mb-4">
          <div>
            <h2 class="text-lg font-bold text-warning-300">
              Accepted CFP applicants without a profile
            </h2>
            <p class="text-xs text-gray-500 font-mono mt-1">
              Accept proposals on the leaderboard first, then create draft speaker profiles here.
            </p>
          </div>
          <a href="/admin/proposals" class="btn btn-xs btn-outline btn-warning font-mono">
            Proposals leaderboard
          </a>
        </div>

        <Show when={pendingApplicants.loading}>
          <div class="flex justify-center py-6">
            <span class="loading loading-spinner loading-md text-warning-400"></span>
          </div>
        </Show>

        <Show when={!pendingApplicants.loading && (pendingApplicants()?.length ?? 0) > 0}>
          <div class="space-y-3">
            <For each={pendingApplicants()}>
              {(item: any) => (
                <div class="flex flex-wrap justify-between items-center gap-3 bg-white/5 p-3 rounded-lg">
                  <div>
                    <div class="font-bold text-white">
                      {item.applicant?.expand?.user?.name || "Unknown"}
                    </div>
                    <div class="text-xs text-gray-500 font-mono">{item.submissionTitle}</div>
                  </div>
                  <button
                    type="button"
                    class="btn btn-sm btn-primary font-mono"
                    disabled={busyId() === item.applicantId}
                    onClick={() => createFromApplicant(item.applicantId)}
                  >
                    {busyId() === item.applicantId ? (
                      <span class="loading loading-spinner loading-xs"></span>
                    ) : (
                      "Create draft profile"
                    )}
                  </button>
                </div>
              )}
            </For>
          </div>
        </Show>

        <Show
          when={
            !pendingApplicants.loading &&
            (pendingApplicants()?.length ?? 0) === 0 &&
            !pendingError()
          }
        >
          <div class="rounded-lg border border-dashed border-white/10 bg-white/5 p-6 text-center">
            <p class="text-sm text-gray-300 mb-2">
              No accepted CFP applicants waiting for a speaker profile.
            </p>
            <p class="text-xs text-gray-500 font-mono">
              Review submissions on the proposals leaderboard and set status to{" "}
              <span class="text-success">Accepted</span>. Then create draft profiles from either
              page.
            </p>
          </div>
        </Show>
      </div>

      <div class="mb-8">
        <Show
          when={showInviteForm()}
          fallback={
            <button
              type="button"
              class="btn btn-primary font-mono gap-2"
              onClick={() => setShowInviteForm(true)}
            >
              <Icon icon="ph:user-plus-bold" />
              Invite speaker
            </button>
          }
        >
          <form
            onSubmit={submitInvite}
            class={adminFormPanelClass}
          >
            <div class="mb-6">
              <div>
                <h2 class="text-lg font-bold text-white">Invite speaker</h2>
                <p class="text-xs text-gray-500 font-mono mt-1">
                  Creates a draft profile. Toggle Published when ready for the public site.
                </p>
              </div>
            </div>
            <div class="space-y-6">
              <AdminFormSection
                title="Public identity"
                description="The public name, URL slug, and affiliation used on the speaker profile."
              >
                <div class="grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-5">
                  <AdminFormField
                    id="invite-speaker-name"
                    label="Display name"
                    required
                    hint="Public speaker name shown on the website."
                    error="Add a display name before creating the profile."
                    class="lg:col-span-7"
                  >
                    <input
                      id="invite-speaker-name"
                      name="display_name"
                      class={adminInputClass()}
                      required
                      autocomplete="name"
                      aria-describedby="invite-speaker-name-hint"
                      aria-errormessage="invite-speaker-name-error"
                      value={inviteName()}
                      onInvalid={markAdminControlInvalid}
                      onBlur={syncAdminControlValidity}
                      onInput={(e) => {
                        clearAdminControlValidity(e);
                        setInviteName(e.currentTarget.value);
                      }}
                    />
                  </AdminFormField>

                  <AdminFormField
                    id="invite-speaker-slug"
                    label="Slug"
                    hint="Leave blank to generate it from the display name."
                    class="lg:col-span-5"
                  >
                    <input
                      id="invite-speaker-slug"
                      name="slug"
                      class={adminInputClass("font-mono")}
                      autocomplete="off"
                      placeholder="ada-lovelace"
                      value={inviteSlug()}
                      onInput={(e) => setInviteSlug(e.currentTarget.value)}
                    />
                  </AdminFormField>

                  <AdminFormField id="invite-speaker-affiliation" label="Affiliation" class="lg:col-span-12">
                    <input
                      id="invite-speaker-affiliation"
                      name="affiliation"
                      class={adminInputClass()}
                      autocomplete="organization"
                      placeholder="Company, project, or community"
                      value={inviteAffiliation()}
                      onInput={(e) => setInviteAffiliation(e.currentTarget.value)}
                    />
                  </AdminFormField>
                </div>
              </AdminFormSection>

              <AdminFormSection
                title="Profile content"
                description="Public profile content. Keep CFP review context out of these fields."
              >
                <div class="space-y-4">
                  <AdminFormField id="invite-speaker-bio" label="Bio">
                    <textarea
                      id="invite-speaker-bio"
                      name="bio"
                      class={adminTextareaClass("min-h-36")}
                      value={inviteBio()}
                      onInput={(e) => setInviteBio(e.currentTarget.value)}
                    />
                  </AdminFormField>

                  <div class="grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-5 items-start">
                    <AdminFormField
                      id="invite-speaker-social"
                      label="Social URLs"
                      hint="One URL per line."
                      class="lg:col-span-7"
                    >
                      <textarea
                        id="invite-speaker-social"
                        name="social_urls"
                        class={adminTextareaClass("min-h-24 font-mono text-sm")}
                        aria-describedby="invite-speaker-social-hint"
                        placeholder="https://example.com"
                        value={inviteSocial()}
                        onInput={(e) => setInviteSocial(e.currentTarget.value)}
                      />
                    </AdminFormField>

                    <AdminFormField
                      id="invite-speaker-photo"
                      label="Profile photo"
                      hint="JPEG, PNG, or WebP. Max 5 MB."
                      class="lg:col-span-5"
                    >
                      <input
                        id="invite-speaker-photo"
                        name="photo"
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        class={adminFileInputClass("font-mono text-sm")}
                        aria-describedby="invite-speaker-photo-hint"
                        onChange={(e) => setInvitePhoto(e.currentTarget.files?.[0] ?? null)}
                      />
                    </AdminFormField>
                  </div>
                </div>
              </AdminFormSection>
            </div>

            <div class="mt-6 border-t border-white/10 pt-5 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3">
              <p class="text-xs text-base-content/45 font-mono">
                Invite speakers are created as drafts until you publish them from the list.
              </p>
              <div class="flex flex-wrap gap-2 sm:justify-end">
                <button
                  type="button"
                  class="btn btn-ghost font-mono"
                  onClick={() => setShowInviteForm(false)}
                >
                  Cancel
                </button>
                <button type="submit" class="btn btn-primary font-mono" disabled={creatingInvite()}>
                  {creatingInvite() ? "Creating..." : "Create draft profile"}
                </button>
              </div>
            </div>
          </form>
        </Show>
      </div>

      <AdminFilterBar
        showCount={filtersActive()}
        filteredCount={filtered().length}
        totalCount={speakers()?.length}
      >
        <AdminFilterGroup label="Origin:">
          <For each={ORIGIN_OPTIONS}>
            {(opt) => (
              <button
                type="button"
                class={adminFilterButtonClass(originFilter() === opt.value)}
                onClick={() => setOriginFilter(opt.value)}
              >
                {opt.label}
              </button>
            )}
          </For>
        </AdminFilterGroup>
        <AdminFilterGroup label="Visibility:">
          <For each={VISIBILITY_OPTIONS}>
            {(opt) => (
              <button
                type="button"
                class={adminFilterButtonClass(publishedFilter() === opt.value, "secondary")}
                onClick={() => setPublishedFilter(opt.value)}
              >
                {opt.label}
              </button>
            )}
          </For>
        </AdminFilterGroup>
      </AdminFilterBar>

      <Show when={speakers.loading}>
        <div class="flex justify-center py-16">
          <span class="loading loading-bars loading-lg text-primary-500"></span>
        </div>
      </Show>

      <Show when={!speakers.loading && filtered().length === 0}>
        <AdminDataPanel>
          <div class="p-12 text-center">
            <Icon icon="ph:microphone-stage-bold" class="text-4xl text-gray-600 mb-4" />
            <p class="text-white font-bold mb-2">
              {filtersActive() ? "No speakers match these filters" : "No speaker profiles yet"}
            </p>
            <p class="text-sm text-gray-500 font-mono max-w-md mx-auto">
              {filtersActive()
                ? "Try changing the origin or visibility filters above."
                : "Create draft profiles from accepted CFP applicants or invite a speaker directly."}
            </p>
            <Show when={!filtersActive() && !showInviteForm()}>
              <button
                type="button"
                class="btn btn-primary btn-sm font-mono mt-4"
                onClick={() => setShowInviteForm(true)}
              >
                Invite speaker
              </button>
            </Show>
          </div>
        </AdminDataPanel>
      </Show>

      <Show when={!speakers.loading && filtered().length > 0}>
        <AdminDataPanel>
          <div class="md:hidden space-y-4 p-4">
            <For each={filtered()}>
              {(row) => (
                <div class="bg-white/5 rounded-xl p-4 border border-white/10 space-y-3">
                  <div class="flex justify-between items-start gap-2">
                    <div>
                      <div class="font-bold text-white">{speakerLabel(row)}</div>
                      <div class="text-xs font-mono text-gray-500">{row.slug}</div>
                    </div>
                    <span class="badge badge-ghost font-mono text-xs">
                      {row.origin === "cfp" ? "CFP" : "Invited"}
                    </span>
                  </div>
                  <div class="flex justify-between items-center pt-3 border-t border-white/5">
                    <button
                      type="button"
                      class={`btn btn-xs font-mono ${row.published ? "btn-success" : "btn-ghost"}`}
                      disabled={busyId() === row.id}
                      aria-pressed={row.published}
                      onClick={() => togglePublished(row)}
                    >
                      {row.published ? "Published" : "Draft"}
                    </button>
                    <a
                      href={`/speakers/${row.slug}`}
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
                  <th class="font-bold text-gray-300">Name</th>
                  <th class="font-bold text-gray-300">Slug</th>
                  <th class="font-bold text-gray-300">Origin</th>
                  <th class="font-bold text-gray-300">Visibility</th>
                  <th class="font-bold text-gray-300">Actions</th>
                </tr>
              </thead>
              <tbody>
                <For each={filtered()}>{(row) => <tr class="hover:bg-white/5">{renderSpeakerRow(row)}</tr>}</For>
              </tbody>
            </table>
          </div>
        </AdminDataPanel>
      </Show>
    </AdminPageShell>
  );
}
