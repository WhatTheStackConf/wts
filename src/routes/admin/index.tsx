import { createEffect, createSignal, Show } from "solid-js";
import { useNavigate, A } from "@solidjs/router";
import { Layout } from "~/layouts/Layout";
import { useAuth } from "~/lib/auth-context";
import { clientOnly } from "@solidjs/start";
import { Icon } from "@iconify-icon/solid";

const AdminDashboard = () => {
    const auth = useAuth();
    const navigate = useNavigate();
    const [isAdmin, setIsAdmin] = createSignal(false);

    createEffect(() => {
        if (auth && auth.isAuthenticated()) {
            const user = auth.user;
            if (user?.role === "admin") {
                setIsAdmin(true);
            } else {
                navigate("/"); // Redirect non-admins
            }
        } else {
            navigate("/login");
        }
    });

    return (
        <Layout title="Admin Dashboard" description="System administration">
            <div class="min-h-screen pt-24 pb-20 relative overflow-hidden">
                {/* Background Elements */}
                <div class="absolute top-0 right-0 w-[500px] h-[500px] bg-error-900/10 rounded-full blur-[120px] -z-10 pointer-events-none"></div>

                <div class="container mx-auto px-4">
                    <div class="max-w-6xl mx-auto">
                        <div class="mb-8">
                            <h1 class="text-4xl font-star text-white mb-2">ADMIN DASHBOARD</h1>
                            <p class="text-secondary-300 font-mono">SYSTEM ACCESS LEVEL: ROOT</p>
                        </div>

                        <Show when={isAdmin()}>
                            <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">



                                {/* Users Card */}
                                {/* Users Card */}
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

                                {/* Leaderboard Module */}
                                {/* Leaderboard Module */}
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

                                {/* Weights Card */}
                                {/* Weights Card */}
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
                                        href="/admin/weights"
                                        class="btn btn-outline btn-accent w-full font-mono group-hover:bg-accent-500 group-hover:text-white mt-auto"
                                    >
                                        MANAGE WEIGHTS
                                    </a>
                                </div>

                                {/* Speakers Module */}
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

                                {/* Sessions Module */}
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

                                {/* Tickets Module */}
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

                            </div>
                        </Show>
                    </div>
                </div>
            </div>
        </Layout>
    );
};

export default clientOnly(async () => ({ default: AdminDashboard }), {
    lazy: true,
});
