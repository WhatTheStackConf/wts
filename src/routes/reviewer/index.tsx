import { Show, For, createResource } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { Layout } from "~/layouts/Layout";
import { clientOnly } from "@solidjs/start";
import { Icon } from "@iconify-icon/solid";
import { useRequireReviewer } from "~/lib/route-guards";

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
        () => (guard.authorized() ? true : undefined),
        fetchSubmissions,
    );

    const reviewRandom = () => {
        const unreviewed = data()?.unreviewed;
        if (!unreviewed || unreviewed.length === 0) return;
        const random = unreviewed[Math.floor(Math.random() * unreviewed.length)];
        navigate(`/reviewer/${random.id}`);
    };

    return (
        <Layout title="Reviewer Portal" description="CFP Evaluation">
            <Show when={guard.authorized()}>
                <div class="min-h-screen w-full max-w-full pt-24 pb-20 relative overflow-hidden">
                    <div class="absolute top-0 right-0 w-[500px] h-[500px] bg-secondary-900/10 rounded-full blur-[120px] -z-10 pointer-events-none"></div>
                    <div class="absolute bottom-0 left-0 w-[500px] h-[500px] bg-primary-900/10 rounded-full blur-[120px] -z-10 pointer-events-none"></div>

                    <div class="container mx-auto w-full max-w-full px-4">
                        <div class="w-full max-w-4xl mx-auto">
                            <div class="flex flex-col md:flex-row justify-between items-stretch md:items-center mb-10 gap-6">
                                <div class="min-w-0">
                                    <h1 class="text-3xl sm:text-4xl font-black text-transparent bg-clip-text bg-gradient-to-r from-secondary-400 to-primary-400 uppercase drop-shadow-sm mb-2 break-words">
                                        Reviewer Portal
                                    </h1>
                                    <p class="text-secondary-300 font-mono text-sm tracking-widest uppercase">
                                        CFP Evaluation
                                    </p>
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
                                        Vote on Weights
                                    </button>
                                </div>
                            </div>

                            <Show when={data.loading}>
                                <div class="flex justify-center py-12">
                                    <span class="loading loading-bars loading-lg text-secondary"></span>
                                </div>
                            </Show>

                            <Show when={!data.loading}>
                                <div class="glass-panel p-5 sm:p-8 md:p-12 rounded-2xl border border-white/10 shadow-2xl backdrop-blur-xl bg-black/40 text-center mb-8">
                                    <Show
                                        when={(data()?.totalLeft ?? 0) > 0}
                                        fallback={
                                            <div class="py-8">
                                                <Icon
                                                    icon="ph:check-circle-bold"
                                                    class="text-6xl text-green-400 mb-4 block mx-auto"
                                                />
                                                <p class="text-2xl font-bold text-white mb-2">
                                                    All caught up!
                                                </p>
                                                <p class="text-white/50 font-mono text-sm">
                                                    You've reviewed every submission in the
                                                    queue.
                                                </p>
                                            </div>
                                        }
                                    >
                                        <div class="py-4">
                                            <p class="text-white/50 font-mono text-sm uppercase tracking-widest mb-6">
                                                {data()!.totalLeft} submission
                                                {data()!.totalLeft !== 1 ? "s" : ""} left to
                                                review
                                            </p>
                                            <button
                                                onClick={reviewRandom}
                                                class="btn btn-primary btn-lg h-auto min-h-14 w-full max-w-full whitespace-normal font-mono gap-3 text-base shadow-lg shadow-primary-500/30 hover:shadow-primary-500/50 transition-all sm:w-auto sm:text-lg sm:hover:scale-105"
                                            >
                                                <Icon icon="ph:shuffle-bold" class="text-2xl shrink-0" />
                                                Review Next Submission
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
                                            <h3 class="min-w-0 text-lg font-bold text-white tracking-wide break-words">
                                                YOUR REVIEWS ({data()!.reviewed.length})
                                            </h3>
                                        </div>

                                        <div class="grid gap-3">
                                            <For each={data()!.reviewed}>
                                                {(submission) => (
                                                    <div
                                                        class="p-4 bg-white/5 border border-white/5 rounded-xl hover:border-green-500/30 hover:bg-white/10 transition-all duration-300 group cursor-pointer flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center sm:gap-4"
                                                        onClick={() =>
                                                            navigate(`/reviewer/${submission.id}`)
                                                        }
                                                    >
                                                        <div class="w-full min-w-0 flex-1 sm:w-auto">
                                                            <h4 class="text-white font-semibold group-hover:text-green-300 transition-colors break-words sm:truncate">
                                                                {submission.session_title ||
                                                                    "Untitled Session"}
                                                            </h4>
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
                                                    </div>
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
