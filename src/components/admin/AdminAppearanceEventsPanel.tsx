import { createSignal, For, Show } from "solid-js";
import { Icon } from "~/components/Icon";
import {
  AdminFormField,
  adminFormPanelClass,
  adminInputClass,
  clearAdminControlValidity,
  markAdminControlInvalid,
  syncAdminControlValidity,
  type AdminToast,
} from "~/components/admin/AdminPageShell";
import {
  adminCreateAppearanceEvent,
  adminDeleteAppearanceEvent,
  adminUpdateAppearanceEvent,
} from "~/lib/admin-actions";
import type { AppearanceEventRecord } from "~/lib/pocketbase-types";

interface AdminAppearanceEventsPanelProps {
  events: AppearanceEventRecord[];
  loading: boolean;
  error: string | null;
  onChanged: () => unknown;
  showToast: (type: AdminToast["type"], text: string) => void;
}

export function AdminAppearanceEventsPanel(props: AdminAppearanceEventsPanelProps) {
  const [editingId, setEditingId] = createSignal<string | null>(null);
  const [name, setName] = createSignal("");
  const [compactLabel, setCompactLabel] = createSignal("");
  const [destinationUrl, setDestinationUrl] = createSignal("");
  const [displayOrder, setDisplayOrder] = createSignal(0);
  const [published, setPublished] = createSignal(false);
  const [saving, setSaving] = createSignal(false);
  const [deletingId, setDeletingId] = createSignal<string | null>(null);
  const [formError, setFormError] = createSignal<string | null>(null);

  const resetForm = () => {
    setEditingId(null);
    setName("");
    setCompactLabel("");
    setDestinationUrl("");
    setDisplayOrder(0);
    setPublished(false);
    setFormError(null);
  };

  const startCreate = () => {
    const nextOrder = props.events.reduce(
      (highest, event) => Math.max(highest, Number(event.display_order) || 0),
      -1,
    ) + 1;
    setEditingId("new");
    setName("");
    setCompactLabel("");
    setDestinationUrl("");
    setDisplayOrder(nextOrder);
    setPublished(false);
    setFormError(null);
  };

  const startEdit = (event: AppearanceEventRecord) => {
    setEditingId(event.id);
    setName(event.name);
    setCompactLabel(event.compact_label || "");
    setDestinationUrl(event.destination_url || "");
    setDisplayOrder(Number(event.display_order) || 0);
    setPublished(Boolean(event.published));
    setFormError(null);
  };

  const submit = async (submitEvent: Event) => {
    submitEvent.preventDefault();
    const id = editingId();
    if (!id || saving()) return;

    setSaving(true);
    setFormError(null);
    const input = {
      name: name(),
      compactLabel: compactLabel(),
      destinationUrl: destinationUrl(),
      displayOrder: displayOrder(),
      published: published(),
    };

    try {
      const result = id === "new"
        ? await adminCreateAppearanceEvent(input)
        : await adminUpdateAppearanceEvent(id, input);
      if (!result.success) {
        const message = result.error || "Could not save the Appearance Event.";
        setFormError(message);
        props.showToast("error", message);
        return;
      }

      props.showToast(
        "success",
        id === "new" ? `"${name().trim()}" created as an Appearance Event.` : `"${name().trim()}" updated.`,
      );
      resetForm();
      await props.onChanged();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not save the Appearance Event.";
      setFormError(message);
      props.showToast("error", message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (event: AppearanceEventRecord) => {
    if (deletingId()) return;
    if (!window.confirm(`Delete "${event.name}"? Events assigned to Speakers or Event Programmes cannot be deleted.`)) {
      return;
    }

    setDeletingId(event.id);
    try {
      const result = await adminDeleteAppearanceEvent(event.id);
      if (!result.success) {
        props.showToast("error", result.error || "Could not delete the Appearance Event.");
        return;
      }
      props.showToast("success", `"${event.name}" deleted.`);
      if (editingId() === event.id) resetForm();
      await props.onChanged();
    } catch (error) {
      props.showToast(
        "error",
        error instanceof Error ? error.message : "Could not delete the Appearance Event.",
      );
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <section class={`${adminFormPanelClass} mb-8`} aria-labelledby="appearance-events-heading">
      <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 id="appearance-events-heading" class="text-lg font-bold text-white">
            Appearance Events
          </h2>
          <p class="mt-1 max-w-3xl text-xs font-mono leading-relaxed text-base-content/60 text-pretty">
            Create the shared catalogue used by public Speaker ribbons and Event Programmes. Draft
            events can be assigned without appearing publicly.
          </p>
        </div>
        <Show when={!editingId()}>
          <button type="button" class="btn btn-sm btn-outline btn-primary font-mono" onClick={startCreate}>
            <Icon icon="ph:plus-bold" aria-hidden="true" />
            Add event
          </button>
        </Show>
      </div>

      <Show when={props.error}>
        <div class="alert alert-warning mt-5 font-mono text-sm" role="alert">
          <Icon icon="ph:warning-circle-bold" aria-hidden="true" />
          <span>{props.error}</span>
        </div>
      </Show>

      <Show when={editingId()}>
        <form onSubmit={submit} class="mt-6 border-t border-white/10 pt-6">
          <Show when={formError()}>
            <div class="alert alert-error mb-5 font-mono text-sm" role="alert">
              <span>{formError()}</span>
            </div>
          </Show>

          <div class="grid grid-cols-1 gap-4 lg:grid-cols-12 lg:gap-5">
            <AdminFormField
              id="appearance-event-name"
              label="Public name"
              required
              hint="Full name shown on individual Speaker profiles."
              error="Add a public event name before saving."
              class="lg:col-span-7"
            >
              <input
                id="appearance-event-name"
                name="name"
                class={adminInputClass()}
                required
                maxlength="160"
                value={name()}
                aria-describedby="appearance-event-name-hint"
                aria-errormessage="appearance-event-name-error"
                onInvalid={markAdminControlInvalid}
                onBlur={syncAdminControlValidity}
                onInput={(event) => {
                  clearAdminControlValidity(event);
                  setName(event.currentTarget.value);
                }}
              />
            </AdminFormField>

            <AdminFormField
              id="appearance-event-compact-label"
              label="Compact ribbon label"
              hint="Optional label for listing cards; falls back to the public name."
              class="lg:col-span-5"
            >
              <input
                id="appearance-event-compact-label"
                name="compact_label"
                class={adminInputClass()}
                maxlength="60"
                value={compactLabel()}
                aria-describedby="appearance-event-compact-label-hint"
                onInput={(event) => setCompactLabel(event.currentTarget.value)}
              />
            </AdminFormField>

            <AdminFormField
              id="appearance-event-destination-url"
              label="Destination URL"
              hint="Optional future destination; ribbons are not links."
              class="lg:col-span-7"
            >
              <input
                id="appearance-event-destination-url"
                name="destination_url"
                type="url"
                class={adminInputClass("font-mono")}
                placeholder="https://wts.sh"
                value={destinationUrl()}
                aria-describedby="appearance-event-destination-url-hint"
                onInvalid={markAdminControlInvalid}
                onBlur={syncAdminControlValidity}
                onInput={(event) => {
                  clearAdminControlValidity(event);
                  setDestinationUrl(event.currentTarget.value);
                }}
              />
            </AdminFormField>

            <AdminFormField
              id="appearance-event-display-order"
              label="Display order"
              required
              hint="Lower numbers appear first."
              error="Enter a non-negative whole number."
              class="lg:col-span-2"
            >
              <input
                id="appearance-event-display-order"
                name="display_order"
                type="number"
                min="0"
                step="1"
                required
                class={adminInputClass("font-mono")}
                value={displayOrder()}
                aria-describedby="appearance-event-display-order-hint"
                aria-errormessage="appearance-event-display-order-error"
                onInvalid={markAdminControlInvalid}
                onBlur={syncAdminControlValidity}
                onInput={(event) => {
                  clearAdminControlValidity(event);
                  setDisplayOrder(event.currentTarget.valueAsNumber);
                }}
              />
            </AdminFormField>

            <div class="lg:col-span-3 lg:pt-6">
              <label class="flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border border-white/10 bg-black/30 px-4 py-3">
                <input
                  name="published"
                  type="checkbox"
                  class="checkbox checkbox-primary checkbox-sm"
                  checked={published()}
                  onChange={(event) => setPublished(event.currentTarget.checked)}
                />
                <span>
                  <span class="block text-sm font-bold text-white">Published</span>
                  <span class="block text-xs font-mono text-base-content/55">Can appear publicly</span>
                </span>
              </label>
            </div>
          </div>

          <div class="mt-5 flex flex-wrap justify-end gap-2 border-t border-white/10 pt-5">
            <button type="button" class="btn btn-ghost font-mono" disabled={saving()} onClick={resetForm}>
              Cancel
            </button>
            <button type="submit" class="btn btn-primary font-mono" disabled={saving()}>
              <Show when={saving()} fallback="Save Appearance Event">
                <span class="loading loading-spinner loading-xs" aria-hidden="true" />
                Saving...
              </Show>
            </button>
          </div>
        </form>
      </Show>

      <div class="mt-6 border-t border-white/10">
        <Show when={props.loading}>
          <div class="flex justify-center py-8">
            <span class="loading loading-spinner loading-md text-primary-400" />
          </div>
        </Show>
        <Show when={!props.loading && props.events.length === 0}>
          <p class="py-8 text-center text-sm font-mono text-base-content/60">
            No Appearance Events yet. Add the first shared catalogue entry.
          </p>
        </Show>
        <Show when={!props.loading && props.events.length > 0}>
          <ul class="divide-y divide-white/10">
            <For each={props.events}>
              {(event) => (
                <li class="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <div class="min-w-0">
                    <div class="flex flex-wrap items-center gap-2">
                      <span class="font-bold text-white [overflow-wrap:anywhere]">{event.name}</span>
                      <span class={`badge badge-sm font-mono ${event.published ? "badge-success" : "badge-ghost"}`}>
                        <Show when={event.published} fallback="Draft">
                          Published
                        </Show>
                      </span>
                    </div>
                    <p class="mt-1 text-xs font-mono text-base-content/60 [overflow-wrap:anywhere]">
                      Ribbon: {event.compact_label || event.name} · Order {event.display_order}
                    </p>
                  </div>
                  <div class="flex flex-wrap gap-2">
                    <button type="button" class="btn btn-xs btn-ghost font-mono" onClick={() => startEdit(event)}>
                      Edit
                    </button>
                    <button
                      type="button"
                      class="btn btn-xs btn-outline btn-error font-mono"
                      disabled={deletingId() !== null}
                      onClick={() => remove(event)}
                    >
                      <Show when={deletingId() === event.id} fallback="Delete">
                        <span class="loading loading-spinner loading-xs" aria-hidden="true" />
                        Deleting
                      </Show>
                    </button>
                  </div>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </div>
    </section>
  );
}
