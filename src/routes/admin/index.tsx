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
  const [toggling, setToggling] = createSignal(false);
  const [cfpData, { mutate: setCfpData }] = createResource(
    () => authorizedResourceSource(guard.authorized()),
    async () => {
      const result = await adminFetchCfpConfig();
      return result.success && result.data ? result.data : null;
    },
  );

  const handleCfpToggle = async () => {
    const current = cfpData();
    if (!current || toggling()) return;
    setToggling(true);
    const newValue = !current.cfp_open;
    try {
      const result = await adminUpdateCfpConfig({ cfp_open: newValue });
      if (result.success) {
        setCfpData((prev) => prev ? { ...prev, cfp_open: newValue } : prev);
        showToast("success", newValue ? "CFP opened." : "CFP closed.");
      } else {
        showToast("error", result.error || "Could not update CFP status. Refresh to check its status before retrying.");
      }
    } catch {
      showToast("error", "Could not confirm the CFP change. Refresh to check its status before retrying.");
    } finally {
      setToggling(false);
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
              <p class="mt-1 text-sm text-base-content/65">Open or close proposal submissions.</p>
              <Show when={cfpData()} fallback={
                <p class="mt-2 text-sm text-base-content/65" role="status">
                  {cfpData.loading ? "Loading CFP status…" : "CFP status unavailable. Refresh to try again."}
                </p>
              }>
                <div class="mt-3 flex flex-wrap items-center gap-3 text-sm">
                  <span class={`badge font-mono ${cfpData()?.cfp_open ? "badge-success" : "badge-error"}`}>
                    {cfpData()?.cfp_open ? "Open" : "Closed"}
                  </span>
                  <span class="text-base-content/70">Deadline: {cfpData()?.cfp_deadline
                    ? new Date(cfpData()!.cfp_deadline!).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })
                    : "Not set"}</span>
                </div>
              </Show>
            </div>
            <button type="button" onClick={handleCfpToggle} disabled={toggling() || !cfpData()}
              class={`btn btn-outline shrink-0 font-mono ${cfpData()?.cfp_open ? "btn-error" : "btn-success"}`}>
              {toggling() ? "Saving…" : cfpData()?.cfp_open ? "Close CFP" : "Open CFP"}
            </button>
          </div>
        </section>
      </Show>
    </AdminPageShell>
  );
};

export default clientOnly(async () => ({ default: AdminDashboard }), { lazy: true });
