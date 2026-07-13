import { createResource, createSignal, For, onMount, Show } from "solid-js";
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
  adminSelectClass,
  adminTextareaClass,
  clearAdminControlValidity,
  markAdminControlInvalid,
  syncAdminControlValidity,
  useAdminToast,
} from "~/components/admin/AdminPageShell";
import {
  adminCreatePartner,
  adminDeletePartner,
  adminFetchPartnerHistory,
  adminFetchPartners,
  adminSetPartnerNoteApproval,
  adminSetPartnerPublished,
  adminUpdatePartner,
  type PartnerLogoPayload,
  type PartnerDraftInput,
  type PartnerPatch,
} from "~/lib/partner-administration-actions";
import type {
  PartnerAdminHistoryItem,
  PartnerAdminListItem,
  PartnerAdminSnapshot,
} from "~/lib/partner-administration";
import { getPbFileUrl } from "~/lib/pocketbase-public-url";
import type { PartnerRecord } from "~/lib/pocketbase-types";

type PartnerTypeFilter = PartnerRecord["type"] | "all";
type PartnerVisibilityFilter = "all" | "yes" | "no";

const PARTNER_TYPE_OPTIONS: { value: PartnerRecord["type"]; label: string }[] = [
  { value: "organizer", label: "Organizer" },
  { value: "sponsor", label: "Sponsor" },
  { value: "supporter", label: "Supporter" },
  { value: "community_partner", label: "Community Partner" },
  { value: "media", label: "Media" },
  { value: "catering", label: "Bytes and beverages" },
  { value: "other", label: "Other" },
];

const TIER_OPTIONS: { value: NonNullable<PartnerRecord["tier"]>; label: string }[] = [
  { value: "platinum", label: "Platinum" },
  { value: "gold", label: "Gold" },
  { value: "silver", label: "Silver" },
  { value: "bronze", label: "Bronze" },
];

const TYPE_FILTER_OPTIONS: { value: PartnerTypeFilter; label: string }[] = [
  { value: "all", label: "All" },
  ...PARTNER_TYPE_OPTIONS,
];

const VISIBILITY_OPTIONS: { value: PartnerVisibilityFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "yes", label: "Published" },
  { value: "no", label: "Draft" },
];

const PARTNER_OPERATION_IDS_STORAGE_KEY = "wts.admin.partner-operation-ids";

