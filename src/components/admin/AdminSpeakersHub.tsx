import { createEffect, createResource, createSignal, For, onCleanup, Show } from "solid-js";
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
  adminUpdateSpeakerProfile,
  type SpeakerProfileUpdateInput,
} from "~/lib/admin-actions";
import type { SpeakerRecord } from "~/lib/pocketbase-types";
import { slugify } from "~/lib/conference-slug";
import { speakerFileToPhotoPayload } from "~/lib/admin-speaker-profile";
import { getPbFileUrl } from "~/lib/pocketbase-public-url";

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

function speakerSocialText(raw: unknown): string {
  if (Array.isArray(raw)) {
    return raw.filter((value): value is string => typeof value === "string").join("\n");
  }

  if (typeof raw !== "string") return "";

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((value): value is string => typeof value === "string").join("\n");
    }
  } catch {
    // PocketBase JSON fields normally arrive as arrays; keep plain strings editable if present.
  }

  return raw;
}

function speakerPhotoUrl(row: SpeakerRow): string {
  return row.photo ? getPbFileUrl("speakers", row.id, row.photo) : "";
}

function reducedMotionPreferred(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

export default function AdminSpeakersHub() {
  const { toast, showToast } = useAdminToast();
  const [originFilter, setOriginFilter] = createSignal<"all" | "cfp" | "invite">("all");
  const [publishedFilter, setPublishedFilter] = createSignal<"all" | "yes" | "no">("all");
  const [busyId, setBusyId] = createSignal<string | null>(null);
  const [showInviteForm, setShowInviteForm] = createSignal(false);
  const [editingSpeaker, setEditingSpeaker] = createSignal<SpeakerRow | null>(null);

  const [speakersError, setSpeakersError] = createSignal<string | null>(null);
  const [pendingError, setPendingError] = createSignal<string | null>(null);
  const [pendingWarning, setPendingWarning] = createSignal<string | null>(null);

  const [editName, setEditName] = createSignal("");
  const [editSlug, setEditSlug] = createSignal("");
  const [editAffiliation, setEditAffiliation] = createSignal("");
  const [editBio, setEditBio] = createSignal("");
  const [editSocial, setEditSocial] = createSignal("");
  const [editPhoto, setEditPhoto] = createSignal<File | null>(null);
  const [editRemovePhoto, setEditRemovePhoto] = createSignal(false);
  const [editPhotoPreview, setEditPhotoPreview] = createSignal<string | null>(null);
  const [editSaving, setEditSaving] = createSignal(false);
  const [editError, setEditError] = createSignal<string | null>(null);
  const [editNameError, setEditNameError] = createSignal("Add a display name before saving.");
  const [editSlugError, setEditSlugError] = createSignal("Add a slug before saving.");
  const [editPhotoError, setEditPhotoError] = createSignal("");

  let editFormPanel: HTMLFormElement | undefined;
  let editNameInput: HTMLInputElement | undefined;
  let editSlugInput: HTMLInputElement | undefined;
  let editPhotoInput: HTMLInputElement | undefined;

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

  createEffect(() => {
    const file = editPhoto();
    if (!file) {
      setEditPhotoPreview(null);
      return;
    }

    const url = URL.createObjectURL(file);
    setEditPhotoPreview(url);
    onCleanup(() => URL.revokeObjectURL(url));
  });

  const editCurrentPhotoUrl = () => {
    const row = editingSpeaker();
    if (!row || !row.photo || editRemovePhoto()) return "";
    return speakerPhotoUrl(row);
  };

  const editPreviewPhotoUrl = () => {
    if (editRemovePhoto()) return "";
    return editPhotoPreview() || editCurrentPhotoUrl();
  };

  const editPhotoStateText = () => {
    const selected = editPhoto();
    const row = editingSpeaker();
    if (editRemovePhoto()) return "Photo will be removed when you save.";
    if (selected) return `Replacement selected: ${selected.name}`;
    if (row?.photo) return "Current public Speaker photo.";
    return "No public Speaker photo yet.";
  };

  const clearEditFieldErrors = () => {
    setEditError(null);
    setEditNameError("Add a display name before saving.");
    setEditSlugError("Add a slug before saving.");
    setEditPhotoError("");
    for (const input of [editNameInput, editSlugInput, editPhotoInput]) {
      input?.setCustomValidity("");
      input?.removeAttribute("aria-invalid");
    }
  };

  const resetEditFileInput = () => {
    if (editPhotoInput) editPhotoInput.value = "";
  };

  const clearEditForm = () => {
    setEditingSpeaker(null);
    setEditName("");
    setEditSlug("");
    setEditAffiliation("");
    setEditBio("");
    setEditSocial("");
    setEditPhoto(null);
    setEditRemovePhoto(false);
    clearEditFieldErrors();
    resetEditFileInput();
  };

  const startEdit = (row: SpeakerRow) => {
    setShowInviteForm(false);
    setEditingSpeaker(row);
    setEditName(row.display_name || speakerLabel(row));
    setEditSlug(row.slug || "");
    setEditAffiliation(row.affiliation || "");
    setEditBio(row.bio || "");
    setEditSocial(speakerSocialText(row.social_handles));
    setEditPhoto(null);
    setEditRemovePhoto(false);
    clearEditFieldErrors();
    resetEditFileInput();
    window.requestAnimationFrame(() => {
      editFormPanel?.scrollIntoView({
        behavior: reducedMotionPreferred() ? "auto" : "smooth",
        block: "start",
      });
    });
  };

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
    if (busyId()) return;
    setBusyId(row.id);
    try {
      const res = await adminSetSpeakerPublished(row.id, !row.published);
      if (!res.success) {
        showToast("error", res.error || "Could not update published state.");
        return;
      }
      showToast(
        "success",
        row.published
          ? `"${speakerLabel(row)}" is now a draft.`
          : `"${speakerLabel(row)}" is now published.`,
      );
      await refetch();
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Could not update published state.");
    } finally {
      setBusyId(null);
    }
  };

  const createFromApplicant = async (applicantId: string) => {
    if (busyId()) return;
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
  const [invitePhotoError, setInvitePhotoError] = createSignal("");
  const [creatingInvite, setCreatingInvite] = createSignal(false);
  let invitePhotoInput: HTMLInputElement | undefined;

  const submitInvite = async (e: Event) => {
    e.preventDefault();
    if (creatingInvite()) return;
    const displayName = inviteName().trim();
    if (!displayName) {
      showToast("error", "Display name is required.");
      return;
    }

    setCreatingInvite(true);
    setInvitePhotoError("");
    invitePhotoInput?.setCustomValidity("");
    invitePhotoInput?.removeAttribute("aria-invalid");
    try {
      const handles = inviteSocial()
        .split("\n")
        .map((h) => h.trim())
        .filter(Boolean);
      const photo = await speakerFileToPhotoPayload(invitePhoto());
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
      setInvitePhotoError("");
      setShowInviteForm(false);
      const fileInput = document.getElementById("invite-speaker-photo") as HTMLInputElement | null;
      if (fileInput) fileInput.value = "";
      showToast(
        "success",
        `Draft profile for "${displayName}" created. Toggle Published when ready for the public site.`,
      );
      await refetch();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not create invite speaker.";
      const lower = message.toLowerCase();
      if (
        lower.includes("photo") ||
        lower.includes("jpeg") ||
        lower.includes("png") ||
        lower.includes("webp") ||
        lower.includes("5 mb")
      ) {
        setInvitePhotoError(message);
        invitePhotoInput?.setCustomValidity(message);
        invitePhotoInput?.setAttribute("aria-invalid", "true");
      }
      showToast("error", message);
    } finally {
      setCreatingInvite(false);
    }
  };

  const applyEditError = (message: string) => {
    const lower = message.toLowerCase();
    setEditError(message);

    if (lower.includes("slug")) {
      setEditSlugError(message);
      editSlugInput?.setCustomValidity(message);
      editSlugInput?.setAttribute("aria-invalid", "true");
      return;
    }

    if (lower.includes("display") || lower.includes("name")) {
      setEditNameError(message);
      editNameInput?.setCustomValidity(message);
      editNameInput?.setAttribute("aria-invalid", "true");
      return;
    }

    if (lower.includes("photo") || lower.includes("jpeg") || lower.includes("png") || lower.includes("webp")) {
      setEditPhotoError(message);
      editPhotoInput?.setCustomValidity(message);
      editPhotoInput?.setAttribute("aria-invalid", "true");
    }
  };

  const submitEdit = async (e: Event) => {
    e.preventDefault();
    const row = editingSpeaker();
    if (!row) return;

    clearEditFieldErrors();
    setEditSaving(true);
    try {
      const handles = editSocial()
        .split("\n")
        .map((handle) => handle.trim())
        .filter(Boolean);
      const photoPayload = await speakerFileToPhotoPayload(editPhoto());
      const photo: SpeakerProfileUpdateInput["photo"] = photoPayload
        ? { intent: "replace", file: photoPayload }
        : editRemovePhoto()
          ? { intent: "remove" }
          : { intent: "keep" };

      const res = await adminUpdateSpeakerProfile(row.id, {
        display_name: editName(),
        slug: editSlug(),
        affiliation: editAffiliation(),
        bio: editBio(),
        social_handles: handles,
        photo,
      });

      if (!res.success) {
        const message = res.error || "Could not save speaker profile.";
        applyEditError(message);
        showToast("error", message);
        return;
      }

      const savedName = editName().trim();
      clearEditForm();
      showToast("success", `"${savedName}" updated.`);
      await refetch();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not save speaker profile.";
      applyEditError(message);
      showToast("error", message);
    } finally {
      setEditSaving(false);
    }
  };

  const renderSpeakerRow = (row: SpeakerRow) => (
    <>
      <td class="min-w-56 max-w-sm">
        <div class="font-bold text-white [overflow-wrap:anywhere]">{speakerLabel(row)}</div>
      </td>
      <td class="max-w-64 break-all font-mono text-sm text-base-content/70">{row.slug}</td>
      <td>
        <span class="badge badge-ghost font-mono">
          {row.origin === "cfp" ? "CFP" : "Invited"}
        </span>
      </td>
      <td>
        <button
          type="button"
          class={`btn btn-xs font-mono ${row.published ? "btn-success" : "btn-ghost"}`}
          disabled={busyId() !== null}
          aria-pressed={row.published}
          onClick={() => togglePublished(row)}
        >
          <Show when={busyId() === row.id} fallback={row.published ? "Published" : "Draft"}>
            <span class="loading loading-spinner loading-xs" aria-hidden="true"></span>
            Updating
          </Show>
        </button>
      </td>
      <td>
        <div class="flex flex-wrap gap-2">
          <button
            type="button"
            class={`btn btn-xs font-mono ${editingSpeaker()?.id === row.id ? "btn-primary" : "btn-ghost"}`}
            aria-expanded={editingSpeaker()?.id === row.id}
            aria-controls="speaker-profile-edit-form"
            onClick={() => startEdit(row)}
          >
            Edit
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
          <Icon icon="ph:warning-circle-bold" aria-hidden="true" />
          <span>{speakersError()}</span>
        </div>
      </Show>

      <Show when={pendingError()}>
        <div class="alert alert-error mb-6 font-mono text-sm" role="alert">
          <Icon icon="ph:warning-circle-bold" aria-hidden="true" />
          <span>{pendingError()}</span>
        </div>
      </Show>

      <Show when={pendingWarning() && !pendingError()}>
        <div class="alert alert-warning mb-6 font-mono text-sm" role="status">
          <Icon icon="ph:info-bold" aria-hidden="true" />
          <span>{pendingWarning()}</span>
        </div>
      </Show>

      <div class="glass-panel p-6 rounded-2xl mb-8 border border-warning-500/20 shadow-xl backdrop-blur-xl bg-black/40">
        <div class="flex flex-wrap justify-between items-start gap-3 mb-4">
          <div>
            <h2 class="text-lg font-bold text-warning-300">
              Accepted CFP applicants without a profile
            </h2>
            <p class="text-xs text-base-content/60 font-mono mt-1 max-w-3xl leading-relaxed text-pretty">
              Speaker-only escape hatch: create standalone draft Speaker profiles here. Promoting
              an accepted proposal from the leaderboard creates or reuses the Speaker automatically.
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
                  <div class="min-w-0">
                    <div class="font-bold text-white [overflow-wrap:anywhere]">
                      {item.applicant?.expand?.user?.name || "Unknown"}
                    </div>
                    <div class="text-xs text-base-content/60 font-mono [overflow-wrap:anywhere]">
                      Accepted proposal: {item.submissionTitle}
                    </div>
                  </div>
                  <button
                    type="button"
                    class="btn btn-sm btn-primary font-mono"
                    disabled={busyId() !== null}
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
            <p class="text-sm text-gray-200 mb-2">
              No accepted CFP applicants waiting for a speaker profile.
            </p>
            <p class="text-xs text-base-content/60 font-mono max-w-3xl mx-auto leading-relaxed text-pretty">
              Review submissions on the proposals leaderboard and set status to{" "}
              <span class="text-success">Accepted</span>. Use this panel only for standalone
              Speaker profiles; create draft Sessions from the proposal row.
            </p>
          </div>
        </Show>
      </div>

      <div class="mb-8">
        <Show when={editingSpeaker()}>
          {(row) => (
            <form
              id="speaker-profile-edit-form"
              ref={(el) => (editFormPanel = el)}
              onSubmit={submitEdit}
              class={adminFormPanelClass}
            >
              <div class="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h2 class="text-lg font-bold text-white">Edit speaker</h2>
                  <p class="text-xs text-base-content/60 font-mono mt-1 leading-relaxed">
                    Updates the public Speaker snapshot. CFP source data is not changed.
                  </p>
                </div>
                <div class="flex flex-wrap gap-2">
                  <span class={`badge font-mono ${row().published ? "badge-success" : "badge-ghost"}`}>
                    {row().published ? "Published" : "Draft"}
                  </span>
                  <a
                    href={`/speakers/${row().slug}`}
                    class="btn btn-xs btn-ghost"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Preview
                  </a>
                </div>
              </div>

              <Show when={editError()}>
                <div class="alert alert-error mb-6 font-mono text-sm" role="alert">
                  <span>{editError()}</span>
                </div>
              </Show>

              <div class="grid grid-cols-1 gap-6 lg:grid-cols-12 lg:items-start">
                <div class="space-y-6 lg:order-2 lg:col-span-5">
                  <AdminFormSection
                    title="Photo"
                    description="Manage the public Speaker photo stored on this Speaker record."
                  >
                    <div class="space-y-4">
                      <div class="rounded-2xl border border-white/10 bg-white/5 p-4">
                        <Show
                          when={editPreviewPhotoUrl()}
                          fallback={
                            <div class="flex aspect-square max-h-64 min-h-44 items-center justify-center rounded-xl border border-dashed border-white/15 bg-black/30 text-center text-xs font-mono text-base-content/45">
                              No photo preview
                            </div>
                          }
                        >
                          {(url) => (
                            <img
                              src={url()}
                              alt={`${editName() || row().slug} profile photo preview`}
                              class="aspect-square max-h-64 w-full rounded-xl object-cover"
                            />
                          )}
                        </Show>
                        <p class="mt-3 text-xs font-mono text-base-content/65 break-all">
                          {editPhotoStateText()}
                        </p>
                      </div>

                      <AdminFormField
                        id="edit-speaker-photo"
                        label="Replacement photo"
                        hint="JPEG, PNG, or WebP. Max 5 MB."
                        error={editPhotoError()}
                      >
                        <input
                          ref={(el) => (editPhotoInput = el)}
                          id="edit-speaker-photo"
                          name="photo"
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          class={adminFileInputClass("font-mono text-sm")}
                          aria-describedby="edit-speaker-photo-hint"
                          aria-errormessage="edit-speaker-photo-error"
                          onChange={(e) => {
                            e.currentTarget.setCustomValidity("");
                            clearAdminControlValidity(e);
                            setEditPhotoError("");
                            const file = e.currentTarget.files?.[0] ?? null;
                            setEditPhoto(file);
                            if (file) setEditRemovePhoto(false);
                          }}
                        />
                      </AdminFormField>

                      <div class="flex flex-wrap gap-2">
                        <Show when={!editRemovePhoto() && (row().photo || editPhoto())}>
                          <button
                            type="button"
                            class="btn btn-sm btn-outline btn-error font-mono"
                            onClick={() => {
                              setEditPhoto(null);
                              setEditRemovePhoto(true);
                              resetEditFileInput();
                            }}
                          >
                            Remove photo
                          </button>
                        </Show>
                        <Show when={editRemovePhoto() && row().photo}>
                          <button
                            type="button"
                            class="btn btn-sm btn-ghost font-mono"
                            onClick={() => {
                              setEditRemovePhoto(false);
                              resetEditFileInput();
                            }}
                          >
                            Keep current photo
                          </button>
                        </Show>
                      </div>
                    </div>
                  </AdminFormSection>

                  <AdminFormSection
                    title="Source"
                    description="Read-only origin context for this public snapshot."
                  >
                    <div class="rounded-xl border border-white/10 bg-white/5 p-4">
                      <span class="badge badge-ghost font-mono">
                        {row().origin === "cfp" ? "CFP-origin copied snapshot" : "Invited"}
                      </span>
                      <Show
                        when={row().origin === "cfp"}
                        fallback={
                          <p class="mt-3 text-xs font-mono leading-relaxed text-base-content/65 text-pretty">
                            This Speaker was created directly in programme admin. Edits here only change
                            the public Speaker profile.
                          </p>
                        }
                      >
                        <p class="mt-3 text-xs font-mono leading-relaxed text-base-content/65 text-pretty">
                          CFP-origin data was copied once from the CFP Applicant/User into this public
                          Speaker snapshot. Edits here do not update CFP Applicant or User data, and
                          future CFP/User changes do not sync back.
                        </p>
                      </Show>
                      <Show
                        when={
                          row().expand?.cfp_applicant?.expand?.user?.name ||
                          row().expand?.user?.name ||
                          row().expand?.cfp_applicant?.expand?.user?.email ||
                          row().expand?.user?.email
                        }
                      >
                        <p class="mt-3 text-xs font-mono text-base-content/60 break-all">
                          Source user: {row().expand?.cfp_applicant?.expand?.user?.name || row().expand?.user?.name || "Unnamed"}
                          <Show when={row().expand?.cfp_applicant?.expand?.user?.email || row().expand?.user?.email}>
                            {(email) => <span> ({email()})</span>}
                          </Show>
                        </p>
                      </Show>
                    </div>
                  </AdminFormSection>
                </div>

                <div class="space-y-6 lg:order-1 lg:col-span-7">
                  <AdminFormSection
                    title="Public identity"
                    description="The public name, URL slug, and affiliation used on the speaker profile."
                  >
                    <div class="grid grid-cols-1 gap-4 lg:grid-cols-12 lg:gap-5">
                      <AdminFormField
                        id="edit-speaker-name"
                        label="Display name"
                        required
                        hint="Public speaker name shown on the website."
                        error={editNameError()}
                        class="lg:col-span-7"
                      >
                        <input
                          ref={(el) => (editNameInput = el)}
                          id="edit-speaker-name"
                          name="display_name"
                          class={adminInputClass()}
                          required
                          autocomplete="name"
                          aria-describedby="edit-speaker-name-hint"
                          aria-errormessage="edit-speaker-name-error"
                          value={editName()}
                          onInvalid={markAdminControlInvalid}
                          onBlur={syncAdminControlValidity}
                          onInput={(e) => {
                            e.currentTarget.setCustomValidity("");
                            clearAdminControlValidity(e);
                            setEditNameError("Add a display name before saving.");
                            setEditName(e.currentTarget.value);
                          }}
                        />
                      </AdminFormField>

                      <AdminFormField
                        id="edit-speaker-slug"
                        label="Slug"
                        required
                        hint="Public URL segment, for example ada-lovelace."
                        error={editSlugError()}
                        class="lg:col-span-5"
                      >
                        <input
                          ref={(el) => (editSlugInput = el)}
                          id="edit-speaker-slug"
                          name="slug"
                          class={adminInputClass("font-mono")}
                          required
                          autocomplete="off"
                          placeholder="ada-lovelace"
                          aria-describedby="edit-speaker-slug-hint"
                          aria-errormessage="edit-speaker-slug-error"
                          value={editSlug()}
                          onInvalid={markAdminControlInvalid}
                          onBlur={syncAdminControlValidity}
                          onInput={(e) => {
                            e.currentTarget.setCustomValidity("");
                            clearAdminControlValidity(e);
                            setEditSlugError("Add a slug before saving.");
                            setEditSlug(e.currentTarget.value);
                          }}
                        />
                      </AdminFormField>

                      <AdminFormField id="edit-speaker-affiliation" label="Affiliation" class="lg:col-span-12">
                        <input
                          id="edit-speaker-affiliation"
                          name="affiliation"
                          class={adminInputClass()}
                          autocomplete="organization"
                          placeholder="Company, project, or community"
                          value={editAffiliation()}
                          onInput={(e) => setEditAffiliation(e.currentTarget.value)}
                        />
                      </AdminFormField>
                    </div>
                  </AdminFormSection>

                  <AdminFormSection
                    title="Profile content"
                    description="Public profile content. Keep CFP review context out of these fields."
                  >
                    <div class="space-y-4">
                      <AdminFormField id="edit-speaker-bio" label="Bio">
                        <textarea
                          id="edit-speaker-bio"
                          name="bio"
                          class={adminTextareaClass("min-h-36")}
                          value={editBio()}
                          onInput={(e) => setEditBio(e.currentTarget.value)}
                        />
                      </AdminFormField>

                      <AdminFormField
                        id="edit-speaker-social"
                        label="Social URLs"
                        hint="One URL or handle per line. Blank lines are ignored on save."
                      >
                        <textarea
                          id="edit-speaker-social"
                          name="social_urls"
                          class={adminTextareaClass("min-h-28 font-mono text-sm")}
                          aria-describedby="edit-speaker-social-hint"
                          placeholder="https://example.com"
                          value={editSocial()}
                          onInput={(e) => setEditSocial(e.currentTarget.value)}
                        />
                      </AdminFormField>
                    </div>
                  </AdminFormSection>
                </div>
              </div>

              <div class="mt-6 border-t border-white/10 pt-5 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p class="text-xs text-base-content/45 font-mono">
                  Profile changes do not affect CFP Applicant/User data or publication state.
                </p>
                <div class="flex flex-wrap gap-2 sm:justify-end">
                  <button
                    type="button"
                    class="btn btn-ghost font-mono"
                    disabled={editSaving()}
                    onClick={clearEditForm}
                  >
                    Cancel
                  </button>
                  <button type="submit" class="btn btn-primary font-mono" disabled={editSaving()}>
                    <Show when={editSaving()} fallback="Save profile">
                      <span class="loading loading-spinner loading-xs" aria-hidden="true"></span>
                      Saving...
                    </Show>
                  </button>
                </div>
              </div>
            </form>
          )}
        </Show>

        <Show when={!editingSpeaker()}>
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
                <p class="text-xs text-base-content/60 font-mono mt-1 leading-relaxed">
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
                      error={invitePhotoError()}
                      class="lg:col-span-5"
                    >
                      <input
                        ref={(el) => (invitePhotoInput = el)}
                        id="invite-speaker-photo"
                        name="photo"
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        class={adminFileInputClass("font-mono text-sm")}
                        aria-describedby="invite-speaker-photo-hint"
                        aria-errormessage="invite-speaker-photo-error"
                        onChange={(e) => {
                          e.currentTarget.setCustomValidity("");
                          clearAdminControlValidity(e);
                          setInvitePhotoError("");
                          setInvitePhoto(e.currentTarget.files?.[0] ?? null);
                        }}
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
                  <Show when={creatingInvite()} fallback="Create draft profile">
                    <span class="loading loading-spinner loading-xs" aria-hidden="true"></span>
                    Creating...
                  </Show>
                </button>
              </div>
            </div>
          </form>
        </Show>
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
                aria-pressed={originFilter() === opt.value}
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
                aria-pressed={publishedFilter() === opt.value}
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
            <Icon icon="ph:microphone-stage-bold" class="text-4xl text-base-content/40 mb-4" aria-hidden="true" />
            <p class="text-white font-bold mb-2">
              {filtersActive() ? "No speakers match these filters" : "No speaker profiles yet"}
            </p>
            <p class="text-sm text-base-content/60 font-mono max-w-md mx-auto leading-relaxed text-pretty">
              {filtersActive()
                ? "Try changing the origin or visibility filters above."
                : "Create standalone draft Speaker profiles from accepted CFP applicants or invite a speaker directly."}
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
                <article class="bg-white/5 rounded-xl p-4 border border-white/10 space-y-3">
                  <div class="flex justify-between items-start gap-2">
                    <div class="min-w-0">
                      <h2 class="font-bold text-white [overflow-wrap:anywhere]">{speakerLabel(row)}</h2>
                      <div class="text-xs font-mono text-base-content/60 break-all">{row.slug}</div>
                    </div>
                    <span class="badge badge-ghost font-mono text-xs">
                      {row.origin === "cfp" ? "CFP" : "Invited"}
                    </span>
                  </div>
                  <div class="flex flex-wrap justify-between items-center gap-2 pt-3 border-t border-white/5">
                    <button
                      type="button"
                      class={`btn btn-xs font-mono ${row.published ? "btn-success" : "btn-ghost"}`}
                      disabled={busyId() !== null}
                      aria-pressed={row.published}
                      onClick={() => togglePublished(row)}
                    >
                      <Show when={busyId() === row.id} fallback={row.published ? "Published" : "Draft"}>
                        <span class="loading loading-spinner loading-xs" aria-hidden="true"></span>
                        Updating
                      </Show>
                    </button>
                    <div class="flex flex-wrap gap-2">
                      <button
                        type="button"
                        class={`btn btn-xs font-mono ${editingSpeaker()?.id === row.id ? "btn-primary" : "btn-ghost"}`}
                        aria-expanded={editingSpeaker()?.id === row.id}
                        aria-controls="speaker-profile-edit-form"
                        onClick={() => startEdit(row)}
                      >
                        Edit
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
                </article>
              )}
            </For>
          </div>

          <div class="hidden md:block overflow-x-auto">
            <table class="table table-lg w-full">
              <caption class="sr-only">Speaker profiles and publication state</caption>
              <thead>
                <tr class="text-white border-b border-white/10 bg-white/5">
                  <th scope="col" class="font-bold text-gray-300">Name</th>
                  <th scope="col" class="font-bold text-gray-300">Slug</th>
                  <th scope="col" class="font-bold text-gray-300">Origin</th>
                  <th scope="col" class="font-bold text-gray-300">Visibility</th>
                  <th scope="col" class="font-bold text-gray-300">Actions</th>
                </tr>
              </thead>
              <tbody>
                <For each={filtered()}>{(row) => <tr class="hover:bg-white/5 border-b border-white/5">{renderSpeakerRow(row)}</tr>}</For>
              </tbody>
            </table>
          </div>
        </AdminDataPanel>
      </Show>
    </AdminPageShell>
  );
}
