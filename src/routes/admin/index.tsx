import { Show, createSignal, onMount } from "solid-js";
import { Layout } from "~/layouts/Layout";
import { clientOnly } from "@solidjs/start";
import { Icon } from "@iconify-icon/solid";
import { useRequireAdmin } from "~/lib/route-guards";
import { adminUpdateCfpConfig, adminFetchCfpConfig } from "~/lib/admin-actions";

const AdminDashboard = () => {
    const guard = useRequireAdmin();

    const [cfpData, setCfpData] = createSignal<{ cfp_open: boolean; cfp_deadline: string | null } | null>(null);
    const [toggling, setToggling] = createSignal(false);

    onMount(async () => {
      const result = await adminFetchCfpConfig();
      if (result.success && result.data) {
        setCfpData(result.data);
      }
    });

    const handleCfpToggle = async () => {
      const current = cfpData();
      if (!current || toggling()) return;
      setToggling(true);
      const newValue = !current.cfp_open;
      const result = await adminUpdateCfpConfig({ cfp_open: newValue });
      if (result.success) {
        setCfpData((prev) => prev ? { ...prev, cfp_open: newValue } : prev);
      }
      setToggling(false);
    };

    return (
        <Layout title="Admin Dashboard" description="System administration">
            <Show when={guard.authorized()}>
                <div class="min-h-screen pt-24 pb-20 relative overflow-hidden">
                    <div class="absolute top-0 right-0 w-[500px] h-[500px] bg-error-900/10 rounded-full blur-[120px] -z-10 pointer-events-none"></div>

                    <div class="container mx-auto px-4">
                        <div class="max-w-6xl mx-auto">
                            <div class="mb-8">
                                <h1 class="text-4xl font-star text-white mb-2">ADMIN DASHBOARD</h1>
                                <p class="text-secondary-300 font-mono">SYSTEM ACCESS LEVEL: ROOT</p>
                            </div>

                            <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
                                <div class="glass-panel p-6 rounded-xl border border-white/10 hover:border-primary-500/50 transition-colors group h-full flex flex-col">
                                    <div class="flex items-center gap-4 mb-4">
                                        <div class="p-3 rounded-lg bg-primary-500/20 text-primary-300">
                                            <Icon icon="ph:users-three-bold" width="24" />
                                        </div>
                                        <h3 class="text-xl font-bold text-white">USERS</h3>
                                    </div>
                                    <p class="text-sm text-secondary-300/80 mb-6 flex-grow">
                                        Manage user accounts, roles, and verification status.
                                    </p>
                                    <a
                                        href="/admin/users"
                                        class="btn btn-outline btn-primary w-full font-mono group-hover:bg-primary-500 group-hover:text-white mt-auto"
                                    >
                                        MANAGE USERS
                                    </a>
                                </div>

                                <div class="glass-panel p-6 rounded-xl border border-white/10 hover:border-secondary-500/50 transition-colors group h-full flex flex-col">
                                    <div class="flex items-center gap-4 mb-4">
                                        <div class="p-3 rounded-lg bg-secondary-500/20 text-secondary-300">
                                            <Icon icon="mdi:podium" width="24" />
                                        </div>
                                        <h3 class="text-xl font-bold text-white">LEADERBOARD</h3>
                                    </div>
                                    <p class="text-sm text-secondary-300/80 mb-6 flex-grow">
                                        View ranked submissions, weighted scores, and reviewer stats.
                                    </p>
                                    <a
                                        href="/admin/proposals"
                                        class="btn btn-outline btn-secondary w-full font-mono group-hover:bg-secondary-500 group-hover:text-white mt-auto"
                                    >
                                        VIEW RANKINGS
                                    </a>
                                </div>

                                <div class="glass-panel p-6 rounded-xl border border-white/10 hover:border-accent-500/50 transition-colors group h-full flex flex-col">
                                    <div class="flex items-center gap-4 mb-4">
                                        <div class="p-3 rounded-lg bg-accent-500/20 text-accent-300">
                                            <Icon icon="mdi:scale-balance" width="24" />
                                        </div>
                                        <h3 class="text-xl font-bold text-white">WEIGHTS</h3>
                                    </div>
                                    <p class="text-sm text-secondary-300/80 mb-6 flex-grow">
                                        Configure scoring criteria and view global weight averages.
                                    </p>
                                    <a
                                        href="/reviewer/weights"
                                        class="btn btn-outline btn-accent w-full font-mono group-hover:bg-accent-500 group-hover:text-white mt-auto"
                                    >
                                        VIEW WEIGHTS
                                    </a>
                                </div>

                                <div class="glass-panel p-6 rounded-xl border border-white/10 hover:border-secondary-500/50 transition-colors group h-full flex flex-col">
                                    <div class="flex items-center gap-4 mb-4">
                                        <div class="p-3 rounded-lg bg-secondary-500/20 text-secondary-300">
                                            <Icon icon="ph:trophy-bold" width="24" />
                                        </div>
                                        <h3 class="text-xl font-bold text-white">REVIEWERS</h3>
                                    </div>
                                    <p class="text-sm text-secondary-300/80 mb-6 flex-grow">
                                        See how many talks each reviewer has reviewed.
                                    </p>
                                    <a
                                        href="/reviewer/leaderboard"
                                        class="btn btn-outline btn-secondary w-full font-mono group-hover:bg-secondary-500 group-hover:text-white mt-auto"
                                    >
                                        VIEW REVIEWERS
                                    </a>
                                </div>

                                <div class="glass-panel p-6 rounded-xl border border-white/10 hover:border-primary-500/50 transition-colors group h-full flex flex-col">
                                    <div class="flex items-center gap-4 mb-4">
                                        <div class="p-3 rounded-lg bg-primary-500/20 text-primary-300">
                                            <Icon icon="ph:microphone-stage-bold" width="24" />
                                        </div>
                                        <h3 class="text-xl font-bold text-white">SPEAKERS</h3>
                                    </div>
                                    <p class="text-sm text-secondary-300/80 mb-6 flex-grow">
                                        Create draft speaker profiles and publish when ready.
                                    </p>
                                    <a
                                        href="/admin/speakers"
                                        class="btn btn-outline btn-primary w-full font-mono group-hover:bg-primary-500 group-hover:text-white mt-auto"
                                    >
                                        MANAGE SPEAKERS
                                    </a>
                                </div>

                                <div class="glass-panel p-6 rounded-xl border border-white/10 hover:border-secondary-500/50 transition-colors group h-full flex flex-col">
                                    <div class="flex items-center gap-4 mb-4">
                                        <div class="p-3 rounded-lg bg-secondary-500/20 text-secondary-300">
                                            <Icon icon="ph:calendar-blank-bold" width="24" />
                                        </div>
                                        <h3 class="text-xl font-bold text-white">SESSIONS</h3>
                                    </div>
                                    <p class="text-sm text-secondary-300/80 mb-6 flex-grow">
                                        Build the programme schedule and link speakers to sessions.
                                    </p>
                                    <a
                                        href="/admin/sessions"
                                        class="btn btn-outline btn-secondary w-full font-mono group-hover:bg-secondary-500 group-hover:text-white mt-auto"
                                    >
                                        MANAGE SESSIONS
                                    </a>
                                </div>

                                <div class="glass-panel p-6 rounded-xl border border-white/10 hover:border-accent-500/50 transition-colors group h-full flex flex-col">
                                    <div class="flex items-center gap-4 mb-4">
                                        <div class="p-3 rounded-lg bg-accent-500/20 text-accent-300">
                                            <Icon icon="ph:handshake-bold" width="24" />
                                        </div>
                                        <h3 class="text-xl font-bold text-white">PARTNERS</h3>
                                    </div>
                                    <p class="text-sm text-secondary-300/80 mb-6 flex-grow">
                                        Add sponsors, organizers, media partners, supporters, and community partners.
                                    </p>
                                    <a
                                        href="/admin/partners"
                                        class="btn btn-outline btn-accent w-full font-mono group-hover:bg-accent-500 group-hover:text-white mt-auto"
                                    >
                                        MANAGE PARTNERS
                                    </a>
                                </div>

                                <div class="glass-panel p-6 rounded-xl border border-white/10 hover:border-warning-500/50 transition-colors group h-full flex flex-col">
                                    <div class="flex items-center gap-4 mb-4">
                                        <div class="p-3 rounded-lg bg-warning-500/20 text-warning-300">
                                            <Icon icon="ph:ticket-bold" width="24" />
                                        </div>
                                        <h3 class="text-xl font-bold text-white">TICKETS</h3>
                                    </div>
                                    <p class="text-sm text-secondary-300/80 mb-6 flex-grow">
                                        Sync ticket data and view attendee lists.
                                    </p>
                                    <a
                                        href="/admin/tickets"
                                        class="btn btn-outline btn-warning w-full font-mono group-hover:bg-warning-500 group-hover:text-white mt-auto"
                                    >
                                        VIEW TICKETS
                                    </a>
                                </div>

                                <div class="glass-panel p-6 rounded-xl border border-white/10 hover:border-info-500/50 transition-colors group h-full flex flex-col">
                                    <div class="flex items-center gap-4 mb-4">
                                        <div class="p-3 rounded-lg bg-info-500/20 text-info-300">
                                            <Icon icon="ph:microphone-stage-bold" width="24" />
                                        </div>
                                        <h3 class="text-xl font-bold text-white">CfP SETTINGS</h3>
                                    </div>
                                    <p class="text-sm text-secondary-300/80 mb-4 flex-grow">
                                        Open or close call for papers submissions.
                                    </p>
                                    <Show when={cfpData()}>
                                      <div class="space-y-3 mb-4">
                                        <div class="flex items-center justify-between">
                                          <span class="text-sm font-mono text-secondary-300">Status:</span>
                                          <span class={`badge font-mono ${cfpData()?.cfp_open ? 'badge-success' : 'badge-error'}`}>
                                            {cfpData()?.cfp_open ? 'OPEN' : 'CLOSED'}
                                          </span>
                                        </div>
                                        <div class="flex items-center justify-between">
                                          <span class="text-sm font-mono text-secondary-300">Deadline:</span>
                                          <span class="text-sm font-mono text-white">
                                            {cfpData()?.cfp_deadline
                                              ? new Date(cfpData()!.cfp_deadline!).toLocaleDateString("en-US", {
                                                  year: "numeric",
                                                  month: "short",
                                                  day: "numeric",
                                                })
                                              : "Not set"}
                                          </span>
                                        </div>
                                      </div>
                                    </Show>
                                    <button
                                      onClick={handleCfpToggle}
                                      disabled={toggling() || !cfpData()}
                                      class={`btn btn-outline w-full font-mono mt-auto ${
                                        cfpData()?.cfp_open
                                          ? "btn-error hover:bg-error-500 hover:text-white"
                                          : "btn-success hover:bg-success-500 hover:text-white"
                                      }`}
                                    >
                                      {toggling()
                                        ? "SAVING..."
                                        : cfpData()?.cfp_open
                                          ? "CLOSE CfP"
                                          : "OPEN CfP"}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </Show>
        </Layout>
    );
};

export default clientOnly(async () => ({ default: AdminDashboard }), {
    lazy: true,
});
