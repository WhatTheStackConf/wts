import { For, Show, createSignal } from "solid-js";
import { createAsyncResource as createResource } from "~/lib/async-resource";
import { clientOnly } from "@solidjs/web";
import { AdminPageShell, adminFormPanelClass, useAdminToast } from "~/components/admin/AdminPageShell";
import { useRequireAdmin } from "~/lib/route-guards";
import { adminUpdateCfpConfig, adminFetchCfpConfig } from "~/lib/admin-actions";
import { authorizedResourceSource } from "~/lib/route-authorization";

const destinations = [
  { title: "Programme", links: [
    { href: "/admin/agenda", label: "Agenda" },
    { href: "/admin/sessions", label: "Sessions" },
    { href: "/admin/speakers", label: "Speakers" },
    { href: "/admin/partners", label: "Sponsors & partners" },
  ] },
  { title: "CFP review", links: [
    { href: "/admin/proposals", label: "Proposal rankings" },
    { href: "/reviewer/weights", label: "Scoring weights" },
    { href: "/reviewer/leaderboard", label: "Reviewer progress" },
  ] },
  { title: "Event operations", links: [
    { href: "/admin/checkin", label: "Check-in stations" },
    { href: "/admin/tickets", label: "Tickets" },
    { href: "/admin/gamification", label: "Gamification" },
    { href: "/mc", label: "MC · live Q&A" },
  ] },
  { title: "Access", links: [
    { href: "/admin/users", label: "Users & roles" },
    { href: "/admin/mcp", label: "MCP tokens" },
  ] },
];

export const AdminDashboard = () => {
  const guard = useRequireAdmin();
  const { toast, showToast } = useAdminToast();
  const [savingCfpConfig, setSavingCfpConfig] = createSignal(false);
  const [deadlineDraft, setDeadlineDraft] = createSignal<string | null>(null);
  const [cfpData, { mutate: setCfpData }] = createResource(
    () => authorizedResourceSource(guard.authorized()),
    async () => {
      const result = await adminFetchCfpConfig();
      return result.success && result.data ? result.data : null;
    },
  );

  const cfpAvailable = () => cfpData()?.cfp_available;
  const deadlineValue = () => deadlineDraft() ?? cfpData()?.cfp_deadline ?? "";

  const handleSaveClosedCfpConfig = async () => {
    const current = cfpData();
    if (savingCfpConfig()) return;
    setSavingCfpConfig(true);
    const draft = deadlineDraft();
    const deadline = draft === null ? current?.cfp_deadline ?? null : draft.trim() || null;
    try {
      const result = await adminUpdateCfpConfig({ cfp_open: false, cfp_deadline: deadline });
      if (result.success) {
        setCfpData((prev) => prev
          ? { ...prev, cfp_open: false, cfp_available: false, cfp_deadline: deadline }
          : { cfp_open: false, cfp_available: false, cfp_deadline: deadline });
        setDeadlineDraft(deadline);
        showToast("success", "Closed CFP configuration saved.");
      } else {
        showToast("error", result.error || "Could not save closed CFP configuration.");
      }
    } catch {
      showToast("error", "Could not confirm the CFP configuration change.");
    } finally {
      setSavingCfpConfig(false);
    }
  };

  return (
    <AdminPageShell layoutTitle="Admin Dashboard" layoutDescription="Conference administration" title="Admin" dashboard toast={toast()}>
      <Show when={guard.authorized()}>
        <nav class="grid gap-x-10 gap-y-8 sm:grid-cols-2" aria-label="Admin workspaces">
          <For each={destinations}>
            {(group) => (
              <section class="min-w-0">
                <h2 class="mb-2 text-lg font-bold text-white">{group.title}</h2>
                <ul class="divide-y divide-white/10 border-t border-white/10">
                  <For each={group.links}>
                    {(link) => (
                      <li>
                        <a href={link.href} class="flex min-h-12 items-center justify-between gap-3 py-3 text-base-content/85 hover:text-primary-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
                          <span>{link.label}</span><span aria-hidden="true">→</span>
                        </a>
                      </li>
                    )}
                  </For>
                </ul>
              </section>
            )}
          </For>
        </nav>

        <section class={`${adminFormPanelClass} mt-8`} aria-labelledby="cfp-settings-title">
          <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 id="cfp-settings-title" class="text-lg font-bold text-white">Call for papers</h2>
              <p class="mt-1 text-sm text-base-content/65">Saving this configuration keeps participant and reviewer workflows unavailable.</p>
              <Show when={cfpData()} fallback={
                <p class="mt-2 text-sm text-base-content/65" role="status">
                  <Show when={cfpData.loading} fallback="Configuration unavailable or incomplete. Save a new closed configuration to initialize it.">
                    Loading CFP configuration…
                  </Show>
                </p>
              }>
                <div class="mt-3 flex flex-wrap items-center gap-3 text-sm">
                  <span class="text-base-content/70">Current CFP status:</span>
                  <span class={`badge font-mono ${cfpAvailable() ? "badge-success" : "badge-error"}`}>
                    {cfpAvailable() ? "Active" : "Closed"}
                  </span>
                  <span class="text-base-content/70">Deadline: {cfpData()?.cfp_deadline || "Not set"}</span>
                </div>
              </Show>
              <label class="mt-4 block text-sm text-base-content/70" for="cfp-deadline">Preparation deadline</label>
              <input id="cfp-deadline" type="date" class="input input-bordered mt-1" value={deadlineValue()} onInput={(event) => setDeadlineDraft(event.currentTarget.value)} />
            </div>
            <button type="button" onClick={handleSaveClosedCfpConfig} disabled={savingCfpConfig() || cfpData.loading}
              class="btn btn-outline btn-error shrink-0 font-mono">
              <Show when={savingCfpConfig()} fallback="Save closed configuration">Saving…</Show>
            </button>
          </div>
        </section>
      </Show>
    </AdminPageShell>
  );
};

export default clientOnly(async () => ({ default: AdminDashboard }), { lazy: true });
