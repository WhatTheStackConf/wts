import { createEffect, createSignal, Show, For, createResource } from "solid-js";
import { useNavigate, A } from "@solidjs/router";
import { Layout } from "~/layouts/Layout";
import { useAuth } from "~/lib/auth-context";
import { clientOnly } from "@solidjs/start";
import { Icon } from "@iconify-icon/solid";
import pb from "~/lib/pocketbase";

const ReviewerDashboard = () => {
    const auth = useAuth();
    const navigate = useNavigate();
    const [isReviewer, setIsReviewer] = createSignal(false);

    // Fetch all submissions
    // In a real app, this should be filtered by "assigned to me" or "unreviewed"
    // For now, we fetch all submissions as the requirement says "Every submission is anonymized"
    // We will anonymize them in the UI or fetch logic.
    const fetchSubmissions = async () => {
        const { fetchReviewerSubmissions } = await import("~/lib/reviewer-actions");
        const res = await fetchReviewerSubmissions();
        if (res.success) {
            return res.data;
        }
        return [];
    };

    const [submissions] = createResource(fetchSubmissions);

    createEffect(() => {
        if (auth && auth.isAuthenticated()) {
            const user = auth.user;
            if (user?.role === "reviewer" || user?.role === "admin") {
                setIsReviewer(true);
            } else {
                navigate("/"); // Redirect non-reviewers
            }
        } else {
            navigate("/login");
        }
    });

    // ... imports ...

    // ... (logic remains same) ...

    return (
        <Layout title="Reviewer Portal" description="CFP Evaluation">
            <div class="min-h-screen pt-24 pb-20 relative overflow-hidden">
                {/* Background Elements */}
                <div class="absolute top-0 right-0 w-[500px] h-[500px] bg-secondary-900/10 rounded-full blur-[120px] -z-10 pointer-events-none"></div>
                <div class="absolute bottom-0 left-0 w-[500px] h-[500px] bg-primary-900/10 rounded-full blur-[120px] -z-10 pointer-events-none"></div>

                <div class="container mx-auto px-4">
                    <div class="max-w-6xl mx-auto">
                        <div class="flex flex-col md:flex-row justify-between items-center mb-10 gap-6">
                            <div>
                                <h1 class="text-4xl font-black text-transparent bg-clip-text bg-gradient-to-r from-secondary-400 to-primary-400 uppercase drop-shadow-sm mb-2">
                                    Reviewer Portal
                                </h1>
                                <p class="text-secondary-300 font-mono text-sm tracking-widest uppercase">
                                    Queue: {submissions()?.length || 0} submissions
                                </p>
                            </div>
                            <div class="flex gap-3">
                                <button
                                    onClick={() => navigate("/admin/weights")}
                                    class="btn btn-outline border-white/20 hover:border-accent-500 hover:bg-accent-500/10 text-white gap-2 font-mono group"
                                >
                                    <Icon icon="mdi:scale-balance" class="text-xl group-hover:scale-110 transition-transform text-accent-400" />
                                    Vote on Weights
                                </button>
                            </div>
                        </div>

                        <Show when={isReviewer()}>
                            <div class="glass-panel p-8 rounded-2xl border border-white/10 shadow-2xl backdrop-blur-xl bg-black/40">
                                <div class="flex items-center gap-3 mb-8 border-b border-white/10 pb-4">
                                    <div class="p-2 bg-secondary-500/20 rounded-lg text-secondary-400">
                                        <Icon icon="ph:files-bold" class="text-2xl" />
                                    </div>
                                    <h3 class="text-xl font-bold text-white tracking-wide">
                                        SUBMISSIONS QUEUE
                                    </h3>
                                </div>

                                <Show when={submissions.loading}>
                                    <div class="flex justify-center py-12">
                                        <span class="loading loading-bars loading-lg text-secondary"></span>
                                    </div>
                                </Show>

                                <div class="grid gap-4">
                                    <For each={submissions()}>
                                        {(submission) => (
                                            <div class="p-6 bg-white/5 border border-white/5 rounded-xl hover:border-secondary-500/50 hover:bg-white/10 transition-all duration-300 group cursor-pointer" onClick={() => navigate(`/reviewer/${submission.id}`)}>
                                                <div class="flex flex-col md:flex-row justify-between items-start gap-6">
                                                    <div class="flex-1">
                                                        <div class="flex items-center gap-3 mb-2">
                                                            <span class="badge badge-outline border-white/20 text-white/50 font-mono text-xs">ID: {submission.id.substring(0, 8)}</span>
                                                            <span class="text-xs font-mono text-white/40">{new Date(submission.created).toLocaleDateString()}</span>
                                                        </div>
                                                        <h4 class="text-xl font-bold text-white mb-3 group-hover:text-secondary-300 transition-colors leading-tight">
                                                            {submission.session_title || "Untitled Session"}
                                                            {/* Note: changed from session_title to title based on earlier file views, verify if needed */}
                                                        </h4>
                                                        <p class="text-gray-400 text-sm line-clamp-2 leading-relaxed opacity-80 group-hover:opacity-100 transition-opacity">
                                                            {submission.abstract?.replace(/<[^>]*>?/gm, '') || "No abstract provided."}
                                                        </p>
                                                    </div>
                                                    <button
                                                        class="btn btn-primary font-mono gap-2 shrink-0 group-hover:scale-105 transition-transform shadow-lg shadow-primary-500/20"
                                                    >
                                                        <Icon icon="ph:star-half-bold" />
                                                        EVALUATE
                                                    </button>
                                                </div>
                                            </div>
                                        )}
                                    </For>
                                    <Show when={!submissions.loading && submissions()?.length === 0}>
                                        <div class="p-16 text-center border-2 border-dashed border-white/10 rounded-xl bg-white/5">
                                            <Icon icon="ph:tray-bold" class="text-4xl text-white/20 mb-4 block mx-auto" />
                                            <p class="text-secondary-300 font-mono text-lg">NO SUBMISSIONS FOUND</p>
                                            <p class="text-white/30 text-sm mt-2">The queue is currently empty.</p>
                                        </div>
                                    </Show>
                                </div>
                            </div>
                        </Show>
                    </div>
                </div>
            </div>
        </Layout>
    );
};

export default clientOnly(async () => ({ default: ReviewerDashboard }), {
    lazy: true,
});
