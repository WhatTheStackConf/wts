import { createSignal, createMemo, For, Show, createResource } from "solid-js";
import { useRequireAdmin } from "~/lib/route-guards";
import { Icon } from "@iconify-icon/solid";
import {
    AdminDataPanel,
    AdminFilterBar,
    AdminFilterGroup,
    AdminPageShell,
    adminFilterButtonClass,
} from "~/components/admin/AdminPageShell";

import {
    adminPublishFromApplicant,
    adminFetchLeaderboardData,
    adminFetchSpeakers,
    adminSetSubmissionStatus,
    deleteSubmission,
    type CfpSubmissionStatus,
} from "~/lib/admin-actions";
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
    const guard = useRequireAdmin();

    const [submissions, { refetch }] = createResource(
        () => (guard.authorized() ? true : undefined),
        async () => {
            const res = await adminFetchLeaderboardData();
            if (res.success) {
                return res.data as LeaderboardItem[];
            }
            return [];
        },
    );

    const [deleteId, setDeleteId] = createSignal<string | null>(null);
    const [isDeleting, setIsDeleting] = createSignal(false);
    const [speakerBusyApplicant, setSpeakerBusyApplicant] = createSignal<string | null>(null);
    const [statusBusyId, setStatusBusyId] = createSignal<string | null>(null);
    const [toast, setToast] = createSignal<{ type: "success" | "error"; text: string } | null>(null);

    const showToast = (type: "success" | "error", text: string) => {
        setToast({ type, text });
        window.setTimeout(() => setToast(null), 6000);
    };

    const submissionStatus = (item: LeaderboardItem): CfpSubmissionStatus =>
        (item.status || "pending") as CfpSubmissionStatus;

    const [speakerApplicantIds, { refetch: refetchSpeakers }] = createResource(
        () => (guard.authorized() ? true : undefined),
        async () => {
            const res = await adminFetchSpeakers();
            if (!res.success) return new Set<string>();
            return new Set(
                (res.data as { cfp_applicant?: string }[])
                    .map((s) => s.cfp_applicant)
                    .filter((id): id is string => !!id),
            );
        },
    );

    const handleCreateSpeaker = async (applicantId: string) => {
        setSpeakerBusyApplicant(applicantId);
        const res = await adminPublishFromApplicant(applicantId);
        if (!res.success) showToast("error", res.error || "Failed to create speaker");
        else showToast("success", "Speaker profile created (draft). Publish it from Speakers admin.");
        await refetchSpeakers();
        setSpeakerBusyApplicant(null);
    };

    const handleStatusChange = async (id: string, status: CfpSubmissionStatus) => {
        setStatusBusyId(id);
        const res = await adminSetSubmissionStatus(id, status);
        if (!res.success) showToast("error", res.error || "Could not update status.");
        else {
            await refetch();
            if (status === "accepted") {
                showToast("success", "Proposal accepted. Use Publish speaker to create a profile.");
            }
        }
        setStatusBusyId(null);
    };

    // Filters
    const [expenseFilter, setExpenseFilter] = createSignal<string>("all");
    const [statusFilter, setStatusFilter] = createSignal<string>("all");
    const [sortBy, setSortBy] = createSignal<"score" | "date">("score");
    const [sortDir, setSortDir] = createSignal<"desc" | "asc">("desc");

    const filteredSubmissions = createMemo(() => {
        let items = [...(submissions() || [])];
        const expense = expenseFilter();
        const status = statusFilter();

        if (expense !== "all") {
            items = items.filter(item => {
                const meta = item.meta as any;
                const val = meta?.company_cover_expenses || "";
                return val === expense;
            });
        }

        if (status !== "all") {
            items = items.filter(item => (item.status || "pending") === status);
        }

        const by = sortBy();
        const dir = sortDir() === "desc" ? -1 : 1;
        items.sort((a, b) => {
            if (by === "score") return (a.totalScore - b.totalScore) * dir;
            const ta = new Date(a.created || 0).getTime();
            const tb = new Date(b.created || 0).getTime();
            return (ta - tb) * dir;
        });

        return items;
    });

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
        <AdminPageShell
            layoutTitle="Proposals Leaderboard"
            layoutDescription="Ranked submissions"
            title="Proposal Leaderboard"
            subtitle="RANKING BASED ON WEIGHTED COMMITTEE SCORES"
            hint="Set status to Accepted, then use Publish speaker to create a draft profile."
            count={submissions()?.length || 0}
            countLoading={submissions.loading}
            accent="secondary"
            toast={toast()}
        >
                    {/* Filters */}
                    <AdminFilterBar
                        showCount={expenseFilter() !== "all" || statusFilter() !== "all"}
                        filteredCount={filteredSubmissions().length}
                        totalCount={submissions()?.length || 0}
                    >
                        <AdminFilterGroup label="Expenses:">
                            <For each={["all", "Yes", "No", "Other"]}>
                                {(opt) => (
                                    <button
                                        type="button"
                                        class={adminFilterButtonClass(expenseFilter() === opt)}
                                        onClick={() => setExpenseFilter(opt)}
                                    >
                                        {opt === "all" ? "All" : opt}
                                    </button>
                                )}
                            </For>
                        </AdminFilterGroup>

                        <AdminFilterGroup label="Status:">
                            <For each={["all", "pending", "accepted", "rejected"]}>
                                {(opt) => (
                                    <button
                                        type="button"
                                        class={adminFilterButtonClass(statusFilter() === opt)}
                                        onClick={() => setStatusFilter(opt)}
                                    >
                                        {opt === "all" ? "All" : opt.charAt(0).toUpperCase() + opt.slice(1)}
                                    </button>
                                )}
                            </For>
                        </AdminFilterGroup>

                        <AdminFilterGroup label="Sort:">
                            <For each={[{ k: "score", l: "Score" }, { k: "date", l: "Date" }] as const}>
                                {(opt) => (
                                    <button
                                        type="button"
                                        class={adminFilterButtonClass(sortBy() === opt.k)}
                                        onClick={() => setSortBy(opt.k)}
                                    >
                                        {opt.l}
                                    </button>
                                )}
                            </For>
                            <button
                                type="button"
                                class="btn btn-xs font-mono btn-ghost border-white/10 text-gray-400 hover:bg-white/10"
                                onClick={() => setSortDir(sortDir() === "desc" ? "asc" : "desc")}
                                title={sortDir() === "desc" ? "Descending" : "Ascending"}
                            >
                                <Icon icon={sortDir() === "desc" ? "ph:arrow-down-bold" : "ph:arrow-up-bold"} />
                            </button>
                        </AdminFilterGroup>
                    </AdminFilterBar>

                    <Show when={submissions.loading}>
                        <div class="flex justify-center p-20">
                            <span class="loading loading-bars loading-lg text-primary-500"></span>
                        </div>
                    </Show>

                    <Show when={!submissions.loading}>
                        <AdminDataPanel>
                            {/* Mobile Card View */}
                            <div class="md:hidden space-y-4 p-4">
                                <For each={filteredSubmissions()}>
                                    {(item, index) => (
                                        <div class="bg-white/5 rounded-xl p-4 border border-white/10 space-y-3">
                                            <div class="flex justify-between items-start">
                                                <div class="flex items-center gap-2">
                                                    <span class="font-mono font-bold text-accent-400">#{index() + 1}</span>
                                                    <div class={`badge font-mono font-black text-white ${item.totalScore >= 4 ? 'bg-success/20 border-success/40' : item.totalScore >= 3 ? 'bg-warning/20 border-warning/40' : 'bg-error/20 border-error/40'}`}>
                                                        {item.totalScore.toFixed(2)}
                                                    </div>
                                                </div>
                                                <select
                                                    class={`select select-bordered select-xs font-mono font-bold bg-black/40 ${
                                                        submissionStatus(item) === "accepted"
                                                            ? "border-success/40 text-success"
                                                            : submissionStatus(item) === "rejected"
                                                              ? "border-error/40 text-error"
                                                              : "border-white/10 text-gray-400"
                                                    }`}
                                                    value={submissionStatus(item)}
                                                    disabled={statusBusyId() === item.id}
                                                    onChange={(e) =>
                                                        handleStatusChange(
                                                            item.id,
                                                            e.currentTarget.value as CfpSubmissionStatus,
                                                        )
                                                    }
                                                >
                                                    <option value="pending">Pending</option>
                                                    <option value="accepted">Accepted</option>
                                                    <option value="rejected">Rejected</option>
                                                </select>
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
                                                <div class="flex items-center gap-2">
                                                    <span class="text-xs font-mono opacity-50">{item.reviewCount} Reviews</span>
                                                    {(() => {
                                                        const val = (item.meta as any)?.company_cover_expenses || "";
                                                        return (
                                                            <div class={`badge badge-xs font-mono font-bold ${val === "Yes" ? "bg-success/20 border-success/40 text-success" : val === "No" ? "bg-error/20 border-error/40 text-error" : val === "Other" ? "bg-warning/20 border-warning/40 text-warning" : "badge-ghost opacity-50"}`}>
                                                                {val || "N/A"}
                                                            </div>
                                                        );
                                                    })()}
                                                </div>
                                                <div class="flex items-center gap-2 flex-wrap justify-end">
                                                    <Show when={submissionStatus(item) === "accepted" && item.applicant && !speakerApplicantIds()?.has(item.applicant)}>
                                                        <button
                                                            type="button"
                                                            class="btn btn-sm btn-outline btn-primary font-mono"
                                                            disabled={speakerBusyApplicant() === item.applicant}
                                                            onClick={() => handleCreateSpeaker(item.applicant)}
                                                        >
                                                            {speakerBusyApplicant() === item.applicant ? "…" : "Publish speaker"}
                                                        </button>
                                                    </Show>
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
                                            <th class="text-center font-bold text-gray-300">EXPENSES</th>
                                            <th class="text-center font-bold text-gray-300">STATUS</th>
                                            <th class="text-center font-bold text-gray-300">REVIEWS</th>
                                            <th class="text-center font-bold text-gray-300">ACTION</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        <For each={filteredSubmissions()}>
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
                                                        {(() => {
                                                            const val = (item.meta as any)?.company_cover_expenses || "";
                                                            return (
                                                                <div class={`badge badge-sm font-mono font-bold ${val === "Yes" ? "bg-success/20 border-success/40 text-success" : val === "No" ? "bg-error/20 border-error/40 text-error" : val === "Other" ? "bg-warning/20 border-warning/40 text-warning" : "badge-ghost opacity-50"}`}>
                                                                    {val || "N/A"}
                                                                </div>
                                                            );
                                                        })()}
                                                    </td>
                                                    <td class="text-center">
                                                        <select
                                                            class={`select select-bordered select-sm font-mono font-bold bg-black/40 min-w-[7.5rem] ${
                                                                submissionStatus(item) === "accepted"
                                                                    ? "border-success/40 text-success"
                                                                    : submissionStatus(item) === "rejected"
                                                                      ? "border-error/40 text-error"
                                                                      : "border-white/10 text-gray-400"
                                                            }`}
                                                            value={submissionStatus(item)}
                                                            disabled={statusBusyId() === item.id}
                                                            onChange={(e) =>
                                                                handleStatusChange(
                                                                    item.id,
                                                                    e.currentTarget.value as CfpSubmissionStatus,
                                                                )
                                                            }
                                                        >
                                                            <option value="pending">Pending</option>
                                                            <option value="accepted">Accepted</option>
                                                            <option value="rejected">Rejected</option>
                                                        </select>
                                                    </td>
                                                    <td class="text-center font-mono opacity-70">
                                                        {item.reviewCount}
                                                    </td>
                                                    <td class="text-center">
                                                        <Show when={submissionStatus(item) === "accepted" && item.applicant && !speakerApplicantIds()?.has(item.applicant)}>
                                                            <button
                                                                type="button"
                                                                class="btn btn-sm btn-outline btn-primary font-mono mr-1"
                                                                title="Create speaker profile"
                                                                disabled={speakerBusyApplicant() === item.applicant}
                                                                onClick={() => handleCreateSpeaker(item.applicant)}
                                                            >
                                                                {speakerBusyApplicant() === item.applicant ? "…" : "Publish speaker"}
                                                            </button>
                                                        </Show>
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
                        </AdminDataPanel>
                    </Show>


            {/* Delete Confirmation Modal */}
            <Show when={deleteId()}>
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
            </Show>
        </AdminPageShell>
    );
}