function typeLabel(value: PartnerRecord["type"]): string {
  return PARTNER_TYPE_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

function tierLabel(value?: PartnerRecord["tier"]): string {
  if (!value) return "No tier";
  return TIER_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

function historySummary(action: PartnerAdminHistoryItem): Record<string, unknown> {
  const after = action.afterSummary;
  if (after && typeof after === "object" && !Array.isArray(after)) return after;
  const before = action.beforeSummary;
  return before && typeof before === "object" && !Array.isArray(before) ? before : {};
}

function historyPartnerName(action: PartnerAdminHistoryItem): string {
  const name = historySummary(action).name;
  return typeof name === "string" && name ? name : action.targetId || "Unresolved Partner";
}

function historyOperationLabel(action: PartnerAdminHistoryItem): string {
  if (action.operationKind === "partner.create") return "Created draft";
  if (action.operationKind === "partner.patch") return "Updated Partner details";
  if (action.operationKind === "partner.note_approval") {
    return historySummary(action).noteAgentVisible
      ? "Approved Partner Note visibility"
      : "Removed Partner Note visibility";
  }
  if (action.operationKind === "partner.publish") return "Published Partner";
  if (action.operationKind === "partner.unpublish") return "Unpublished Partner";
  if (action.operationKind === "partner.delete") return "Deleted Partner";
  return action.operationKind;
}

function historyChangeLabel(action: PartnerAdminHistoryItem): string {
  const summary = historySummary(action);
  const changedFields = Array.isArray(summary.changedFields)
    ? summary.changedFields.filter(
        (field): field is string =>
          typeof field === "string" && field !== "created" && field !== "deleted",
      )
    : [];
  if (changedFields.length) {
    const labels = changedFields.map((field) => {
      if (field === "partnerNote") return "Partner Note metadata";
      if (field === "note_approval") return "Partner Note visibility";
      return field.replaceAll("_", " ");
    });
    return `Changed: ${labels.join(", ")}`;
  }
  const details = [
    typeof summary.type === "string" ? typeLabel(summary.type as PartnerRecord["type"]) : "",
    summary.published === true ? "Published" : summary.published === false ? "Draft" : "",
    summary.logoPresent === true ? "logo present" : "",
    summary.urlPresent === true ? "URL present" : "",
    summary.notePresent === true ? "Partner Note present" : "",
  ].filter(Boolean);
  return details.join(" · ");
}

function historyStatusLabel(status: PartnerAdminHistoryItem["status"]): string {
  if (status === "applied") return "Applied";
  if (status === "pending") return "Pending";
  return "Failed";
}

function historyStatusClass(status: PartnerAdminHistoryItem["status"]): string {
  if (status === "applied") return "badge-success";
  if (status === "pending") return "badge-warning";
  return "badge-error";
}

function historyTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function createOperationId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return `admin-ui-${Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function partnerLogoUrl(partner: PartnerAdminSnapshot): string {
  return partner.logo ? getPbFileUrl("partners", partner.id, partner.logo) : "";
}

function logoMimeType(file: File): string {
  if (file.type) return file.type;
  const name = file.name.toLowerCase();
  if (name.endsWith(".svg")) return "image/svg+xml";
  if (name.endsWith(".avif")) return "image/avif";
  if (name.endsWith(".webp")) return "image/webp";
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
  return "";
}

async function readLogoPayload(file: File | null): Promise<PartnerLogoPayload | null> {
  if (!file) return null;
  const data = Array.from(new Uint8Array(await file.arrayBuffer()));
  return { name: file.name, type: logoMimeType(file), data };
}

export default function AdminPartnersHub() {
  const { toast, showToast } = useAdminToast();
  const [typeFilter, setTypeFilter] = createSignal<PartnerTypeFilter>("all");
  const [publishedFilter, setPublishedFilter] = createSignal<PartnerVisibilityFilter>("all");
  const [showForm, setShowForm] = createSignal(false);
  const [editingId, setEditingId] = createSignal<string | null>(null);
  const [busyId, setBusyId] = createSignal<string | null>(null);
  const [deleteCandidateId, setDeleteCandidateId] = createSignal<string | null>(null);
  const [partnersError, setPartnersError] = createSignal<string | null>(null);
  const [formWarnings, setFormWarnings] = createSignal<string[]>([]);
  const [operationIds, setOperationIds] = createSignal<Record<string, string>>({});
  const [historyPartner, setHistoryPartner] = createSignal<Pick<PartnerAdminSnapshot, "id" | "name"> | null>(null);

  onMount(() => {
    try {
      const stored = JSON.parse(sessionStorage.getItem(PARTNER_OPERATION_IDS_STORAGE_KEY) || "null");
      if (!stored || typeof stored !== "object" || Array.isArray(stored)) return;
      const valid = Object.fromEntries(
        Object.entries(stored).filter(
          ([key, value]) => key.length <= 256 && typeof value === "string" && value.length <= 128,
        ),
      ) as Record<string, string>;
      setOperationIds(valid);
    } catch {
      sessionStorage.removeItem(PARTNER_OPERATION_IDS_STORAGE_KEY);
    }
  });

  const [name, setName] = createSignal("");
  const [type, setType] = createSignal<PartnerRecord["type"]>("sponsor");
  const [tier, setTier] = createSignal<PartnerRecord["tier"] | "">("bronze");
  const [url, setUrl] = createSignal("");
  const [notes, setNotes] = createSignal("");
  const [logo, setLogo] = createSignal<File | null>(null);
  const [removeLogo, setRemoveLogo] = createSignal(false);
  const [editingOriginal, setEditingOriginal] = createSignal<PartnerAdminSnapshot | null>(null);
  const [saving, setSaving] = createSignal(false);

  const [partnerReviews, { refetch }] = createResource(async () => {
    const res = await adminFetchPartners();
    if (!res.success) {
      setPartnersError(res.error || "Could not load partners.");
      return { partners: [] as PartnerAdminListItem[], history: [] as PartnerAdminHistoryItem[] };
    }
    setPartnersError(null);
    return res.data;
  });
  const partnerReviewItems = () => partnerReviews()?.partners || [];
  const partnerHistory = () => partnerReviews()?.history || [];
  const partners = () => partnerReviewItems().map((item) => item.partner);
  const reviewFor = (id: string) =>
    partnerReviewItems().find((item) => item.partner.id === id);
  const [selectedPartnerHistory, { refetch: refetchSelectedHistory }] = createResource(
    () => historyPartner()?.id,
    async (targetId) => {
      const result = await adminFetchPartnerHistory(targetId);
      if (!result.success) {
        showToast("error", result.error || "Could not load Partner history.");
        return [] as PartnerAdminHistoryItem[];
      }
      return result.data;
    },
  );
  const displayedHistory = () =>
    historyPartner() ? selectedPartnerHistory() || [] : partnerHistory();
  const displayedHistoryLimit = () => (historyPartner() ? 100 : 20);

  const refreshPartnerData = async () => {
    await refetch();
    if (historyPartner()) await refetchSelectedHistory();
  };

  const updateOperationIds = (
    update: (current: Record<string, string>) => Record<string, string>,
  ) => {
    setOperationIds((current) => {
      const next = update(current);
      try {
        sessionStorage.setItem(PARTNER_OPERATION_IDS_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // The in-memory identity still keeps same-page retries safe when storage is unavailable.
      }
      return next;
    });
  };

  const operationId = (key: string) => {
    const existing = operationIds()[key];
    if (existing) return existing;
    const created = createOperationId();
    updateOperationIds((current) => ({ ...current, [key]: created }));
    return created;
  };

  const clearOperationId = (key: string) => {
    updateOperationIds((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  const clearRejectedOperation = (key: string, code: string) => {
    if (!["infrastructure", "operation_failed", "operation_pending"].includes(code)) {
      clearOperationId(key);
    }
  };

  const resetFileInput = () => {
    const input = document.getElementById("partner-logo") as HTMLInputElement | null;
    if (input) input.value = "";
  };

  const resetForm = (clearOperation = true) => {
    if (clearOperation) {
      clearOperationId(editingId() ? `partner.patch:${editingId()}` : "partner.create");
    }
    setEditingId(null);
    setName("");
    setType("sponsor");
    setTier("bronze");
    setUrl("");
    setNotes("");
    setLogo(null);
    setRemoveLogo(false);
    setEditingOriginal(null);
    setFormWarnings([]);
    resetFileInput();
    setShowForm(false);
  };

  const openNewPartner = () => {
    resetForm(false);
    setShowForm(true);
  };

  const loadPartner = (partner: PartnerAdminSnapshot) => {
    setEditingId(partner.id);
    setName(partner.name);
    setType(partner.type);
    setTier(partner.tier || "");
    setUrl(partner.url || "");
    setNotes(partner.notes || "");
    setLogo(null);
    setRemoveLogo(false);
    setEditingOriginal(partner);
    setFormWarnings([]);
    resetFileInput();
    setShowForm(true);
  };

  const filtered = () => {
    let list = [...(partners() || [])];
    const selectedType = typeFilter();
    const selectedVisibility = publishedFilter();
    if (selectedType !== "all") list = list.filter((partner) => partner.type === selectedType);
    if (selectedVisibility === "yes") list = list.filter((partner) => partner.published);
    if (selectedVisibility === "no") list = list.filter((partner) => !partner.published);
    return list.sort((a, b) => a.name.localeCompare(b.name));
  };

  const filtersActive = () => typeFilter() !== "all" || publishedFilter() !== "all";

  const submit = async (e: Event) => {
    e.preventDefault();
    const submitted = {
      id: editingId(),
      original: editingOriginal(),
      name: name(),
      type: type(),
      tier: tier(),
      url: url(),
      notes: notes(),
      logo: logo(),
      removeLogo: removeLogo(),
    };
    const operationKey = submitted.id ? `partner.patch:${submitted.id}` : "partner.create";
    setSaving(true);
    try {
      const logoPayload = await readLogoPayload(submitted.logo);
      const id = submitted.id;
      let res;
      if (id) {
        const original = submitted.original;
        if (!original) throw new Error("Reload this Partner before editing it.");
        const patch: PartnerPatch = {};
        if (submitted.name.trim() !== original.name) patch.name = submitted.name;
        if (submitted.type !== original.type) patch.type = submitted.type;
        if ((submitted.tier || undefined) !== original.tier) patch.tier = submitted.tier || null;
        if ((submitted.url.trim() || undefined) !== original.url) patch.url = submitted.url.trim() || null;
        if ((submitted.notes.trim() || undefined) !== original.notes) patch.notes = submitted.notes.trim() || null;
        if (logoPayload) patch.logo = logoPayload;
        else if (submitted.removeLogo) patch.logo = null;
        if (Object.keys(patch).length === 0) {
          showToast("error", "No Partner changes to save.");
          return;
        }
        res = await adminUpdatePartner(operationId(operationKey), id, original.version, patch);
      } else {
        const payload: PartnerDraftInput = {
          name: submitted.name,
          type: submitted.type,
          tier: submitted.tier,
          url: submitted.url,
          notes: submitted.notes,
          logo: logoPayload,
        };
        res = await adminCreatePartner(operationId(operationKey), payload);
      }
      if (!res.success) {
        if (res.code === "stale" && "current" in res) {
          loadPartner(res.current);
          await refreshPartnerData();
        }
        clearRejectedOperation(operationKey, res.code);
        showToast("error", res.error || "Could not save partner.");
        return;
      }
      const warnings = res.data.warnings.map((warning) => warning.message);
      showToast(
        "success",
        id
          ? `"${submitted.name.trim()}" updated.`
          : `"${submitted.name.trim()}" created as draft${warnings.length ? ` with ${warnings.length} duplicate warning${warnings.length === 1 ? "" : "s"}` : ""}.`,
      );
      clearOperationId(operationKey);
      resetForm();
      setFormWarnings(warnings);
      await refreshPartnerData();
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Could not save partner.");
    } finally {
      setSaving(false);
    }
  };

  const togglePublished = async (partner: PartnerAdminSnapshot) => {
    setBusyId(partner.id);
    const nextPublished = !partner.published;
    const operationKey = `partner.${nextPublished ? "publish" : "unpublish"}:${partner.id}`;
    try {
      const res = await adminSetPartnerPublished(
        operationId(operationKey),
        partner.id,
        partner.version,
        nextPublished,
      );
      if (!res.success) {
        if (res.code === "stale") await refreshPartnerData();
        clearRejectedOperation(operationKey, res.code);
        showToast("error", res.error || "Could not update published state.");
      } else {
        clearOperationId(operationKey);
        showToast(
          "success",
          nextPublished ? `"${partner.name}" is now published.` : `"${partner.name}" is now a draft.`,
        );
        await refreshPartnerData();
      }
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : "Could not update published state.");
    } finally {
      setBusyId(null);
    }
  };

  const toggleNoteApproval = async (partner: PartnerAdminSnapshot) => {
    setBusyId(partner.id);
    const approved = !partner.noteAgentVisible;
    const operationKey = `partner.note_approval:${approved ? "approve" : "revoke"}:${partner.id}`;
    try {
      const res = await adminSetPartnerNoteApproval(
        operationId(operationKey),
        partner.id,
        partner.version,
        approved,
      );
      if (!res.success) {
        if (res.code === "stale") await refreshPartnerData();
        clearRejectedOperation(operationKey, res.code);
        showToast("error", res.error || "Could not update Partner Note approval.");
      } else {
        clearOperationId(operationKey);
        showToast(
          "success",
          approved
            ? `"${partner.name}" Partner Note approved for agent visibility.`
            : `"${partner.name}" Partner Note approval removed.`,
        );
        await refreshPartnerData();
      }
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : "Could not update Partner Note approval.");
    } finally {
      setBusyId(null);
    }
  };

  const deletePartner = async (partner: PartnerAdminSnapshot) => {
    if (deleteCandidateId() !== partner.id) {
      setDeleteCandidateId(partner.id);
      return;
    }
    setBusyId(partner.id);
    const operationKey = `partner.delete:${partner.id}`;
    try {
      const res = await adminDeletePartner(
        operationId(operationKey),
        partner.id,
        partner.version,
      );
      if (!res.success) {
        if (res.code === "stale") await refreshPartnerData();
        clearRejectedOperation(operationKey, res.code);
        showToast("error", res.error || "Could not delete partner.");
      } else {
        clearOperationId(operationKey);
        showToast("success", `"${partner.name}" deleted.`);
        setDeleteCandidateId(null);
        if (historyPartner()?.id === partner.id) setHistoryPartner(null);
        await refreshPartnerData();
      }
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : "Could not delete partner.");
    } finally {
      setBusyId(null);
    }
  };

  const renderPartnerActions = (partner: PartnerAdminSnapshot) => {
    const review = () => reviewFor(partner.id);
    const hasUrlIssue = () =>
      review()?.publication.issues.some((issue) => issue.field === "url");
    return (
    <div class="flex flex-wrap items-center gap-1.5">
      <span
        class={`badge badge-sm font-mono ${partner.published ? "badge-success" : "badge-ghost"}`}
      >
        {partner.published ? "Published" : "Draft"}
      </span>
      <button
        type="button"
        class={`btn btn-xs max-md:min-h-12 max-md:px-3 font-mono ${partner.published ? "btn-ghost" : "btn-primary"}`}
        disabled={saving() || busyId() === partner.id}
        onClick={() => togglePublished(partner)}
      >
        {partner.published ? "Unpublish" : "Publish"}
      </button>
      <button
        type="button"
        class="btn btn-xs btn-ghost max-md:min-h-12 max-md:px-3 font-mono"
        disabled={saving() || busyId() === partner.id}
        onClick={() => loadPartner(partner)}
      >
        Edit
      </button>
      <button
        type="button"
        class="btn btn-xs btn-ghost max-md:min-h-12 max-md:px-3 font-mono"
        aria-label={`Show history for ${partner.name}`}
        onClick={() => setHistoryPartner({ id: partner.id, name: partner.name })}
      >
        History
      </button>
      <Show when={partner.notes}>
        <button
          type="button"
          class={`btn btn-xs max-md:min-h-12 max-md:px-3 font-mono ${partner.noteAgentVisible ? "btn-success btn-outline" : "btn-ghost"}`}
          disabled={saving() || busyId() === partner.id}
          aria-pressed={partner.noteAgentVisible}
          onClick={() => toggleNoteApproval(partner)}
        >
          {partner.noteAgentVisible ? "Revoke note approval" : "Approve note"}
        </button>
      </Show>
      <button
        type="button"
        class={`btn btn-xs max-md:min-h-12 max-md:px-3 font-mono ${deleteCandidateId() === partner.id ? "btn-error" : "btn-ghost text-error"}`}
        disabled={saving() || busyId() === partner.id}
        onClick={() => deletePartner(partner)}
      >
        {deleteCandidateId() === partner.id ? "Confirm delete" : "Delete"}
      </button>
      <Show when={deleteCandidateId() === partner.id}>
        <button
          type="button"
          class="btn btn-xs btn-ghost max-md:min-h-12 max-md:px-3 font-mono"
          disabled={busyId() === partner.id}
          onClick={() => setDeleteCandidateId(null)}
        >
          Cancel
        </button>
      </Show>
      <Show when={partner.url && !hasUrlIssue()}>
        <a
          href={partner.url}
          class="btn btn-xs btn-ghost max-md:min-h-12 max-md:px-3 font-mono"
          target="_blank"
          rel="noopener noreferrer"
        >
          Visit
        </a>
      </Show>
    </div>
    );
  };

  const renderReadiness = (partner: PartnerAdminSnapshot) => {
    const review = () => reviewFor(partner.id);
    return (
      <Show when={!review()?.publication.ready}>
        <div class="mt-2 space-y-1" role="status">
          <For each={review()?.publication.issues || []}>
            {(issue) => (
              <div class="flex items-start gap-1.5 text-xs font-mono text-warning">
                <Icon icon="ph:warning-circle-bold" class="mt-0.5 shrink-0" aria-hidden="true" />
                <span>{issue.message}</span>
              </div>
            )}
          </For>
        </div>
      </Show>
    );
  };

  return (
    <AdminPageShell
      layoutTitle="Admin: Sponsors & Partners"
      layoutDescription="Manage conference sponsors and partners"
      title="Sponsors & Partners"
      subtitle="Public logo wall & partner network"
      hint="Create incomplete drafts, review publication requirements, then publish intentionally."
      count={partners().length}
      countLoading={partnerReviews.loading}
      accent="secondary"
      toast={toast()}
      headerActions={
        <a href="/sponsors" class="btn btn-outline btn-primary font-mono" target="_blank">
          Public page
        </a>
      }
    >
      <Show when={partnersError()}>
        <div class="alert alert-error mb-6 font-mono text-sm" role="alert">
          <span>{partnersError()}</span>
        </div>
      </Show>
      <Show when={formWarnings().length > 0}>
        <div class="alert alert-warning mb-6 items-start font-mono text-sm" role="status">
          <Icon icon="ph:warning-circle-bold" class="mt-0.5 shrink-0" aria-hidden="true" />
          <div>
            <div class="font-bold">Draft saved with possible duplicates</div>
            <For each={formWarnings()}>{(warning) => <div class="mt-1">{warning}</div>}</For>
          </div>
        </div>
      </Show>

      <div class="mb-8 w-[calc(100vw-2rem)] max-w-full sm:w-full">
        <Show
          when={showForm()}
          fallback={
            <button type="button" class="btn btn-primary font-mono gap-2" onClick={openNewPartner}>
              <Icon icon="ph:handshake-bold" />
              New sponsor or partner
            </button>
          }
        >
          <form
            onSubmit={submit}
            class={`${adminFormPanelClass} w-full min-w-0 max-w-full overflow-hidden`}
          >
            <div class="mb-6">
              <div>
                <h2 class="text-lg font-bold text-white">
                  {editingId() ? "Edit sponsor or partner" : "New sponsor or partner"}
                </h2>
                <p class="text-xs text-gray-500 font-mono mt-1">
                  Incomplete records can stay drafts. An official logo is required only when publishing.
                </p>
              </div>
            </div>

            <fieldset disabled={saving()} class="contents">
            <div class="space-y-6">
              <AdminFormSection
                title="Public identity"
                description="The name, link, and logo that visitors will see on the public sponsor surface."
              >
                <div class="grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-5">
                  <AdminFormField
                    id="partner-name"
                    label="Name"
                    required
                    hint="Public sponsor or partner name."
                    error="Add a name before saving."
                    class="min-w-0 lg:col-span-7"
                  >
                    <input
                      id="partner-name"
                      name="name"
                      class={adminInputClass()}
                      required
                      autocomplete="organization"
                      aria-describedby="partner-name-hint"
                      aria-errormessage="partner-name-error"
                      value={name()}
                      onInvalid={markAdminControlInvalid}
                      onBlur={syncAdminControlValidity}
                      onInput={(e) => {
                        clearAdminControlValidity(e);
                        setName(e.currentTarget.value);
                      }}
                    />
                  </AdminFormField>

                  <AdminFormField
                    id="partner-url"
                    label="Website URL"
                    hint="Optional. Use an absolute https:// URL."
                    error="Enter a valid URL, including https://."
                    class="min-w-0 lg:col-span-5"
                  >
                    <input
                      id="partner-url"
                      name="url"
                      type="url"
                      class={adminInputClass("font-mono")}
                      placeholder="https://example.com"
                      autocomplete="url"
                      aria-describedby="partner-url-hint"
                      aria-errormessage="partner-url-error"
                      value={url()}
                      onInvalid={markAdminControlInvalid}
                      onBlur={syncAdminControlValidity}
                      onInput={(e) => {
                        clearAdminControlValidity(e);
                        setUrl(e.currentTarget.value);
                      }}
                    />
                  </AdminFormField>

                  <AdminFormField
                    id="partner-logo"
                    label="Logo"
                    hint={
                      editingId()
                        ? "Optional while draft. Upload a human-verified official logo to replace the current file."
                        : "Optional while draft. SVG preferred; PNG, JPEG, WebP, or AVIF accepted. Max 5 MB."
                    }
                    class="min-w-0 lg:col-span-12"
                  >
                    <input
                      id="partner-logo"
                      name="logo"
                      type="file"
                      accept="image/svg+xml,image/png,image/jpeg,image/webp,image/avif"
                      class={adminFileInputClass("min-w-0 max-w-full font-mono text-sm")}
                      aria-describedby="partner-logo-hint"
                      onInvalid={markAdminControlInvalid}
                      onBlur={syncAdminControlValidity}
                      onChange={(e) => {
                        clearAdminControlValidity(e);
                        setLogo(e.currentTarget.files?.[0] ?? null);
                        if (e.currentTarget.files?.[0]) setRemoveLogo(false);
                      }}
                    />
                  </AdminFormField>
                  <Show when={editingOriginal()?.logo}>
                    <div class="min-w-0 lg:col-span-12">
                      <label
                        for="partner-remove-logo"
                        class="flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm font-mono"
                      >
                        <input
                          id="partner-remove-logo"
                          type="checkbox"
                          class="checkbox checkbox-warning checkbox-sm"
                          checked={removeLogo()}
                          disabled={editingOriginal()?.published}
                          onChange={(e) => {
                            setRemoveLogo(e.currentTarget.checked);
                            if (e.currentTarget.checked) {
                              setLogo(null);
                              resetFileInput();
                            }
                          }}
                        />
                        {editingOriginal()?.published
                          ? "Unpublish this Partner before removing its current logo"
                          : "Remove the current logo and keep this Partner as an incomplete draft"}
                      </label>
                    </div>
                  </Show>
                </div>
              </AdminFormSection>

              <AdminFormSection
                title="Placement"
                description="Controls which public group this record appears in and whether sponsor tiering applies."
              >
                <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-12 gap-4 lg:gap-5 items-end">
                  <AdminFormField id="partner-type" label="Classification" required class="min-w-0 lg:col-span-4">
                    <select
                      id="partner-type"
                      name="type"
                      class={adminSelectClass()}
                      required
                      value={type()}
                      onChange={(e) => {
                        const nextType = e.currentTarget.value as PartnerRecord["type"];
                        setType(nextType);
                        if (nextType !== "sponsor") setTier("");
                        if (nextType === "sponsor" && !tier()) setTier("bronze");
                      }}
                    >
                      <For each={PARTNER_TYPE_OPTIONS}>
                        {(option) => <option value={option.value}>{option.label}</option>}
                      </For>
                    </select>
                  </AdminFormField>

                  <Show
                    when={type() === "sponsor"}
                    fallback={
                      <div class="lg:col-span-8 rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm text-base-content/60 min-h-12 flex items-center">
                        Sponsor tiers only apply when type is <span class="font-mono text-base-content/80 ml-1">Sponsor</span>.
                      </div>
                    }
                  >
                    <AdminFormField id="partner-tier" label="Sponsor tier" required class="min-w-0 lg:col-span-4">
                      <select
                        id="partner-tier"
                        name="tier"
                        class={adminSelectClass()}
                        required
                        value={tier()}
                        onChange={(e) => setTier(e.currentTarget.value as PartnerRecord["tier"])}
                      >
                        <For each={TIER_OPTIONS}>
                          {(option) => <option value={option.value}>{option.label}</option>}
                        </For>
                      </select>
                    </AdminFormField>
                  </Show>
                </div>
              </AdminFormSection>

              <AdminFormSection
                title="Partner Note"
                description="Private, non-sensitive organizational context only. Exclude contacts, contracts, financial terms, credentials, and secrets. Editing this note clears agent-visible approval."
              >
                <AdminFormField id="partner-notes" label="Partner Note">
                  <textarea
                    id="partner-notes"
                    name="notes"
                    class={adminTextareaClass("min-h-28")}
                    value={notes()}
                    onInput={(e) => setNotes(e.currentTarget.value)}
                  />
                </AdminFormField>
                <Show when={editingOriginal()?.notes}>
                  <div class={`mt-3 badge badge-outline h-auto py-2 font-mono text-xs ${editingOriginal()?.noteAgentVisible ? "badge-success" : "badge-warning"}`}>
                    {editingOriginal()?.noteAgentVisible
                      ? "Current note is approved for agent visibility"
                      : "Current note requires human approval"}
                  </div>
                </Show>
              </AdminFormSection>

              <AdminFormSection
                title="Draft lifecycle"
                description="Save changes here first. Publication is a separate action from the Partner list."
              >
                <div class="rounded-xl border border-white/10 bg-white/5 px-4 py-4">
                  <Show
                    when={editingOriginal()}
                    fallback={<p class="text-sm font-mono text-base-content/65">This record will be created as a draft.</p>}
                  >
                    {(partner) => (
                      <>
                        <div class="flex flex-wrap items-center gap-2">
                          <span class={`badge font-mono ${partner().published ? "badge-success" : "badge-ghost"}`}>
                            {partner().published ? "Published" : "Draft"}
                          </span>
                          <span class="text-xs font-mono text-base-content/60">
                            Save edits before changing publication state.
                          </span>
                        </div>
                        {renderReadiness(partner())}
                      </>
                    )}
                  </Show>
                </div>
              </AdminFormSection>
            </div>
            </fieldset>

            <div class="mt-6 border-t border-white/10 pt-5 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3">
              <p class="text-xs text-base-content/45 font-mono">
                New records always stay drafts until a separate publication action succeeds.
              </p>
              <div class="flex flex-wrap gap-2 sm:justify-end">
                <button type="button" class="btn btn-ghost font-mono" disabled={saving()} onClick={() => resetForm()}>
                  Cancel
                </button>
                <button type="submit" class="btn btn-primary font-mono" disabled={saving()}>
                  {saving()
                    ? "Saving..."
                    : editingId()
                      ? "Update sponsor or partner"
                      : "Create sponsor or partner"}
                </button>
              </div>
            </div>
          </form>
        </Show>
      </div>

      <AdminFilterBar
        showCount={filtersActive()}
        filteredCount={filtered().length}
        totalCount={partners().length}
      >
        <AdminFilterGroup label="Type:">
          <For each={TYPE_FILTER_OPTIONS}>
            {(option) => (
              <button
                type="button"
                class={adminFilterButtonClass(typeFilter() === option.value)}
                onClick={() => setTypeFilter(option.value)}
              >
                {option.label}
              </button>
            )}
          </For>
        </AdminFilterGroup>
        <AdminFilterGroup label="Visibility:">
          <For each={VISIBILITY_OPTIONS}>
            {(option) => (
              <button
                type="button"
                class={adminFilterButtonClass(publishedFilter() === option.value, "secondary")}
                onClick={() => setPublishedFilter(option.value)}
              >
                {option.label}
              </button>
            )}
          </For>
        </AdminFilterGroup>
      </AdminFilterBar>

      <Show when={partnerReviews.loading}>
        <div class="flex justify-center py-16">
          <span class="loading loading-bars loading-lg text-primary-500"></span>
        </div>
      </Show>

      <Show when={!partnerReviews.loading && filtered().length === 0}>
        <AdminDataPanel>
          <div class="p-12 text-center">
            <Icon icon="ph:handshake-bold" class="text-4xl text-gray-600 mb-4" />
            <p class="text-white font-bold mb-2">
              {filtersActive() ? "No partners match these filters" : "No sponsors or partners yet"}
            </p>
            <p class="text-sm text-gray-500 font-mono max-w-md mx-auto mb-4">
              {filtersActive()
                ? "Try changing the type or visibility filters above."
                : "Create draft records here, then publish them when the logo and link are ready."}
            </p>
            <Show when={!filtersActive() && !showForm()}>
              <button type="button" class="btn btn-primary btn-sm font-mono" onClick={openNewPartner}>
                New sponsor or partner
              </button>
            </Show>
          </div>
        </AdminDataPanel>
      </Show>

      <Show when={!partnerReviews.loading && filtered().length > 0}>
        <AdminDataPanel>
          <div class="md:hidden space-y-4 p-4">
            <For each={filtered()}>
              {(partner) => (
                <div class="bg-white/5 rounded-xl p-4 border border-white/10 space-y-3">
                  <div class="flex items-center gap-4">
                    <div class="h-16 w-24 shrink-0 rounded-lg border border-white/10 bg-base-300/80 p-2 flex items-center justify-center">
                      <Show
                        when={partner.logo}
                        fallback={<Icon icon="ph:image-broken" class="text-2xl text-base-content/30" aria-label="No logo uploaded" />}
                      >
                        <img
                          src={partnerLogoUrl(partner)}
                          alt={`${partner.name} logo`}
                          class="max-h-full max-w-full object-contain"
                          loading="lazy"
                          width={160}
                          height={80}
                        />
                      </Show>
                    </div>
                    <div class="min-w-0">
                      <div class="font-bold text-white truncate">{partner.name}</div>
                      <div class="text-xs font-mono text-gray-500">
                        {typeLabel(partner.type)} · {tierLabel(partner.tier)}
                      </div>
                      {renderReadiness(partner)}
                    </div>
                  </div>
                  <div class="pt-3 border-t border-white/5">
                    {renderPartnerActions(partner)}
                  </div>
                </div>
              )}
            </For>
          </div>

          <div class="hidden md:block overflow-x-auto">
            <table class="table table-lg w-full">
              <thead>
                <tr class="text-white border-b border-white/10 bg-white/5">
                  <th class="font-bold text-gray-300">Logo</th>
                  <th class="font-bold text-gray-300">Name</th>
                  <th class="font-bold text-gray-300">Group</th>
                  <th class="font-bold text-gray-300">Website</th>
                  <th class="font-bold text-gray-300">Actions</th>
                </tr>
              </thead>
              <tbody>
                <For each={filtered()}>
                  {(partner) => (
                    <tr class="hover:bg-white/5 border-b border-white/5">
                      <td>
                        <div class="h-16 w-28 rounded-lg border border-white/10 bg-base-300/80 p-2 flex items-center justify-center">
                          <Show
                            when={partner.logo}
                            fallback={<Icon icon="ph:image-broken" class="text-2xl text-base-content/30" aria-label="No logo uploaded" />}
                          >
                            <img
                              src={partnerLogoUrl(partner)}
                              alt={`${partner.name} logo`}
                              class="max-h-full max-w-full object-contain"
                              loading="lazy"
                              width={160}
                              height={80}
                            />
                          </Show>
                        </div>
                      </td>
                      <td>
                          <div class="font-bold text-white">{partner.name}</div>
                          <div class="text-xs font-mono text-gray-500">{partner.id}</div>
                          {renderReadiness(partner)}
                      </td>
                      <td>
                        <div class="text-sm text-gray-300">{typeLabel(partner.type)}</div>
                        <div class="text-xs font-mono text-gray-500">{tierLabel(partner.tier)}</div>
                      </td>
                      <td class="max-w-xs truncate font-mono text-xs text-gray-400">
                        <Show when={partner.url} fallback="No URL">
                          {partner.url}
                        </Show>
                      </td>
                      <td>{renderPartnerActions(partner)}</td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </div>
        </AdminDataPanel>
      </Show>

      <section class="mt-8" aria-labelledby="partner-history-title">
        <div class="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id="partner-history-title" class="text-lg font-bold text-white">
              <Show when={historyPartner()} fallback="Partner history">
                {(partner) => `Partner history: ${partner().name}`}
              </Show>
            </h2>
            <p class="mt-1 text-xs font-mono text-base-content/55">
              Durable admin operations. Partner Note content is never copied into this history.
            </p>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <Show when={historyPartner()}>
              <button
                type="button"
                class="btn btn-xs btn-ghost font-mono"
                onClick={() => setHistoryPartner(null)}
              >
                Show all recent history
              </button>
            </Show>
            <Show when={displayedHistory().some((action) => action.status !== "applied")}>
              <span class="badge badge-warning badge-outline font-mono">
                {displayedHistory().filter((action) => action.status !== "applied").length} unresolved
              </span>
            </Show>
          </div>
        </div>
        <AdminDataPanel>
          <Show
            when={displayedHistory().length > 0}
            fallback={
              <p class="px-5 py-6 text-sm font-mono text-base-content/55">
                No audited Partner operations yet.
              </p>
            }
          >
            <details
              class="group"
              open={displayedHistory().some((action) => action.status !== "applied")}
            >
              <summary class="cursor-pointer list-none px-5 py-4 font-mono text-sm text-base-content/75 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
                <span class="inline-flex items-center gap-2">
                  <Icon icon="ph:clock-counter-clockwise-bold" aria-hidden="true" />
                  Show {Math.min(displayedHistory().length, displayedHistoryLimit())} operation
                  <Show when={displayedHistory().length !== 1}>s</Show>
                </span>
              </summary>
              <ol class="divide-y divide-white/10 border-t border-white/10">
                <For each={displayedHistory().slice(0, displayedHistoryLimit())}>
                  {(action) => (
                    <li class="grid gap-3 px-5 py-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
                      <div class="min-w-0">
                        <div class="flex flex-wrap items-center gap-2">
                          <span class={`badge badge-sm font-mono ${historyStatusClass(action.status)}`}>
                            {historyStatusLabel(action.status)}
                          </span>
                          <strong class="text-sm text-white">{historyOperationLabel(action)}</strong>
                          <span class="truncate text-sm text-base-content/70">
                            {historyPartnerName(action)}
                          </span>
                        </div>
                        <Show when={action.failure}>
                          {(failure) => (
                            <p class="mt-2 text-xs font-mono text-error" role="status">
                              {failure().message} ({failure().code})
                            </p>
                          )}
                        </Show>
                        <Show when={historyChangeLabel(action)}>
                          <p class="mt-2 text-xs font-mono text-base-content/60">
                            {historyChangeLabel(action)}
                          </p>
                        </Show>
                        <p class="mt-2 break-all text-[0.7rem] font-mono text-base-content/45">
                          <Show when={action.source === "admin_ui"} fallback="MCP">Admin UI</Show>
                          {" · User "}{action.actorUserId}{" · Operation "}{action.operationId}
                          <Show when={action.attemptCount > 1}> · Attempt {action.attemptCount}</Show>
                        </p>
                      </div>
                      <time
                        datetime={action.updatedAt}
                        class="whitespace-nowrap text-xs font-mono text-base-content/50"
                      >
                        {historyTime(action.updatedAt)}
                      </time>
                    </li>
                  )}
                </For>
              </ol>
            </details>
          </Show>
        </AdminDataPanel>
      </section>
    </AdminPageShell>
  );
}
