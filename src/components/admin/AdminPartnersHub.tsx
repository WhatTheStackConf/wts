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
  adminFetchPartners,
  adminSetPartnerPublished,
  adminUpdatePartner,
  type PartnerInput,
  type PartnerLogoPayload,
} from "~/lib/admin-actions";
import { getPbFileUrl } from "~/lib/pocketbase-public-url";
import type { PartnerRecord } from "~/lib/pocketbase-types";

type PartnerTypeFilter = PartnerRecord["type"] | "all";
type PartnerVisibilityFilter = "all" | "yes" | "no";

const PARTNER_TYPE_OPTIONS: { value: PartnerRecord["type"]; label: string }[] = [
  { value: "organizer", label: "Organizer" },
  { value: "sponsor", label: "Sponsor" },
  { value: "media", label: "Media" },
  { value: "company_supporter", label: "Supporter" },
  { value: "supporter", label: "Community" },
  { value: "catering", label: "Bytes and beverages" },
  { value: "other", label: "Other" },
];

const TIER_OPTIONS: { value: NonNullable<PartnerRecord["tier"]> | ""; label: string }[] = [
  { value: "", label: "No tier" },
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

function typeLabel(value: PartnerRecord["type"]): string {
  return PARTNER_TYPE_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

function tierLabel(value?: PartnerRecord["tier"]): string {
  if (!value) return "No tier";
  return TIER_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

function partnerLogoUrl(partner: PartnerRecord): string {
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
  if (!file || file.size === 0) return null;
  if (file.size > 5 * 1024 * 1024) throw new Error("Logo must be 5 MB or smaller.");
  const type = logoMimeType(file);
  const accepted = ["image/svg+xml", "image/png", "image/jpeg", "image/webp", "image/avif"];
  if (type && !accepted.includes(type)) {
    throw new Error("Logo must be SVG, PNG, JPEG, WebP, or AVIF.");
  }
  const data = Array.from(new Uint8Array(await file.arrayBuffer()));
  return { name: file.name, type, data };
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

  const [name, setName] = createSignal("");
  const [type, setType] = createSignal<PartnerRecord["type"]>("sponsor");
  const [tier, setTier] = createSignal<PartnerRecord["tier"] | "">("bronze");
  const [url, setUrl] = createSignal("");
  const [description, setDescription] = createSignal("");
  const [published, setPublished] = createSignal(false);
  const [logo, setLogo] = createSignal<File | null>(null);
  const [saving, setSaving] = createSignal(false);

  const [partners, { refetch }] = createResource(async () => {
    const res = await adminFetchPartners();
    if (!res.success) {
      setPartnersError(res.error || "Could not load partners.");
      return [] as PartnerRecord[];
    }
    setPartnersError(null);
    return res.data as PartnerRecord[];
  });

  const resetFileInput = () => {
    const input = document.getElementById("partner-logo") as HTMLInputElement | null;
    if (input) input.value = "";
  };

  const resetForm = () => {
    setEditingId(null);
    setName("");
    setType("sponsor");
    setTier("bronze");
    setUrl("");
    setDescription("");
    setPublished(false);
    setLogo(null);
    resetFileInput();
    setShowForm(false);
  };

  const openNewPartner = () => {
    resetForm();
    setShowForm(true);
  };

  const loadPartner = (partner: PartnerRecord) => {
    setEditingId(partner.id);
    setName(partner.name);
    setType(partner.type);
    setTier(partner.tier || "");
    setUrl(partner.url || "");
    setDescription(partner.description || "");
    setPublished(Boolean(partner.published));
    setLogo(null);
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
    setSaving(true);
    try {
      const logoPayload = await readLogoPayload(logo());
      const payload: PartnerInput = {
        name: name(),
        type: type(),
        tier: tier(),
        url: url(),
        description: description(),
        published: published(),
        logo: logoPayload,
      };
      const id = editingId();
      const res = id ? await adminUpdatePartner(id, payload) : await adminCreatePartner(payload);
      if (!res.success) {
        showToast("error", res.error || "Could not save partner.");
        return;
      }
      showToast(
        "success",
        id
          ? `"${name().trim()}" updated.`
          : `"${name().trim()}" created${published() ? " and published" : " as draft"}.`,
      );
      resetForm();
      await refetch();
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Could not save partner.");
    } finally {
      setSaving(false);
    }
  };

  const togglePublished = async (partner: PartnerRecord) => {
    setBusyId(partner.id);
    const nextPublished = !partner.published;
    const res = await adminSetPartnerPublished(partner.id, nextPublished);
    if (!res.success) {
      showToast("error", res.error || "Could not update published state.");
    } else {
      showToast(
        "success",
        nextPublished ? `"${partner.name}" is now published.` : `"${partner.name}" is now a draft.`,
      );
      await refetch();
    }
    setBusyId(null);
  };

  const deletePartner = async (partner: PartnerRecord) => {
    if (deleteCandidateId() !== partner.id) {
      setDeleteCandidateId(partner.id);
      return;
    }
    setBusyId(partner.id);
    const res = await adminDeletePartner(partner.id);
    if (!res.success) {
      showToast("error", res.error || "Could not delete partner.");
    } else {
      showToast("success", `"${partner.name}" deleted.`);
      setDeleteCandidateId(null);
      await refetch();
    }
    setBusyId(null);
  };

  const renderPartnerActions = (partner: PartnerRecord) => (
    <div class="flex flex-wrap gap-1">
      <button
        type="button"
        class={`btn btn-xs font-mono ${partner.published ? "btn-success" : "btn-ghost"}`}
        disabled={busyId() === partner.id}
        aria-pressed={partner.published}
        onClick={() => togglePublished(partner)}
      >
        {partner.published ? "Published" : "Draft"}
      </button>
      <button
        type="button"
        class="btn btn-xs btn-ghost font-mono"
        disabled={busyId() === partner.id}
        onClick={() => loadPartner(partner)}
      >
        Edit
      </button>
      <button
        type="button"
        class={`btn btn-xs font-mono ${deleteCandidateId() === partner.id ? "btn-error" : "btn-ghost text-error"}`}
        disabled={busyId() === partner.id}
        onClick={() => deletePartner(partner)}
      >
        {deleteCandidateId() === partner.id ? "Confirm delete" : "Delete"}
      </button>
      <Show when={deleteCandidateId() === partner.id}>
        <button
          type="button"
          class="btn btn-xs btn-ghost font-mono"
          disabled={busyId() === partner.id}
          onClick={() => setDeleteCandidateId(null)}
        >
          Cancel
        </button>
      </Show>
      <Show when={partner.url}>
        <a
          href={partner.url}
          class="btn btn-xs btn-ghost font-mono"
          target="_blank"
          rel="noopener noreferrer"
        >
          Visit
        </a>
      </Show>
    </div>
  );

  return (
    <AdminPageShell
      layoutTitle="Admin: Sponsors & Partners"
      layoutDescription="Manage conference sponsors and partners"
      title="Sponsors & Partners"
      subtitle="Public logo wall & partner network"
      hint="Create records as drafts. Toggle Published to show them on the homepage and /sponsors."
      count={partners()?.length}
      countLoading={partners.loading}
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

      <div class="mb-8">
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
            class={adminFormPanelClass}
          >
            <div class="mb-6">
              <div>
                <h2 class="text-lg font-bold text-white">
                  {editingId() ? "Edit sponsor or partner" : "New sponsor or partner"}
                </h2>
                <p class="text-xs text-gray-500 font-mono mt-1">
                  Logo is required for new records. Use SVG where possible for crisp dark-theme logos.
                </p>
              </div>
            </div>

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
                    class="lg:col-span-7"
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
                    hint="Use a full URL so the public link opens correctly."
                    error="Enter a valid URL, including https://."
                    class="lg:col-span-5"
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
                    required={!editingId()}
                    hint={
                      editingId()
                        ? "Upload a new logo to replace the current file."
                        : "SVG preferred. PNG, JPEG, WebP, or AVIF also accepted. Max 5 MB."
                    }
                    error="Upload a logo before creating the record."
                    class="lg:col-span-12"
                  >
                    <input
                      id="partner-logo"
                      name="logo"
                      type="file"
                      accept="image/svg+xml,image/png,image/jpeg,image/webp,image/avif"
                      required={!editingId()}
                      class={adminFileInputClass("font-mono text-sm")}
                      aria-describedby="partner-logo-hint"
                      aria-errormessage="partner-logo-error"
                      onInvalid={markAdminControlInvalid}
                      onBlur={syncAdminControlValidity}
                      onChange={(e) => {
                        clearAdminControlValidity(e);
                        setLogo(e.currentTarget.files?.[0] ?? null);
                      }}
                    />
                  </AdminFormField>
                </div>
              </AdminFormSection>

              <AdminFormSection
                title="Placement"
                description="Controls which public group this record appears in and whether sponsor tiering applies."
              >
                <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-12 gap-4 lg:gap-5 items-end">
                  <AdminFormField id="partner-type" label="Type" required class="lg:col-span-4">
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
                    <AdminFormField id="partner-tier" label="Sponsor tier" class="lg:col-span-4">
                      <select
                        id="partner-tier"
                        name="tier"
                        class={adminSelectClass()}
                        value={tier() || ""}
                        onChange={(e) => setTier(e.currentTarget.value as PartnerRecord["tier"] | "")}
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
                title="Admin notes"
                description="Private operational context for organizers. This is not shown on the public logo wall."
              >
                <AdminFormField id="partner-description" label="Internal description">
                  <textarea
                    id="partner-description"
                    name="description"
                    class={adminTextareaClass("min-h-28")}
                    value={description()}
                    onInput={(e) => setDescription(e.currentTarget.value)}
                  />
                </AdminFormField>
              </AdminFormSection>

              <AdminFormSection title="Publication">
                <label class="flex items-center gap-4 rounded-xl border border-white/10 bg-white/5 px-4 py-4 cursor-pointer hover:border-primary-500/30 transition-colors">
                  <input
                    id="partner-published"
                    name="published"
                    type="checkbox"
                    class="toggle toggle-success shrink-0"
                    checked={published()}
                    onChange={(e) => setPublished(e.currentTarget.checked)}
                  />
                  <span>
                    <span class="block text-sm font-bold text-white">Publish immediately</span>
                    <span class="block text-xs text-base-content/45 font-mono mt-1">
                      Published records appear on the homepage and /sponsors.
                    </span>
                  </span>
                </label>
              </AdminFormSection>
            </div>

            <div class="mt-6 border-t border-white/10 pt-5 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3">
              <p class="text-xs text-base-content/45 font-mono">
                New records stay drafts unless Publish immediately is enabled.
              </p>
              <div class="flex flex-wrap gap-2 sm:justify-end">
                <button type="button" class="btn btn-ghost font-mono" onClick={resetForm}>
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
        totalCount={partners()?.length}
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

      <Show when={partners.loading}>
        <div class="flex justify-center py-16">
          <span class="loading loading-bars loading-lg text-primary-500"></span>
        </div>
      </Show>

      <Show when={!partners.loading && filtered().length === 0}>
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

      <Show when={!partners.loading && filtered().length > 0}>
        <AdminDataPanel>
          <div class="md:hidden space-y-4 p-4">
            <For each={filtered()}>
              {(partner) => (
                <div class="bg-white/5 rounded-xl p-4 border border-white/10 space-y-3">
                  <div class="flex items-center gap-4">
                    <div class="h-16 w-24 shrink-0 rounded-lg border border-white/10 bg-base-300/80 p-2 flex items-center justify-center">
                      <img
                        src={partnerLogoUrl(partner)}
                        alt={partner.name}
                        class="max-h-full max-w-full object-contain"
                        loading="lazy"
                        width={160}
                        height={80}
                      />
                    </div>
                    <div class="min-w-0">
                      <div class="font-bold text-white truncate">{partner.name}</div>
                      <div class="text-xs font-mono text-gray-500">
                        {typeLabel(partner.type)} · {tierLabel(partner.tier)}
                      </div>
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
                          <img
                            src={partnerLogoUrl(partner)}
                            alt={partner.name}
                            class="max-h-full max-w-full object-contain"
                            loading="lazy"
                            width={160}
                            height={80}
                          />
                        </div>
                      </td>
                      <td>
                        <div class="font-bold text-white">{partner.name}</div>
                        <div class="text-xs font-mono text-gray-500">{partner.id}</div>
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
    </AdminPageShell>
  );
}
