import { createSignal, createEffect, For, Show } from "solid-js";
import { useAuth } from "~/lib/auth-context";
import { pb } from "~/lib/pocketbase-utils";
import { useNavigate } from "@solidjs/router";
import { Icon } from "@iconify-icon/solid";
import { Layout } from "~/layouts/Layout";

// Criteria definitions
const CRITERIA = [
    { id: "relevance", label: "Relevance" },
    { id: "originality", label: "Originality" },
    { id: "depth", label: "Depth" },
    { id: "clarity", label: "Clarity" },
    { id: "takeaways", label: "Takeaways" },
    { id: "engagement", label: "Engagement" },
];

export default function AdminWeights() {
    const auth = useAuth();
    const navigate = useNavigate();
    const [loading, setLoading] = createSignal(true);
    const [saving, setSaving] = createSignal(false);
    const [success, setSuccess] = createSignal(false);

    // State for user's votes
    const [votes, setVotes] = createSignal<Record<string, number>>({
        relevance: 1,
        originality: 1,
        depth: 1,
        clarity: 1,
        takeaways: 1,
        engagement: 1,
    });

    const [voteId, setVoteId] = createSignal<string | null>(null);

    // State for global averages
    const [averages, setAverages] = createSignal<Record<string, string>>({});

    // Auth check
    createEffect(() => {
        if (auth.isAuthenticated()) {
            if (auth.user?.role !== "admin" && auth.user?.role !== "reviewer") {
                navigate("/");
            } else {
                fetchData();
            }
        } else if (!auth.isLoading()) {
            navigate("/login");
        }
    });

    const fetchData = async () => {
        if (!auth?.user?.id) return;
        setLoading(true);
        try {
            const records = await pb.collection("cfp_weight_votes").getFullList();

            // Calculate averages
            let tempAvg: any = {};
            if (records.length > 0) {
                CRITERIA.forEach(c => {
                    const sum = records.reduce((acc, r: any) => acc + (r[c.id] || 0), 0);
                    tempAvg[c.id] = (sum / records.length).toFixed(2);
                });
                setAverages(tempAvg);
            }

            // Find my vote (if reviewer)
            if (auth.user?.role === "reviewer") {
                const myVote = records.find((r: any) => r.user === auth.user!.id);
                if (myVote) {
                    setVoteId(myVote.id);
                    const v: any = {};
                    CRITERIA.forEach(c => v[c.id] = (myVote as any)[c.id]);
                    setVotes(v);
                }
            } else if (auth.user?.role === "admin") {
                // Admin Visualization: Show averages on sliders
                const v: any = {};
                CRITERIA.forEach(c => v[c.id] = Math.round(parseFloat(tempAvg[c.id] || "1")));
                setVotes(v);
            }

        } catch (e) {
            console.error("Error fetching weights:", e);
        } finally {
            setLoading(false);
        }
    };

    const handleSliderChange = (id: string, val: string) => {
        setVotes(prev => ({ ...prev, [id]: parseInt(val) }));
        setSuccess(false);
    };

    const handleSave = async () => {
        if (!auth?.user?.id) return;
        setSaving(true);
        setSuccess(false);
        try {
            const data = {
                user: auth.user.id,
                ...votes()
            };

            if (voteId()) {
                await pb.collection("cfp_weight_votes").update(voteId()!, data);
            } else {
                const created = await pb.collection("cfp_weight_votes").create(data);
                setVoteId(created.id);
            }
            setSuccess(true);
            setTimeout(() => setSuccess(false), 3000);
            // Refresh averages
            fetchData();
        } catch (e) {
            console.error("Error saving weights:", e);
            alert("Failed to save weights.");
        } finally {
            setSaving(false);
        }
    };

    const isReviewer = () => auth?.user?.role === "reviewer";
    const hasVoted = () => !!voteId();

    // ... imports ...

    // ... (logic remains same) ...

    return (
        <Layout title="Vote on Weights" description="Committee Weighting">
            <div class="min-h-screen pt-24 pb-20 relative overflow-hidden">
                {/* Background Decorations */}
                <div class="absolute top-0 right-0 w-[500px] h-[500px] bg-accent-900/10 rounded-full blur-[120px] -z-10 pointer-events-none"></div>
                <div class="absolute bottom-0 left-0 w-[500px] h-[500px] bg-primary-900/10 rounded-full blur-[120px] -z-10 pointer-events-none"></div>

                <div class="container mx-auto px-4 max-w-3xl">
                    <div class="flex items-center justify-between mb-8">
                        <div>
                            <h1 class="text-3xl font-black text-transparent bg-clip-text bg-gradient-to-r from-primary-400 to-accent-400 uppercase drop-shadow-sm mb-1">Weighting Vote</h1>
                            <p class="text-secondary-300 font-mono text-sm">COMMITTEE SCORING CRITERIA</p>
                        </div>
                        <button
                            class="btn btn-ghost hover:bg-white/10 text-white gap-2 group"
                            onClick={() => navigate(isReviewer() ? "/reviewer" : "/admin")}
                        >
                            <Icon icon="ph:arrow-left-bold" class="group-hover:-translate-x-1 transition-transform" />
                            {isReviewer() ? "Back to Portal" : "Back to Dashboard"}
                        </button>
                    </div>

                    <div class="glass-panel p-8 rounded-2xl border border-white/10 shadow-2xl backdrop-blur-xl bg-black/40">
                        <Show when={!isReviewer()}>
                            <div class="alert alert-info bg-primary-900/30 border-primary-500/30 text-primary-200 mb-8 shadow-lg backdrop-blur-md">
                                <Icon icon="ph:eye-bold" class="text-2xl" />
                                <div>
                                    <h3 class="font-bold">Admin View Mode</h3>
                                    <div class="text-xs opacity-80">You are viewing the calculated averages of all committee votes. Only Reviewers can cast votes.</div>
                                </div>
                            </div>
                        </Show>

                        <p class="mb-8 text-sm text-gray-400 leading-relaxed border-l-2 border-accent-500 pl-4">
                            {isReviewer()
                                ? "As a committee member, please assign a weight (1-6) to each criteria. The final weight used in the scoring formula will be the average of all committee members' votes."
                                : "Current global averages across all criteria. These weights determine the final score calculation for proposals."
                            }
                        </p>

                        <Show when={hasVoted() && isReviewer()}>
                            <div class="alert alert-success bg-success-900/30 border-success-500/30 text-success-200 mb-8 shadow-lg">
                                <Icon icon="mdi:check-circle" class="text-2xl" />
                                <div>
                                    <h3 class="font-bold">Vote Cast!</h3>
                                    <div class="text-xs">You have successfully submitted your weight preferences.</div>
                                </div>
                            </div>
                        </Show>

                        <Show when={loading()}>
                            <div class="flex justify-center py-10">
                                <span class="loading loading-bars loading-lg text-primary-500"></span>
                            </div>
                        </Show>

                        <Show when={!loading()}>
                            <div class="space-y-8">
                                <For each={CRITERIA}>
                                    {(item) => (
                                        <div class="form-control group">
                                            <div class="flex justify-between items-end mb-3">
                                                <label class="label cursor-pointer flex-col items-start p-0">
                                                    <span class="label-text font-bold text-lg text-white group-hover:text-primary-300 transition-colors uppercase tracking-wide">{item.label}</span>
                                                    <span class="label-text-alt text-gray-500 font-mono text-xs mt-1">
                                                        GLOBAL AVG: <span class="text-secondary-400">{averages()[item.id] || "-"}</span>
                                                    </span>
                                                </label>
                                                <div class="flex flex-col items-end">
                                                    <span class="font-mono text-3xl font-black text-transparent bg-clip-text bg-gradient-to-br from-primary-400 to-white drop-shadow-sm">{votes()[item.id]}</span>
                                                </div>
                                            </div>
                                            <input
                                                type="range"
                                                min="1"
                                                max="6"
                                                step="1"
                                                value={votes()[item.id]}
                                                class="range range-primary range-lg"
                                                disabled={!isReviewer() || hasVoted()}
                                                onInput={(e) => handleSliderChange(item.id, e.currentTarget.value)}
                                            />
                                            <div class="w-full flex justify-between text-xs px-2 mt-2 font-mono text-gray-500">
                                                <span>1</span><span>2</span><span>3</span><span>4</span><span>5</span><span>6</span>
                                            </div>
                                        </div>
                                    )}
                                </For>

                                <Show when={isReviewer() && !hasVoted()}>
                                    <div class="divider border-white/5"></div>
                                    <div class="card-actions justify-end mt-4">
                                        <Show when={success()}>
                                            <div class="text-success mr-4 flex items-center animate-pulse">
                                                <Icon icon="ph:check-bold" class="mr-1" />
                                                <span class="font-bold">Votes Saved!</span>
                                            </div>
                                        </Show>
                                        <button
                                            class="btn btn-primary btn-lg shadow-lg shadow-primary-500/20 hover:shadow-primary-500/40 border-none bg-gradient-to-r from-primary-600 to-primary-500 text-white min-w-[200px]"
                                            onClick={handleSave}
                                            disabled={saving()}
                                        >
                                            {saving() ? <span class="loading loading-spinner"></span> : "SUBMIT WEIGHTS"}
                                        </button>
                                    </div>
                                </Show>
                            </div>
                        </Show>
                    </div>
                </div>
            </div>
        </Layout>
    );
}
