import { For, Show } from "solid-js";
import { createAsyncResource as createResource } from "~/lib/async-resource";
import { useNavigate } from "@solidjs/router";
import { clientOnly } from "@solidjs/web";
import { Icon } from "~/components/Icon";
import { Layout } from "~/layouts/Layout";
import { useRequireReviewer } from "~/lib/route-guards";
import type { ReviewerLeaderboardRow } from "~/lib/reviewer-actions";
import { authorizedResourceSource } from "~/lib/route-authorization";

const ReviewerLeaderboard = () => {
    const guard = useRequireReviewer();
    const navigate = useNavigate();

    const [leaderboard] = createResource(
        () => authorizedResourceSource(guard.authorized()),
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
        guard.user()?.role === "admin" ? "Back to admin" : "Back to reviews";

    return (
        <Layout title="Reviewer Leaderboard" description="Reviewer activity counts">
            <Show when={guard.authorized()}>
                <div class="min-h-screen w-full max-w-full pt-24 pb-20 relative overflow-hidden">


                    <div class="container mx-auto w-full max-w-full px-4 sm:px-6 md:max-w-5xl">
                        <div class="flex flex-col md:flex-row justify-between items-stretch md:items-center mb-10 gap-4">
                            <div class="min-w-0">
                                <h1 class="text-3xl font-bold text-white mb-2 break-words">
                                    Reviewer leaderboard
                                </h1>
                            </div>
                            <button
                                class="btn btn-ghost w-full justify-center hover:bg-white/10 text-white gap-2 group sm:w-auto"
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
                            <p class="text-sm text-secondary-300 mb-6">
                                {leaderboard()?.length || 0} reviewers · {totalReviews()} reviews
                            </p>

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

                                        </div>
                                    }
                                >
                                    <div class="grid gap-3 p-3 md:hidden">
                                        <For each={leaderboard()}>
                                            {(reviewer, index) => (
                                                <div class="rounded-xl border border-white/10 bg-white/5 p-4">
                                                    <div class="flex items-start justify-between gap-3">
                                                        <div class="flex min-w-0 items-start gap-3">
                                                            <div class="shrink-0 rounded-lg border border-accent-500/30 bg-accent-500/10 px-2 py-1 font-mono text-sm font-black text-accent-300">
                                                                #{index() + 1}
                                                            </div>
                                                            <div class="min-w-0">
                                                                <div class="font-bold text-white break-words">
                                                                    {reviewer.reviewerName}
                                                                </div>
                                                                <Show when={reviewer.reviewerId === guard.user()?.id}>
                                                                    <div class="text-xs text-primary-300 font-mono">
                                                                        You
                                                                    </div>
                                                                </Show>
                                                            </div>
                                                        </div>
                                                        <div class="shrink-0 text-right">
                                                            <div class="text-2xl font-black text-white font-mono leading-none">
                                                                {reviewer.reviewCount}
                                                            </div>
                                                            <div class="mt-1 text-[0.65rem] font-mono uppercase tracking-widest text-gray-500">
                                                                reviewed
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            )}
                                        </For>
                                    </div>

                                    <div class="hidden overflow-x-auto md:block">
                                        <table class="table table-lg w-full table-fixed">
                                            <thead>
                                                <tr class="text-white border-b border-white/10 bg-white/5">
                                                    <th class="w-24 font-mono text-secondary-300">RANK</th>
                                                    <th class="font-mono text-secondary-300">REVIEWER</th>
                                                    <th class="w-48 text-right font-mono text-secondary-300">
                                                        Reviews
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
                                                                <div class="flex min-w-0 items-center gap-3">
                                                                    <div class="w-10 h-10 shrink-0 rounded-full bg-secondary-500/20 border border-secondary-500/30 flex items-center justify-center text-secondary-200 font-mono font-bold">
                                                                        {reviewer.reviewerName
                                                                            .slice(0, 2)
                                                                            .toUpperCase()}
                                                                    </div>
                                                                    <div class="min-w-0">
                                                                        <div class="font-bold text-white break-words">
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
