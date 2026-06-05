import { createResource, For, Show } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { clientOnly } from "@solidjs/start";
import { Icon } from "@iconify-icon/solid";
import { Layout } from "~/layouts/Layout";
import { useRequireReviewer } from "~/lib/route-guards";
import type { ReviewerLeaderboardRow } from "~/lib/reviewer-actions";

const ReviewerLeaderboard = () => {
    const guard = useRequireReviewer();
    const navigate = useNavigate();

    const [leaderboard] = createResource(
        () => (guard.authorized() ? true : undefined),
        async () => {
            const { fetchReviewerLeaderboard } = await import("~/lib/reviewer-actions");
            const res = await fetchReviewerLeaderboard();
            if (res.success && res.data) return res.data as ReviewerLeaderboardRow[];
            return [];
        },
    );

    const totalReviews = () =>
        (leaderboard() || []).reduce((total, reviewer) => total + reviewer.reviewCount, 0);

    const backPath = () => (guard.user()?.role === "admin" ? "/admin" : "/reviewer");
    const backLabel = () =>
        guard.user()?.role === "admin" ? "Back to Dashboard" : "Back to Portal";

    return (
        <Layout title="Reviewer Leaderboard" description="Reviewer activity counts">
            <Show when={guard.authorized()}>
                <div class="min-h-screen pt-24 pb-20 relative overflow-hidden">
                    <div class="absolute top-0 right-0 w-[500px] h-[500px] bg-secondary-900/10 rounded-full blur-[120px] -z-10 pointer-events-none"></div>
                    <div class="absolute bottom-0 left-0 w-[500px] h-[500px] bg-primary-900/10 rounded-full blur-[120px] -z-10 pointer-events-none"></div>

                    <div class="container mx-auto px-4 max-w-5xl">
                        <div class="flex flex-col md:flex-row justify-between items-start md:items-center mb-10 gap-4">
                            <div>
                                <h1 class="text-4xl font-black text-transparent bg-clip-text bg-gradient-to-r from-secondary-400 to-primary-400 uppercase drop-shadow-sm mb-2">
                                    Reviewer Leaderboard
                                    <Show when={!leaderboard.loading}>
                                        <span class="ml-3 align-middle badge badge-lg font-mono font-black bg-secondary-500/20 border-secondary-500/40 text-secondary-300">
                                            {leaderboard()?.length || 0}
                                        </span>
                                    </Show>
                                </h1>
                                <p class="text-secondary-300 font-mono text-sm tracking-widest uppercase">
                                    Talks reviewed per reviewer
                                </p>
                                <p class="text-xs text-gray-500 font-mono mt-1">
                                    Submission titles and review details are intentionally hidden.
                                </p>
                            </div>
                            <button
                                class="btn btn-ghost hover:bg-white/10 text-white gap-2 group"
                                onClick={() => navigate(backPath())}
                            >
                                <Icon
                                    icon="ph:arrow-left-bold"
                                    class="group-hover:-translate-x-1 transition-transform"
                                />
                                {backLabel()}
                            </button>
                        </div>

                        <Show when={leaderboard.loading}>
                            <div class="flex justify-center p-20">
                                <span class="loading loading-bars loading-lg text-secondary"></span>
                            </div>
                        </Show>

                        <Show when={!leaderboard.loading}>
                            <div class="grid gap-4 md:grid-cols-3 mb-6">
                                <div class="glass-panel p-5 rounded-2xl border border-white/10 bg-black/40 backdrop-blur-xl">
                                    <div class="text-xs font-mono uppercase tracking-widest text-gray-500 mb-2">
                                        Reviewers
                                    </div>
                                    <div class="text-3xl font-black text-white">
                                        {leaderboard()?.length || 0}
                                    </div>
                                </div>
                                <div class="glass-panel p-5 rounded-2xl border border-white/10 bg-black/40 backdrop-blur-xl md:col-span-2">
                                    <div class="text-xs font-mono uppercase tracking-widest text-gray-500 mb-2">
                                        Talks Reviewed
                                    </div>
                                    <div class="text-3xl font-black text-transparent bg-clip-text bg-gradient-to-r from-secondary-300 to-primary-300">
                                        {totalReviews()}
                                    </div>
                                </div>
                            </div>

                            <div class="glass-panel rounded-2xl overflow-hidden border border-white/10 shadow-2xl backdrop-blur-xl bg-black/40">
                                <Show
                                    when={(leaderboard()?.length || 0) > 0}
                                    fallback={
                                        <div class="text-center p-12">
                                            <Icon
                                                icon="ph:clipboard-text-bold"
                                                class="text-5xl text-gray-500 mb-4 block mx-auto"
                                            />
                                            <p class="text-xl font-bold text-white mb-2">
                                                No reviewers yet
                                            </p>
                                            <p class="text-sm text-gray-500 font-mono">
                                                Reviewer activity will appear here once reviewer accounts exist.
                                            </p>
                                        </div>
                                    }
                                >
                                    <div class="overflow-x-auto">
                                        <table class="table table-lg w-full">
                                            <thead>
                                                <tr class="text-white border-b border-white/10 bg-white/5">
                                                    <th class="w-20 font-mono text-secondary-300">RANK</th>
                                                    <th class="font-mono text-secondary-300">REVIEWER</th>
                                                    <th class="text-right font-mono text-secondary-300">
                                                        TALKS REVIEWED
                                                    </th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                <For each={leaderboard()}>
                                                    {(reviewer, index) => (
                                                        <tr class="hover:bg-white/5 border-b border-white/5 transition-colors group">
                                                            <td class="font-mono font-black text-accent-400">
                                                                #{index() + 1}
                                                            </td>
                                                            <td>
                                                                <div class="flex items-center gap-3">
                                                                    <div class="w-10 h-10 rounded-full bg-secondary-500/20 border border-secondary-500/30 flex items-center justify-center text-secondary-200 font-mono font-bold">
                                                                        {reviewer.reviewerName
                                                                            .slice(0, 2)
                                                                            .toUpperCase()}
                                                                    </div>
                                                                    <div>
                                                                        <div class="font-bold text-white">
                                                                            {reviewer.reviewerName}
                                                                        </div>
                                                                        <Show when={reviewer.reviewerId === guard.user()?.id}>
                                                                            <div class="text-xs text-primary-300 font-mono">
                                                                                You
                                                                            </div>
                                                                        </Show>
                                                                    </div>
                                                                </div>
                                                            </td>
                                                            <td class="text-right">
                                                                <span class="text-2xl font-black text-white font-mono">
                                                                    {reviewer.reviewCount}
                                                                </span>
                                                            </td>
                                                        </tr>
                                                    )}
                                                </For>
                                            </tbody>
                                        </table>
                                    </div>
                                </Show>
                            </div>
                        </Show>
                    </div>
                </div>
            </Show>
        </Layout>
    );
};

export default clientOnly(async () => ({ default: ReviewerLeaderboard }), {
    lazy: true,
});
