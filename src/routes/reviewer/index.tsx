import { Show, For } from "solid-js";
import { createAsyncResource as createResource } from "~/lib/async-resource";
import { useNavigate } from "@solidjs/router";
import { Layout } from "~/layouts/Layout";
import { clientOnly } from "@solidjs/web";
import { Icon } from "~/components/Icon";
import { useRequireReviewer } from "~/lib/route-guards";
import { authorizedResourceSource } from "~/lib/route-authorization";

const ReviewerDashboard = () => {
    const guard = useRequireReviewer();
    const navigate = useNavigate();

    const fetchSubmissions = async () => {
        const { fetchReviewerSubmissions } = await import("~/lib/reviewer-actions");
        const res = await fetchReviewerSubmissions();
        if (res.success && res.data) {
            return res.data;
        }
        return { reviewed: [], unreviewed: [], totalLeft: 0 };
    };

    const [data] = createResource(
        () => authorizedResourceSource(guard.authorized()),
        fetchSubmissions,
    );

    const reviewRandom = () => {
        const unreviewed = data()?.unreviewed;
        if (!unreviewed || unreviewed.length === 0) return;
        const random = unreviewed[Math.floor(Math.random() * unreviewed.length)];
        navigate(`/reviewer/${random.id}`);
    };

    return (
        <Layout title="Review proposals" description="CFP Evaluation">
            <Show when={guard.authorized()}>
                <div class="min-h-screen w-full max-w-full pt-24 pb-20 relative overflow-hidden">


                    <div class="container mx-auto w-full max-w-full px-4">
                        <div class="w-full max-w-4xl mx-auto">
                            <div class="flex flex-col md:flex-row justify-between items-stretch md:items-center mb-10 gap-6">
                                <div class="min-w-0">
                                    <h1 class="text-3xl font-bold text-white mb-2 break-words">
                                        Review proposals
                                    </h1>
                                </div>
                                <div class="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
                                    <button
                                        onClick={() => navigate("/reviewer/leaderboard")}
                                        class="btn btn-outline w-full justify-center border-white/20 hover:border-secondary-500 hover:bg-secondary-500/10 text-white gap-2 font-mono group sm:w-auto"
                                    >
                                        <Icon
                                            icon="ph:trophy-bold"
                                            class="text-xl group-hover:scale-110 transition-transform text-secondary-400"
                                        />
                                        Leaderboard
                                    </button>
                                    <button
                                        onClick={() => navigate("/reviewer/weights")}
                                        class="btn btn-outline w-full justify-center border-white/20 hover:border-accent-500 hover:bg-accent-500/10 text-white gap-2 font-mono group sm:w-auto"
                                    >
                                        <Icon
                                            icon="mdi:scale-balance"
                                            class="text-xl group-hover:scale-110 transition-transform text-accent-400"
                                        />
                                        Criteria weights
                                    </button>
                                </div>
                            </div>

                            <Show when={data.loading}>
                                <div class="flex justify-center py-12">
                                    <span class="loading loading-bars loading-lg text-secondary"></span>
                                </div>
                            </Show>

                            <Show when={!data.loading}>
                                <div class="glass-panel p-5 sm:p-8 rounded-2xl border border-white/10 bg-black/40 mb-8">
                                    <Show
                                        when={(data()?.totalLeft ?? 0) > 0}
                                        fallback={
                                            <div>
                                                <p class="text-lg font-bold text-white">
                                                    No proposals left to review
                                                </p>
                                            </div>
                                        }
                                    >
                                        <div class="flex flex-wrap items-center justify-between gap-4">
                                            <p class="text-secondary-300 text-sm">
                                                {data()!.totalLeft} submission
                                                {data()!.totalLeft !== 1 ? "s" : ""} left to
                                                review
                                            </p>
                                            <button
                                                onClick={reviewRandom}
                                                class="btn btn-primary w-full gap-2 sm:w-auto"
                                            >
                                                <Icon icon="ph:shuffle-bold" class="text-2xl shrink-0" />
                                                Review next
                                            </button>
                                        </div>
                                    </Show>
                                </div>

                                <Show when={(data()?.reviewed?.length ?? 0) > 0}>
                                    <div class="glass-panel p-4 sm:p-6 md:p-8 rounded-2xl border border-white/10 shadow-xl backdrop-blur-xl bg-black/40">
                                        <div class="flex min-w-0 items-center gap-3 mb-6 border-b border-white/10 pb-4">
                                            <div class="p-2 bg-green-500/20 rounded-lg text-green-400 shrink-0">
                                                <Icon icon="ph:check-square-bold" class="text-xl" />
                                            </div>
                                            <h2 class="min-w-0 text-lg font-bold text-white break-words">
                                                Your reviews ({data()!.reviewed.length})
                                            </h2>
                                        </div>

                                        <div class="grid gap-3">
                                            <For each={data()!.reviewed}>
                                                {(submission) => (
                                                    <a
                                                        href={`/reviewer/${submission.id}`}
                                                        class="p-4 bg-white/5 border border-white/5 rounded-xl hover:border-green-500/30 hover:bg-white/10 transition-all duration-300 group cursor-pointer flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center sm:gap-4"
                                                    >
                                                        <div class="w-full min-w-0 flex-1 sm:w-auto">
                                                            <h3 class="text-white font-semibold group-hover:text-green-300 transition-colors break-words sm:truncate">
                                                                {submission.session_title ||
                                                                    "Untitled Session"}
                                                            </h3>
                                                        </div>
                                                        <div class="flex flex-wrap items-center gap-2 shrink-0">
                                                            <span class="badge badge-outline border-green-500/30 text-green-400 font-mono text-xs">
                                                                Reviewed
                                                            </span>
                                                            <Icon
                                                                icon="ph:arrow-right-bold"
                                                                class="text-white/30 group-hover:text-green-400 transition-colors"
                                                            />
                                                        </div>
                                                    </a>
                                                )}
                                            </For>
                                        </div>
                                    </div>
                                </Show>
                            </Show>
                        </div>
                    </div>
                </div>
            </Show>
        </Layout>
    );
};

export default clientOnly(async () => ({ default: ReviewerDashboard }), {
    lazy: true,
});
