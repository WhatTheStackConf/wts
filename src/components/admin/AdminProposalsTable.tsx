import { createSignal, createEffect, For, Show, createResource } from "solid-js";
import { useAuth } from "~/lib/auth-context";
import { useNavigate } from "@solidjs/router";
import { Icon } from "@iconify-icon/solid";
import { Layout } from "~/layouts/Layout";

import { adminFetchLeaderboardData, deleteSubmission } from "~/lib/admin-actions";
import { getGravatarUrl } from "~/lib/gravatar";
import { CfpSubmissionRecord } from "~/lib/pocketbase-types";

type LeaderboardItem = CfpSubmissionRecord & {
    totalScore: number;
    reviewCount: number;
    expand?: {
        applicant?: {
            email?: string;
            name?: string;
            expand?: {
                user?: {
                    email?: string;
                    name?: string;
                }
            }
        }
    }
};

export default function AdminProposalsTable() {
    const auth = useAuth();
    const navigate = useNavigate();

    // Auth Protection
    createEffect(() => {
        if (auth.isAuthenticated()) {
            if (auth.user?.role !== "admin") {
                navigate("/");
            }
        } else if (!auth.isLoading()) {
            navigate("/login");
        }
    });

    const [submissions, { refetch }] = createResource(async () => {
        const res = await adminFetchLeaderboardData();
        if (res.success) {
            return res.data as LeaderboardItem[];
        }
        return [];
    });

    const [deleteId, setDeleteId] = createSignal<string | null>(null);
    const [isDeleting, setIsDeleting] = createSignal(false);

    const handleDelete = async () => {
        if (!deleteId()) return;
        setIsDeleting(true);
        try {
            const res = await deleteSubmission(deleteId()!);
            if (res.success) {
                await refetch();
                setDeleteId(null);
            } else {
                alert("Failed to delete: " + res.error);
            }
        } catch (e) {
            console.error(e);
            alert("Error deleting submission");
        } finally {
            setIsDeleting(false);
        }
    };

    return (
        <Layout title="Proposals Leaderboard" description="Ranked submissions">
            <div class="min-h-screen pt-24 pb-20 relative overflow-hidden">
                {/* Background Decorations */}
                <div class="absolute top-0 right-0 w-[500px] h-[500px] bg-secondary-900/10 rounded-full blur-[120px] -z-10 pointer-events-none"></div>
                <div class="absolute bottom-0 left-0 w-[500px] h-[500px] bg-primary-900/10 rounded-full blur-[120px] -z-10 pointer-events-none"></div>

                <div class="container mx-auto px-4 max-w-7xl">
                    <div class="flex flex-col md:flex-row justify-between items-center mb-10 gap-4">
                        <div>
                            <h1 class="text-4xl font-black text-transparent bg-clip-text bg-gradient-to-r from-primary-400 to-secondary-400 uppercase drop-shadow-sm mb-2">Proposal Leaderboard</h1>
                            <p class="text-secondary-300 font-mono text-sm">RANKING BASED ON WEIGHTED COMMITTEE SCORES</p>
                        </div>
                        <button
                            class="btn btn-ghost hover:bg-white/10 text-white gap-2 group"
                            onClick={() => navigate("/admin")}
                        >
                            <Icon icon="ph:arrow-left-bold" class="group-hover:-translate-x-1 transition-transform" />
                            Back to Dashboard
                        </button>
                    </div>

                    <Show when={submissions.loading}>
                        <div class="flex justify-center p-20">
                            <span class="loading loading-bars loading-lg text-primary-500"></span>
                        </div>
                    </Show>

                    <Show when={!submissions.loading}>
                        <div class="glass-panel rounded-2xl overflow-hidden border border-white/10 shadow-2xl backdrop-blur-xl bg-black/40">
                            {/* Mobile Card View */}
                            <div class="md:hidden space-y-4 p-4">
                                <For each={submissions()}>
                                    {(item, index) => (
                                        <div class="bg-white/5 rounded-xl p-4 border border-white/10 space-y-3">
                                            <div class="flex justify-between items-start">
                                                <div class="flex items-center gap-2">
                                                    <span class="font-mono font-bold text-accent-400">#{index() + 1}</span>
                                                    <div class={`badge font-mono font-black text-white ${item.totalScore >= 4 ? 'bg-success/20 border-success/40' : item.totalScore >= 3 ? 'bg-warning/20 border-warning/40' : 'bg-error/20 border-error/40'}`}>
                                                        {item.totalScore.toFixed(2)}
                                                    </div>
                                                </div>
                                                <div class={`badge badge-sm font-bold ${item.status === 'accepted' ? 'badge-success text-success' : item.status === 'rejected' ? 'badge-error text-error' : 'badge-ghost opacity-50'}`}>
                                                    {item.status?.toUpperCase() || "PENDING"}
                                                </div>
                                            </div>

                                            <div>
                                                <div class="font-bold text-white leading-tight mb-1">{item.session_title}</div>
                                                <div class="flex items-center gap-2 mt-2">
                                                    <div class="avatar">
                                                        <div class="w-6 rounded-full ring-1 ring-white/20">
                                                            <img
                                                                src={getGravatarUrl(item.expand?.applicant?.expand?.user?.email || item.expand?.applicant?.email)}
                                                                alt={item.expand?.applicant?.expand?.user?.name || "Speaker"}
                                                            />
                                                        </div>
                                                    </div>
                                                    <div class="text-sm text-gray-300">{item.expand?.applicant?.expand?.user?.name || item.expand?.applicant?.name || "Unknown"}</div>
                                                </div>
                                            </div>

                                            <div class="flex justify-between items-center pt-3 border-t border-white/5">
                                                <div class="text-xs font-mono opacity-50">
                                                    {item.reviewCount} Reviews
                                                </div>
                                                <div class="flex items-center gap-2">
                                                    <a
                                                        href={`/reviewer/${item.id}`}
                                                        class="btn btn-sm btn-ghost hover:bg-primary-500/20 hover:text-primary-300 text-gray-400"
                                                    >
                                                        Review
                                                    </a>
                                                    <button
                                                        class="btn btn-sm btn-ghost hover:bg-error/20 hover:text-error text-gray-500"
                                                        onClick={() => setDeleteId(item.id)}
                                                    >
                                                        <Icon icon="ph:trash-bold" />
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </For>
                            </div>

                            {/* Desktop Table View */}
                            <div class="hidden md:block overflow-x-auto">
                                <table class="table table-lg w-full">
                                    <thead>
                                        <tr class="text-white border-b border-white/10 bg-white/5">
                                            <th class="text-center font-mono text-accent-400">#</th>
                                            <th class="text-center font-mono text-secondary-300">SCORE</th>
                                            <th class="font-bold text-gray-300">PROPOSAL</th>
                                            <th class="font-bold text-gray-300">SPEAKER</th>
                                            <th class="text-center font-bold text-gray-300">STATUS</th>
                                            <th class="text-center font-bold text-gray-300">REVIEWS</th>
                                            <th class="text-center font-bold text-gray-300">ACTION</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        <For each={submissions()}>
                                            {(item, index) => (
                                                <tr class="hover:bg-white/5 border-b border-white/5 transition-colors group">
                                                    <td class="text-center font-mono font-bold opacity-50 text-xl group-hover:text-accent-400 transition-colors">
                                                        {index() + 1}
                                                    </td>
                                                    <td class="text-center">
                                                        <div class={`badge badge-lg font-mono font-black text-white ${item.totalScore >= 4 ? 'bg-success/20 border-success/40' : item.totalScore >= 3 ? 'bg-warning/20 border-warning/40' : 'bg-error/20 border-error/40'}`}>
                                                            {item.totalScore.toFixed(2)}
                                                        </div>
                                                    </td>
                                                    <td class="max-w-md">
                                                        <div class="font-bold text-lg text-white mb-1 leading-tight group-hover:text-primary-300 transition-colors">{item.session_title}</div>
                                                        <div class="text-xs font-mono opacity-40">{item.id}</div>
                                                    </td>
                                                    <td>
                                                        <div class="flex items-center gap-3">
                                                            <div class="avatar">
                                                                <div class="w-10 rounded-full ring-1 ring-white/20">
                                                                    <img
                                                                        src={getGravatarUrl(item.expand?.applicant?.expand?.user?.email || item.expand?.applicant?.email)}
                                                                        alt={item.expand?.applicant?.expand?.user?.name || "Speaker"}
                                                                    />
                                                                </div>
                                                            </div>
                                                            <div>
                                                                <div class="font-bold text-gray-200">{item.expand?.applicant?.expand?.user?.name || item.expand?.applicant?.name || "Unknown"}</div>
                                                                <div class="text-xs opacity-50 font-mono">{item.expand?.applicant?.expand?.user?.email || item.expand?.applicant?.email || ""}</div>
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td class="text-center">
                                                        <div class={`badge badge-outline font-bold ${item.status === 'accepted' ? 'badge-success text-success' : item.status === 'rejected' ? 'badge-error text-error' : 'badge-ghost opacity-50'}`}>
                                                            {item.status?.toUpperCase() || "PENDING"}
                                                        </div>
                                                    </td>
                                                    <td class="text-center font-mono opacity-70">
                                                        {item.reviewCount}
                                                    </td>
                                                    <td class="text-center">
                                                        <a
                                                            href={`/reviewer/${item.id}`}
                                                            class="btn btn-sm btn-ghost hover:bg-primary-500/20 hover:text-primary-300 text-gray-400"
                                                            title="Review"
                                                        >
                                                            Review
                                                        </a>
                                                        <button
                                                            class="btn btn-sm btn-ghost hover:bg-error/20 hover:text-error text-gray-500"
                                                            title="Delete"
                                                            onClick={() => setDeleteId(item.id)}
                                                        >
                                                            <Icon icon="ph:trash-bold" />
                                                        </button>
                                                    </td>
                                                </tr>
                                            )}
                                        </For>
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </Show>
                </div>
            </div>


            {/* Delete Confirmation Modal */}
            < Show when={deleteId()} >
                <div class="fixed inset-0 z-[100] flex items-center justify-center p-4">
                    <div class="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => !isDeleting() && setDeleteId(null)}></div>
                    <div class="relative bg-base-100 border border-white/10 rounded-2xl shadow-2xl p-6 max-w-sm w-full animate-scale-in">
                        <h3 class="text-xl font-bold text-white mb-2">Delete Submission?</h3>
                        <p class="text-gray-400 mb-6">
                            Are you sure you want to delete this submission? This action cannot be undone.
                        </p>
                        <div class="flex justify-end gap-3">
                            <button
                                class="btn btn-ghost"
                                onClick={() => setDeleteId(null)}
                                disabled={isDeleting()}
                            >
                                Cancel
                            </button>
                            <button
                                class="btn btn-error"
                                onClick={handleDelete}
                                disabled={isDeleting()}
                            >
                                {isDeleting() ? <span class="loading loading-spinner"></span> : "Delete"}
                            </button>
                        </div>
                    </div>
                </div>
            </Show >
        </Layout >
    );
}
