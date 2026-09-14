import { createSignal, createEffect, For, Show } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { Icon } from "~/components/Icon";
import { Layout } from "~/layouts/Layout";
import { fetchWeightVotes, saveWeightVote } from "~/lib/reviewer-actions";
import { useRequireReviewer } from "~/lib/route-guards";
import { TouchSafeSlider } from "~/components/TouchSafeSlider";

const CRITERIA = [
    { id: "relevance", label: "Relevance" },
    { id: "originality", label: "Originality" },
    { id: "depth", label: "Depth" },
    { id: "clarity", label: "Clarity" },
    { id: "takeaways", label: "Takeaways" },
    { id: "engagement", label: "Engagement" },
];

export default function ReviewerWeightsPage() {
    const guard = useRequireReviewer();
    const navigate = useNavigate();
    const [loading, setLoading] = createSignal(true);
    const [saving, setSaving] = createSignal(false);
    const [success, setSuccess] = createSignal(false);

    const [votes, setVotes] = createSignal<Record<string, number>>({
        relevance: 1,
        originality: 1,
        depth: 1,
        clarity: 1,
        takeaways: 1,
        engagement: 1,
    });

    const [voteId, setVoteId] = createSignal<string | null>(null);
    const [averages, setAverages] = createSignal<Record<string, string>>({});
    const [userRole, setUserRole] = createSignal<"admin" | "reviewer" | null>(null);

    const fetchData = async () => {
        setLoading(true);
        try {
            const res = await fetchWeightVotes();
            if (!res.success) return;

            const records = res.data || [];
            setUserRole(res.userRole === "admin" ? "admin" : "reviewer");

            const serverAverages =
                (res as { averages?: Record<string, number> }).averages || {};
            const tempAvg: Record<string, string> = {};
            CRITERIA.forEach((c) => {
                const value = Number(serverAverages[c.id] ?? 1);
                tempAvg[c.id] = Number.isFinite(value) ? value.toFixed(2) : "-";
            });
            setAverages(tempAvg);

            if (res.userRole === "reviewer") {
                const myVote = records[0];
                if (myVote) {
                    setVoteId(myVote.id);
                    const v: Record<string, number> = {};
                    CRITERIA.forEach((c) => (v[c.id] = (myVote as any)[c.id]));
                    setVotes(v);
                }
            } else if (res.userRole === "admin") {
                const v: Record<string, number> = {};
                CRITERIA.forEach((c) =>
                    (v[c.id] = Math.round(parseFloat(tempAvg[c.id] || "1"))),
                );
                setVotes(v);
            }
        } catch (e) {
            console.error("Error fetching weights:", e);
        } finally {
            setLoading(false);
        }
    };

    createEffect(
      () => guard.authorized(),
      (authorized) => {
        if (authorized) {
            fetchData();
        }
      },
    );

    const handleSliderChange = (id: string, val: string) => {
        setVotes((prev) => ({ ...prev, [id]: parseInt(val) }));
        setSuccess(false);
    };

    const handleSave = async () => {
        setSaving(true);
        setSuccess(false);
        try {
            const res = await saveWeightVote(voteId(), votes());
            if (res.success) {
                if (!voteId() && res.data) {
                    setVoteId((res.data as any).id);
                }
                setSuccess(true);
                setTimeout(() => setSuccess(false), 3000);
                fetchData();
            } else {
                alert("Failed to save weights: " + res.error);
            }
        } catch (e) {
            console.error("Error saving weights:", e);
            alert("Failed to save weights.");
        } finally {
            setSaving(false);
        }
    };

    const isReviewer = () => userRole() === "reviewer";
    const hasVoted = () => !!voteId();

    return (
        <Layout title="Criteria weights" description="Committee scoring weights">
            <Show when={guard.authorized()}>
                <div class="min-h-screen pt-24 pb-20 relative overflow-hidden">


                    <div class="container mx-auto px-4 max-w-3xl">
                        <div class="flex flex-wrap items-center justify-between gap-4 mb-8">
                            <div>
                                <h1 class="text-3xl font-bold text-white mb-1">
                                    Criteria weights
                                </h1>
                            </div>
                            <button
                                class="btn btn-ghost hover:bg-white/10 text-white gap-2 group"
                                onClick={() =>
                                    navigate(
                                        isReviewer() ? "/reviewer" : "/admin",
                                    )
                                }
                            >
                                <Icon
                                    icon="ph:arrow-left-bold"
                                    class="group-hover:-translate-x-1 transition-transform"
                                />
                                {isReviewer()
                                    ? "Back to reviews"
                                    : "Back to admin"}
                            </button>
                        </div>

                        <div class="glass-panel p-4 sm:p-8 rounded-2xl border border-white/10 bg-black/40">
                            <Show when={!isReviewer()}>
                                <div class="alert alert-info bg-primary-900/30 border-primary-500/30 text-primary-200 mb-8 shadow-lg backdrop-blur-md">
                                    <Icon icon="ph:eye-bold" class="text-2xl" />
                                    <p class="text-sm">Committee averages. Only reviewers can vote.</p>
                                </div>
                            </Show>

                            <p class="mb-8 text-sm text-secondary-300">
                                {isReviewer()
                                    ? "Assign each criterion a weight from 1–6. Committee votes are averaged to weight proposal scores."
                                    : "These averaged weights are used to calculate proposal scores."}
                            </p>

                            <Show when={success() && isReviewer()}>
                                <div class="alert alert-success bg-success-900/30 border-success-500/30 text-success-200 mb-8 shadow-lg">
                                    <Icon icon="mdi:check-circle" class="text-2xl" />
                                    <p role="status">Weights saved</p>
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
                                                        <span class="label-text font-semibold text-white">
                                                            {item.label}
                                                        </span>

                                                    </label>
                                                    <div class="flex flex-col items-end">
                                                        <span class="font-mono text-2xl font-bold text-white">
                                                            {isReviewer()
                                                                ? votes()[item.id]
                                                                : averages()[item.id] ||
                                                                  votes()[item.id]}
                                                        </span>
                                                    </div>
                                                </div>
                                                <TouchSafeSlider
                                                    min={1}
                                                    max={6}
                                                    step={1}
                                                    value={votes()[item.id]}
                                                    label={`${item.label} weight`}
                                                    rangeClass="range range-primary range-lg"
                                                    labelClass="w-full text-xs px-2 mt-2 font-mono text-gray-500"
                                                    tone="primary"
                                                    disabled={!isReviewer()}
                                                    onChange={(weight) =>
                                                        handleSliderChange(
                                                            item.id,
                                                            weight.toString(),
                                                        )
                                                    }
                                                />
                                            </div>
                                        )}
                                    </For>

                                    <Show when={isReviewer()}>
                                        <div class="divider border-white/5"></div>
                                        <div class="card-actions justify-end mt-4">

                                            <button
                                                class="btn btn-primary w-full sm:w-auto"
                                                onClick={handleSave}
                                                disabled={saving()}
                                            >
                                                {saving() ? (
                                                    <span class="loading loading-spinner"></span>
                                                ) : (
                                                    hasVoted()
                                                        ? "Update weights"
                                                        : "Save weights"
                                                )}
                                            </button>
                                        </div>
                                    </Show>
                                </div>
                            </Show>
                        </div>
                    </div>
                </div>
            </Show>
        </Layout>
    );
}
