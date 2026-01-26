import { createSignal, createEffect, Show, For } from "solid-js";
import { useParams, useNavigate } from "@solidjs/router";
import { useAuth } from "~/lib/auth-context";
import { pb } from "~/lib/pocketbase-utils";
import { Icon } from "@iconify-icon/solid";
import { CfpReviewRecord } from "~/lib/pocketbase-types";
import { Layout } from "~/layouts/Layout";

// Criteria definitions
const CRITERIA = [
    { id: "score_relevance", label: "Relevance" },
    { id: "score_originality", label: "Originality" },
    { id: "score_depth", label: "Depth" },
    { id: "score_clarity", label: "Clarity" },
    { id: "score_takeaways", label: "Takeaways" },
    { id: "score_engagement", label: "Engagement" },
];

export default function ReviewPage() {
    const params = useParams();
    const auth = useAuth();
    const navigate = useNavigate();
    const [submission, setSubmission] = createSignal<any>(null);
    const [myReview, setMyReview] = createSignal<CfpReviewRecord | null>(null);
    const [allReviews, setAllReviews] = createSignal<CfpReviewRecord[]>([]); // For Admins
    const [loading, setLoading] = createSignal(true);
    const [saving, setSaving] = createSignal(false);

    // Form state
    const [scores, setScores] = createSignal<Record<string, number>>({});
    const [notes, setNotes] = createSignal("");
    const [isLlm, setIsLlm] = createSignal(false);

    const isAdmin = () => auth?.user?.role === "admin";
    const isReviewer = () => auth?.user?.role === "reviewer";

    const fetchSubmissionData = async (id: string) => {
        const { fetchReviewerSubmissionDetail } = await import("~/lib/reviewer-actions");
        return await fetchReviewerSubmissionDetail(id);
    };

    const handleSaveReview = async (data: any) => {
        const { submitReview } = await import("~/lib/reviewer-actions");
        return await submitReview(data);
    };

    createEffect(async () => {
        if (auth.isAuthenticated() && params.id) {
            setLoading(true);
            try {
                const res = await fetchSubmissionData(params.id);
                if (res.success && res.data) {
                    setSubmission(res.data.submission);

                    if (res.data.userRole === "admin") {
                        setAllReviews(res.data.reviews || []);
                    } else {
                        // Reviewer mode - find my review
                        // The server returns only MY review in reviews array for non-admins
                        if (res.data.reviews && res.data.reviews.length > 0) {
                            const r = res.data.reviews[0];
                            setMyReview(r);
                            // Populate form
                            const newScores: any = {};
                            CRITERIA.forEach(c => newScores[c.id] = (r as any)[c.id]);
                            setScores(newScores);
                            setNotes(r.notes || "");
                            setIsLlm(r.is_llm_suspected);
                        } else {
                            // Init defaults
                            const newScores: any = {};
                            CRITERIA.forEach(c => newScores[c.id] = 1);
                            setScores(newScores);
                        }
                    }
                }
            } catch (e) {
                console.error(e);
            } finally {
                setLoading(false);
            }
        }
    });

    const handleScoreChange = (key: string, val: string) => {
        setScores(p => ({ ...p, [key]: parseInt(val) }));
    };

    const calculateTotal = () => {
        return Object.values(scores()).reduce((a, b) => a + b, 0);
    };

    const calculateTotalForReview = (r: any) => {
        return CRITERIA.reduce((acc, c) => acc + (r[c.id] || 0), 0);
    };

    const handleSubmit = async () => {
        if (isAdmin()) return; // Safety check
        setSaving(true);
        try {
            const data = {
                id: myReview()?.id, // Optional, undefined if new
                submission: params.id,
                // reviewer set by server action
                ...scores(),
                notes: notes(),
                is_llm_suspected: isLlm()
            };

            const res = await handleSaveReview(data);

            if (res.success) {
                if (!myReview()) {
                    // If it was a create, update local state with returned record
                    setMyReview(res.data as unknown as CfpReviewRecord);
                }
                alert("Review saved!");
            } else {
                alert("Error saving review: " + res.error);
            }

        } catch (e) {
            alert("Error saving review");
            console.error(e);
        } finally {
            setSaving(false);
        }
    };

    // ... imports ...

    // ... (logic remains same until return) ...

    return (
        <Layout title="Review Session" description="CFP Evaluation">
            <div class="min-h-screen pt-24 pb-20 relative overflow-hidden">
                {/* Background Elements */}
                <div class="absolute top-0 right-0 w-[500px] h-[500px] bg-secondary-900/10 rounded-full blur-[120px] -z-10 pointer-events-none"></div>
                <div class="absolute bottom-0 left-0 w-[500px] h-[500px] bg-primary-900/10 rounded-full blur-[120px] -z-10 pointer-events-none"></div>

                <div class="container mx-auto px-4 max-w-5xl">
                    <button
                        class="btn btn-ghost hover:bg-white/10 mb-8 text-white gap-2 group"
                        onClick={() => navigate(isAdmin() ? "/admin" : "/reviewer")}
                    >
                        <Icon icon="ph:arrow-left-bold" class="group-hover:-translate-x-1 transition-transform" />
                        Back to {isAdmin() ? "Dashboard" : "Queue"}
                    </button>

                    <Show when={loading()}>
                        <div class="flex justify-center p-20"><span class="loading loading-spinner loading-lg text-primary"></span></div>
                    </Show>

                    <Show when={!loading() && submission()}>
                        <div class="grid grid-cols-1 lg:grid-cols-3 gap-8">

                            {/* Main Content Column */}
                            <div class="lg:col-span-2 space-y-8">
                                <div class="glass-panel p-8 rounded-2xl border border-white/10 shadow-xl backdrop-blur-md bg-black/40">
                                    <h1 class="text-3xl lg:text-4xl font-black text-transparent bg-clip-text bg-gradient-to-r from-white to-gray-400 mb-6 leading-tight">
                                        {submission().session_title}
                                    </h1>

                                    <div class="flex flex-wrap gap-3 mb-8">
                                        <div class="badge badge-outline border-white/20 text-white/60 font-mono">
                                            {submission().level || "Intermediate"}
                                        </div>
                                        <div class="badge badge-outline border-white/20 text-white/60 font-mono">
                                            {submission().format || "Talk"}
                                        </div>
                                    </div>

                                    {/* Abstract Section */}
                                    <div class="mb-8">
                                        <h3 class="text-xs font-bold text-secondary-400 uppercase tracking-widest mb-3">Abstract</h3>
                                        <div
                                            class="prose prose-invert max-w-none prose-p:text-gray-300 prose-p:leading-relaxed"
                                            innerHTML={submission().abstract}
                                        ></div>
                                    </div>

                                    <div class="divider border-white/10"></div>

                                    {/* Key Takeaways Section */}
                                    <div class="mb-8">
                                        <h3 class="text-xs font-bold text-secondary-400 uppercase tracking-widest mb-3">Key Takeaways</h3>
                                        <div
                                            class="prose prose-invert max-w-none prose-p:text-gray-300 prose-headings:text-white"
                                            innerHTML={submission().key_takeaways}
                                        ></div>
                                    </div>

                                    {/* Technical Requirements Section */}
                                    <Show when={submission().technical_requirements}>
                                        <div class="mb-8">
                                            <h3 class="text-xs font-bold text-secondary-400 uppercase tracking-widest mb-3">Technical Requirements</h3>
                                            <div class="prose prose-invert max-w-none prose-p:text-gray-300">
                                                <p class="whitespace-pre-wrap">{submission().technical_requirements}</p>
                                            </div>
                                        </div>
                                    </Show>

                                    {/* Logistics & Meta Section */}
                                    <Show when={isAdmin()}>
                                        <div class="mb-8 p-6 bg-white/5 rounded-xl border border-white/5 space-y-4">
                                            <h3 class="text-xs font-bold text-primary-400 uppercase tracking-widest mb-2 flex items-center gap-2">
                                                <Icon icon="ph:info-bold" /> Logistics & Meta
                                            </h3>

                                            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                <div>
                                                    <div class="text-xs text-gray-500 uppercase font-bold mb-1">Covers Expenses?</div>
                                                    <div class={`badge ${submission().meta?.company_cover_expenses === 'Yes' ? 'badge-success text-white' : 'badge-warning text-white'} font-mono`}>
                                                        {submission().meta?.company_cover_expenses || "N/A"}
                                                    </div>
                                                </div>

                                                <Show when={submission().meta?.previous_presentation}>
                                                    <div>
                                                        <div class="text-xs text-gray-500 uppercase font-bold mb-1">Previous Presentations</div>
                                                        <p class="text-sm text-gray-300 whitespace-pre-wrap break-words">
                                                            {submission().meta?.previous_presentation}
                                                        </p>
                                                    </div>
                                                </Show>
                                            </div>

                                            <Show when={submission().meta?.additional_info}>
                                                <div class="pt-2">
                                                    <div class="text-xs text-gray-500 uppercase font-bold mb-1">Additional Info</div>
                                                    <p class="text-sm text-gray-300 italic">"{submission().meta?.additional_info}"</p>
                                                </div>
                                            </Show>

                                            <Show when={submission().meta?.organizer_notes}>
                                                <div class="pt-2 border-t border-white/10 mt-2">
                                                    <div class="text-xs text-secondary-400 uppercase font-bold mb-1">Notes to Organizer (Admin Only)</div>
                                                    <p class="text-sm text-secondary-200 font-mono bg-secondary-900/20 p-2 rounded border border-secondary-500/20">
                                                        {submission().meta?.organizer_notes}
                                                    </p>
                                                </div>
                                            </Show>
                                        </div>
                                    </Show>

                                    {/* Notes Section */}
                                    <Show when={submission().notes}>
                                        <div class="mt-8 p-4 bg-white/5 rounded-xl border border-white/5">
                                            <h3 class="text-xs font-bold text-gray-500 uppercase tracking-widest mb-2">Extra Notes</h3>
                                            <p class="text-sm text-gray-400 italic">{submission().notes}</p>
                                        </div>
                                    </Show>
                                </div>
                            </div>

                            {/* Sidebar Column */}
                            <div class="space-y-6">
                                {/* Admin: Applicant Info Card */}
                                <Show when={isAdmin() && submission().expand?.applicant}>
                                    <div class="glass-panel p-6 rounded-xl border border-primary-500/30 bg-primary-900/10 shadow-lg">
                                        <div class="flex items-center gap-3 mb-4">
                                            <div class="p-2 bg-primary-500/20 rounded-lg text-primary-400">
                                                <Icon icon="ph:user-bold" class="text-xl" />
                                            </div>
                                            <h3 class="font-bold text-white uppercase tracking-wider text-sm">Applicant</h3>
                                        </div>
                                        <h4 class="text-xl font-bold text-white mb-1">{submission().expand?.applicant?.expand?.user?.name || submission().expand?.applicant?.name || "Unknown"}</h4>
                                        <a href={`mailto:${submission().expand?.applicant?.expand?.user?.email || submission().expand?.applicant?.email}`} class="text-sm text-primary-400 hover:text-primary-300 transition-colors mb-4 block">
                                            {submission().expand?.applicant?.expand?.user?.email || submission().expand?.applicant?.email}
                                        </a>
                                        <div class="text-sm text-gray-400 leading-relaxed border-t border-white/10 pt-4 mt-4">
                                            {submission().expand.applicant.bio || "No bio provided."}
                                        </div>
                                    </div>
                                </Show>

                                {/* Reviewer: Evaluation Form */}
                                <Show when={!isAdmin()}>
                                    <div class="glass-panel p-6 rounded-xl border border-white/10 bg-black/40 shadow-xl sticky top-24">
                                        <div class="flex items-center gap-3 mb-6 border-b border-white/10 pb-4">
                                            <div class="p-2 bg-accent-500/20 rounded-lg text-accent-400">
                                                <Icon icon="ph:star-half-bold" class="text-xl" />
                                            </div>
                                            <h3 class="font-bold text-white uppercase tracking-wider text-sm">Evaluation</h3>
                                        </div>

                                        <div class="space-y-6">
                                            <For each={CRITERIA}>
                                                {(c) => (
                                                    <div class="form-control">
                                                        <div class="flex justify-between mb-2 items-center">
                                                            <span class="text-sm font-bold text-gray-300">{c.label}</span>
                                                            <span class="badge badge-accent font-mono font-bold text-white">{scores()[c.id] || 1}</span>
                                                        </div>
                                                        <input
                                                            type="range"
                                                            min="1"
                                                            max="5"
                                                            step="1"
                                                            value={scores()[c.id] || 1}
                                                            class="range range-xs range-accent"
                                                            onInput={(e) => handleScoreChange(c.id, e.currentTarget.value)}
                                                        />
                                                        <div class="flex justify-between text-[10px] px-1 mt-1 opacity-30 font-mono">
                                                            <span>1</span><span>2</span><span>3</span><span>4</span><span>5</span>
                                                        </div>
                                                    </div>
                                                )}
                                            </For>
                                        </div>

                                        <div class="divider border-white/10 my-6"></div>

                                        <div class="form-control bg-warning-900/10 p-4 rounded-lg border border-warning-500/20">
                                            <label class="label cursor-pointer justify-start gap-3 p-0">
                                                <input
                                                    type="checkbox"
                                                    class="checkbox checkbox-warning checkbox-sm"
                                                    checked={isLlm()}
                                                    onChange={(e) => setIsLlm(e.currentTarget.checked)}
                                                />
                                                <span class="label-text font-bold text-warning-400 text-sm">Flag as AI/LLM Generated</span>
                                            </label>
                                        </div>

                                        <div class="form-control mt-6">
                                            <label class="label"><span class="label-text text-gray-400 text-xs uppercase tracking-widest">Private Notes</span></label>
                                            <textarea
                                                class="textarea textarea-bordered bg-black/20 focus:bg-black/40 h-24 text-sm"
                                                placeholder="Only visible to committee..."
                                                value={notes()}
                                                onInput={(e) => setNotes(e.currentTarget.value)}
                                            ></textarea>
                                        </div>

                                        <div class="mt-8 pt-4 border-t border-white/10">
                                            <div class="flex justify-between items-center mb-4">
                                                <span class="text-sm text-gray-400 font-mono uppercase">Total Score</span>
                                                <span class="text-2xl font-black text-white"><span class="text-accent-400">{calculateTotal()}</span><span class="text-white/30 text-lg">/30</span></span>
                                            </div>
                                            <button
                                                class="btn btn-primary w-full shadow-lg shadow-primary-500/20"
                                                onClick={handleSubmit}
                                                disabled={saving()}
                                            >
                                                {saving() ? <span class="loading loading-spinner"></span> : "Save Review"}
                                            </button>
                                        </div>
                                    </div>
                                </Show>

                                {/* Admin: Reviews List */}
                                <Show when={isAdmin()}>
                                    <div class="glass-panel p-6 rounded-xl border border-white/10 bg-black/40">
                                        <h3 class="font-bold text-white uppercase tracking-wider text-sm mb-4">Committee Reviews ({allReviews().length})</h3>

                                        <div class="space-y-3">
                                            <For each={allReviews()}>
                                                {(review) => (
                                                    <div class="collapse collapse-arrow bg-white/5 border border-white/5 rounded-lg">
                                                        <input type="radio" name="reviews-accordion" />
                                                        <div class="collapse-title text-sm font-medium flex justify-between items-center pr-8">
                                                            <div class="flex items-center gap-2">
                                                                <div class="avatar placeholder">
                                                                    <div class="bg-neutral text-neutral-content rounded-full w-6">
                                                                        <span class="text-[10px]">{(review as any).expand?.reviewer?.name?.slice(0, 2)?.toUpperCase() || "RV"}</span>
                                                                    </div>
                                                                </div>
                                                                <span class="text-gray-300">{(review as any).expand?.reviewer?.name?.split(' ')[0] || "Reviewer"}</span>
                                                            </div>
                                                            <div class="flex items-center gap-2">
                                                                <Show when={review.is_llm_suspected}>
                                                                    <Icon icon="mdi:robot" class="text-warning text-lg" title="AI Flagged" />
                                                                </Show>
                                                                <span class="badge badge-accent font-mono font-bold">{calculateTotalForReview(review)}</span>
                                                            </div>
                                                        </div>
                                                        <div class="collapse-content">
                                                            <div class="grid grid-cols-2 gap-x-4 gap-y-1 text-xs mt-2 border-t border-white/10 pt-3">
                                                                <For each={CRITERIA}>
                                                                    {c => (
                                                                        <div class="flex justify-between">
                                                                            <span class="opacity-50">{c.label}</span>
                                                                            <span class="font-mono text-accent-400">{(review as any)[c.id]}</span>
                                                                        </div>
                                                                    )}
                                                                </For>
                                                            </div>
                                                            <Show when={review.notes}>
                                                                <div class="mt-3 p-2 bg-black/20 rounded text-xs text-gray-400 italic">
                                                                    "{review.notes}"
                                                                </div>
                                                            </Show>
                                                        </div>
                                                    </div>
                                                )}
                                            </For>
                                            <Show when={allReviews().length === 0}>
                                                <div class="text-center py-4 text-xs text-gray-600 italic">No reviews yet.</div>
                                            </Show>
                                        </div>
                                    </div>
                                </Show>
                            </div>
                        </div>
                    </Show>
                </div>
            </div>
        </Layout>
    );
}
