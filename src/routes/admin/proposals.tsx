import { createSignal, createEffect, For, Show } from "solid-js";
import { useAuth } from "~/lib/auth-context";
import { pb } from "~/lib/pocketbase-utils";
import { useNavigate } from "@solidjs/router";
import { Icon } from "@iconify-icon/solid";
import { Layout } from "~/layouts/Layout";

const CRITERIA = [
    { id: "relevance", label: "Relevance" },
    { id: "originality", label: "Originality" },
    { id: "depth", label: "Depth" },
    { id: "clarity", label: "Clarity" },
    { id: "takeaways", label: "Takeaways" },
    { id: "engagement", label: "Engagement" },
];

import { getGravatarUrl } from "~/lib/gravatar";

export default function AdminProposals() {
    const auth = useAuth();
    const navigate = useNavigate();
    const [loading, setLoading] = createSignal(true);
    const [submissions, setSubmissions] = createSignal<any[]>([]);

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

    const fetchData = async () => {
        setLoading(true);
        try {
            // 1. Fetch EVERYTHING
            const [subs, reviews, votes] = await Promise.all([
                pb.collection("cfp_submissions").getFullList({ expand: "applicant.user", sort: "-created" }),
                pb.collection("cfp_reviews").getFullList(),
                pb.collection("cfp_weight_votes").getFullList()
            ]);

            // 2. Calculate Global Weights
            const weights: Record<string, number> = {};
            if (votes.length > 0) {
                CRITERIA.forEach(c => {
                    const sum = votes.reduce((acc, v) => acc + (v[c.id] || 0), 0);
                    weights[c.id] = sum / votes.length;
                });
            } else {
                // Default weights if no votes yet (all 1)
                CRITERIA.forEach(c => weights[c.id] = 1);
            }

            // 3. Process Submissions
            const scoredSubmissions = subs.map(sub => {
                const subReviews = reviews.filter((r: any) => r.submission === sub.id);

                if (subReviews.length === 0) {
                    return { ...sub, totalScore: 0, reviewCount: 0 };
                }

                // Calculate score for each review based on weights
                const reviewScores = subReviews.map((r: any) => {
                    let rScore = 0;
                    CRITERIA.forEach(c => {
                        const criteriaScore = r[`score_${c.id}`] || 0; // Note: review fields are 'score_relevance'
                        // Wait, my previous code used 'score_relevance' in DB but CRITERIA ids were 'relevance' in weights.
                        // Let's ensure mapping is correct.
                        // DB cfp_reviews has: score_relevance, score_originality...
                        // DB cfp_weight_votes has: relevance, originality...

                        rScore += criteriaScore * (weights[c.id] || 1);
                    });
                    return rScore;
                });

                // Average of all reviews
                const totalScore = reviewScores.reduce((a, b) => a + b, 0) / subReviews.length;

                return {
                    ...sub,
                    totalScore: totalScore,
                    reviewCount: subReviews.length
                };
            });

            // 4. Sort by Score Descending
            scoredSubmissions.sort((a, b) => b.totalScore - a.totalScore);

            setSubmissions(scoredSubmissions);

        } catch (e) {
            console.error("Error loading proposals:", e);
        } finally {
            setLoading(false);
        }
    };

    createEffect(() => {
        if (auth.user?.role === "admin") {
            fetchData();
        }
    });

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

                    <Show when={loading()}>
                        <div class="flex justify-center p-20">
                            <span class="loading loading-bars loading-lg text-primary-500"></span>
                        </div>
                    </Show>

                    <Show when={!loading()}>
                        <div class="glass-panel rounded-2xl p-1 overflow-hidden border border-white/10 shadow-2xl backdrop-blur-xl bg-black/40">
                            <div class="overflow-x-auto">
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
                                                        >
                                                            Review
                                                        </a>
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
        </Layout>
    );
}
