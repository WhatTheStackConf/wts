import { createSignal, createMemo, For, Show, createResource } from "solid-js";
import { useRequireAdmin } from "~/lib/route-guards";
import { Icon } from "@iconify-icon/solid";
import {
    AdminDataPanel,
    AdminFilterBar,
    AdminFilterGroup,
    AdminPageShell,
    adminFilterButtonClass,
    useAdminToast,
} from "~/components/admin/AdminPageShell";

import {
    adminFetchLeaderboardData,
    adminPromoteSubmissionToDraftSession,
    adminSetSubmissionStatus,
    adminSetSubmissionStatuses,
    deleteSubmission,
    type CfpSubmissionStatus,
} from "~/lib/admin-actions";
import { getGravatarUrl } from "~/lib/gravatar";
import type { CfpSubmissionRecord } from "~/lib/pocketbase-types";

type PromotedSessionSummary = {
    id: string;
    slug: string;
    title: string;
    published: boolean;
    editHref: string;
};

type LeaderboardItem = CfpSubmissionRecord & {
    totalScore: number;
    reviewCount: number;
    promotedSession?: PromotedSessionSummary | null;
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

    const [submissions, { refetch, mutate: mutateSubmissions }] = createResource(
        () => (guard.authorized() ? true : undefined),
        async () => {
            const res = await adminFetchLeaderboardData();
            if (res.success) {
                setSubmissionsError(null);
                return res.data as LeaderboardItem[];
            }
            setSubmissionsError(res.error || "Could not load proposals.");
            return [];
        },
    );

    const [deleteId, setDeleteId] = createSignal<string | null>(null);
    const [isDeleting, setIsDeleting] = createSignal(false);
    const [promotionBusyId, setPromotionBusyId] = createSignal<string | null>(null);
    const [statusBusyId, setStatusBusyId] = createSignal<string | null>(null);
    const [bulkBusyStatus, setBulkBusyStatus] = createSignal<CfpSubmissionStatus | null>(null);
    const [selectedIds, setSelectedIds] = createSignal<Set<string>>(new Set());
    const [submissionsError, setSubmissionsError] = createSignal<string | null>(null);
    const { toast, showToast } = useAdminToast();

    const submissionStatus = (item: LeaderboardItem): CfpSubmissionStatus =>
        (item.status || "pending") as CfpSubmissionStatus;

    const proposalTitle = (item: LeaderboardItem): string =>
        item.session_title?.trim() || "Untitled proposal";

    const applicantName = (item: LeaderboardItem): string =>
        item.expand?.applicant?.expand?.user?.name || item.expand?.applicant?.name || "Unknown speaker";

    const applicantEmail = (item: LeaderboardItem): string =>
        item.expand?.applicant?.expand?.user?.email || item.expand?.applicant?.email || "";

    const expenseValue = (item: LeaderboardItem): string =>
        ((item.meta as any)?.company_cover_expenses || "") as string;

    const statusSelectDisabled = (id: string) =>
        statusBusyId() === id || bulkBusyStatus() !== null;

    const isSelected = (id: string) => selectedIds().has(id);

    const setSubmissionSelected = (id: string, selected: boolean) => {
        setSelectedIds((current) => {
            const next = new Set(current);
            if (selected) next.add(id);
            else next.delete(id);
            return next;
        });
    };

    const clearSelection = () => setSelectedIds(new Set<string>());

    const bulkStatusMessage = (count: number, status: CfpSubmissionStatus) => {
        const noun = count === 1 ? "proposal" : "proposals";
        if (status === "accepted") return `${count} ${noun} accepted.`;
        if (status === "rejected") return `${count} ${noun} rejected.`;
        return `${count} ${noun} moved back to pending.`;
    };

    const handleStatusChange = async (id: string, status: CfpSubmissionStatus) => {
        const previousSubmissions = submissions();
        mutateSubmissions((items) =>
            (items || []).map((item) =>
                item.id === id ? { ...item, status } : item,
            ),
        );
        setStatusBusyId(id);
        const res = await adminSetSubmissionStatus(id, status);
        if (!res.success) {
            mutateSubmissions(previousSubmissions);
            showToast("error", res.error || "Could not update status.");
        } else {
            if (status === "accepted") {
                showToast("success", "Proposal accepted. Create a draft Session from this row when ready.");
            } else if (status === "rejected") {
                showToast("success", "Proposal rejected.");
            } else {
                showToast("success", "Proposal moved back to pending.");
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

    const visibleSubmissionIds = createMemo(() => filteredSubmissions().map((item) => item.id));
    const selectedSubmissionIds = createMemo(() => [...selectedIds()]);
    const selectedCount = createMemo(() => selectedSubmissionIds().length);
    const deleteTargetTitle = createMemo(() => {
        const id = deleteId();
        if (!id) return "this submission";
        const item = (submissions() || []).find((row) => row.id === id);
        return item ? proposalTitle(item) : "this submission";
    });
    const bulkActionDisabled = createMemo(
        () => selectedCount() === 0 || bulkBusyStatus() !== null || statusBusyId() !== null,
    );
    const allVisibleSelected = createMemo(() => {
        const visibleIds = visibleSubmissionIds();
        const selected = selectedIds();
        return visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
    });

    const toggleVisibleSelection = () => {
        const visibleIds = visibleSubmissionIds();
        if (visibleIds.length === 0) return;

        setSelectedIds((current) => {
            const next = new Set(current);
            const shouldDeselect = visibleIds.every((id) => current.has(id));
            for (const id of visibleIds) {
                if (shouldDeselect) next.delete(id);
                else next.add(id);
            }
            return next;
        });
    };

    const handleBulkStatusChange = async (status: CfpSubmissionStatus) => {
        const ids = selectedSubmissionIds();
        if (ids.length === 0) return;

        const previousSubmissions = submissions();
        mutateSubmissions((items) =>
            (items || []).map((item) =>
                ids.includes(item.id) ? { ...item, status } : item,
            ),
        );
        setBulkBusyStatus(status);

        try {
            const res = await adminSetSubmissionStatuses(ids, status);
            if (!res.success) {
                mutateSubmissions(previousSubmissions);
                showToast("error", res.error || "Could not update selected proposals.");
                return;
            }

            clearSelection();
            showToast("success", bulkStatusMessage(ids.length, status));
        } catch (error) {
            mutateSubmissions(previousSubmissions);
            console.error(error);
            showToast("error", "Could not update selected proposals.");
        } finally {
            setBulkBusyStatus(null);
        }
    };

    const handleDelete = async () => {
        const id = deleteId();
        if (!id) return;
        setIsDeleting(true);
        try {
            const res = await deleteSubmission(id);
            if (res.success) {
                await refetch();
                setDeleteId(null);
                setSubmissionSelected(id, false);
                showToast("success", "Submission deleted.");
            } else {
                showToast("error", res.error || "Could not delete submission.");
            }
        } catch (e) {
            console.error(e);
            showToast("error", "Could not delete submission.");
        } finally {
            setIsDeleting(false);
        }
    };

    const promotionBlocker = (item: LeaderboardItem): string | null => {
        if (submissionStatus(item) !== "accepted") return "Accept proposal first.";
        if (!item.applicant) return "Missing linked CFP applicant.";
        if (!item.session_title?.trim()) return "Missing public session title.";
        if (!item.abstract?.trim()) return "Missing public abstract.";
        return null;
    };

    const handlePromoteSubmission = async (item: LeaderboardItem) => {
        if (item.promotedSession) return;

        const blocker = promotionBlocker(item);
        if (blocker) {
            showToast("error", blocker);
            return;
        }

        setPromotionBusyId(item.id);
        try {
            const res = await adminPromoteSubmissionToDraftSession(item.id);
            if (!res.success) {
                showToast("error", res.error || "Could not create draft session.");
                await refetch();
                return;
            }

            const data = res.data as { session?: PromotedSessionSummary } | undefined;
            const session = data?.session;
            if (session) {
                mutateSubmissions((items) =>
                    (items || []).map((row) =>
                        row.id === item.id ? { ...row, promotedSession: session } : row,
                    ),
                );
            }

            showToast(
                "success",
                `Draft session created for "${session?.title || proposalTitle(item)}".`,
                session
                    ? { actionLabel: "Review draft session", actionHref: session.editHref }
                    : undefined,
            );
            await refetch();
        } catch (error) {
            console.error(error);
            showToast("error", "Could not create draft session.");
        } finally {
            setPromotionBusyId(null);
        }
    };

    const PromotionActions = (props: { item: LeaderboardItem; compact?: boolean }) => {
        const buttonSizeClass = () => (props.compact ? "btn-sm" : "btn-xs");
        const blocker = () => promotionBlocker(props.item);
        const isPromoting = () => promotionBusyId() === props.item.id;

        return (
            <div class="flex flex-wrap items-center justify-end gap-1.5">
                <Show
                    when={props.item.promotedSession}
                    fallback={
                        <Show
                            when={submissionStatus(props.item) === "accepted"}
                            fallback={
                                <span class="text-xs font-mono text-base-content/60">
                                     Accept proposal first
                                </span>
                            }
                        >
                            <Show
                                when={!blocker()}
                                fallback={
                                    <div class="flex flex-col items-end gap-1">
                                        <button
                                            type="button"
                                            class={`btn ${buttonSizeClass()} btn-outline btn-warning font-mono`}
                                            disabled
                                            title={blocker() || undefined}
                                        >
                                            Cannot promote
                                        </button>
                                        <span class="max-w-44 text-right text-xs font-mono text-warning-200/80">
                                            {blocker()}
                                        </span>
                                    </div>
                                }
                            >
                                <button
                                    type="button"
                                    class={`btn ${buttonSizeClass()} btn-primary font-mono`}
                                    disabled={isPromoting()}
                                    onClick={() => handlePromoteSubmission(props.item)}
                                >
                                    <Show
                                        when={isPromoting()}
                                        fallback="Create draft session"
                                    >
                                        <span class="loading loading-spinner loading-xs"></span>
                                        Creating draft...
                                    </Show>
                                </button>
                            </Show>
                        </Show>
                    }
                >
                    {(session) => (
                        <>
                            <span
                                class={`badge badge-sm font-mono ${
                                    session().published
                                        ? "border-success/40 bg-success/10 text-success"
                                        : "border-warning/40 bg-warning/10 text-warning"
                                }`}
                            >
                                {session().published ? "Published session exists" : "Draft session exists"}
                            </span>
                            <a
                                href={session().editHref}
                                class={`btn ${buttonSizeClass()} btn-outline btn-secondary font-mono`}
                            >
                                {session().published ? "Edit session" : "Review draft"}
                            </a>
                            <Show when={session().published}>
                                <a
                                    href={`/sessions/${session().slug}`}
                                    class={`btn ${buttonSizeClass()} btn-ghost font-mono text-base-content/70 hover:text-white`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                >
                                    View public
                                </a>
                            </Show>
                        </>
                    )}
                </Show>
            </div>
        );
    };

    return (
        <AdminPageShell
            layoutTitle="Proposals Leaderboard"
            layoutDescription="Ranked submissions"
            title="Proposal Leaderboard"
            subtitle="RANKING BASED ON WEIGHTED COMMITTEE SCORES"
            hint="Set status to Accepted, then create a draft Session from the proposal row. Promotion creates or reuses the Speaker automatically."
            count={submissions()?.length || 0}
            countLoading={submissions.loading}
            accent="secondary"
            toast={toast()}
        >
                    <Show when={submissionsError()}>
                        <div class="alert alert-error mb-6 font-mono text-sm" role="alert">
                            <Icon icon="ph:warning-circle-bold" aria-hidden="true" />
                            <span>{submissionsError()}</span>
                        </div>
                    </Show>

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
                                        aria-pressed={expenseFilter() === opt}
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
                                        aria-pressed={statusFilter() === opt}
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
                                        aria-pressed={sortBy() === opt.k}
                                        onClick={() => setSortBy(opt.k)}
                                    >
                                        {opt.l}
                                    </button>
                                )}
                            </For>
                            <button
                                type="button"
                                class="btn btn-xs font-mono btn-ghost border-white/15 text-base-content/70 hover:bg-white/10 hover:text-white"
                                onClick={() => setSortDir(sortDir() === "desc" ? "asc" : "desc")}
                                title={sortDir() === "desc" ? "Descending" : "Ascending"}
                                aria-label={sortDir() === "desc" ? "Sort descending" : "Sort ascending"}
                            >
                                <Icon icon={sortDir() === "desc" ? "ph:arrow-down-bold" : "ph:arrow-up-bold"} aria-hidden="true" />
                            </button>
                        </AdminFilterGroup>
                    </AdminFilterBar>

                    <Show when={!submissions.loading}>
                        <div class="mb-4 flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3 sm:flex-row sm:items-center sm:justify-between">
                            <div class="flex flex-wrap items-center gap-2">
                                <span class="badge badge-sm border-secondary-500/40 bg-secondary-500/10 font-mono text-secondary-200">
                                    {selectedCount()} selected
                                </span>
                                <button
                                    type="button"
                                    class="btn btn-xs btn-ghost border-white/15 font-mono text-base-content/70 hover:bg-white/10 hover:text-white"
                                    disabled={visibleSubmissionIds().length === 0 || bulkBusyStatus() !== null}
                                    onClick={toggleVisibleSelection}
                                >
                                    {allVisibleSelected() ? "Deselect visible" : "Select visible"}
                                </button>
                                <Show when={selectedCount() > 0}>
                                    <button
                                        type="button"
                                        class="btn btn-xs btn-ghost border-white/15 font-mono text-base-content/70 hover:bg-white/10 hover:text-white"
                                        disabled={bulkBusyStatus() !== null}
                                        onClick={clearSelection}
                                    >
                                        Clear
                                    </button>
                                </Show>
                            </div>
                            <div class="flex flex-wrap items-center gap-2">
                                <button
                                    type="button"
                                    class="btn btn-xs btn-success font-mono"
                                    disabled={bulkActionDisabled()}
                                    onClick={() => handleBulkStatusChange("accepted")}
                                >
                                    <Show when={bulkBusyStatus() === "accepted"} fallback="Accept selected">
                                        <span class="loading loading-spinner loading-xs"></span>
                                    </Show>
                                </button>
                                <button
                                    type="button"
                                    class="btn btn-xs btn-error font-mono"
                                    disabled={bulkActionDisabled()}
                                    onClick={() => handleBulkStatusChange("rejected")}
                                >
                                    <Show when={bulkBusyStatus() === "rejected"} fallback="Reject selected">
                                        <span class="loading loading-spinner loading-xs"></span>
                                    </Show>
                                </button>
                                <button
                                    type="button"
                                    class="btn btn-xs btn-ghost border-white/15 font-mono text-base-content/70 hover:bg-white/10 hover:text-white"
                                    disabled={bulkActionDisabled()}
                                    onClick={() => handleBulkStatusChange("pending")}
                                >
                                    <Show when={bulkBusyStatus() === "pending"} fallback="Mark pending">
                                        <span class="loading loading-spinner loading-xs"></span>
                                    </Show>
                                </button>
                            </div>
                        </div>
                    </Show>

                    <Show when={submissions.loading}>
                        <div class="flex justify-center p-20">
                            <span class="loading loading-bars loading-lg text-primary-500"></span>
                        </div>
                    </Show>

                    <Show when={!submissions.loading}>
                        <AdminDataPanel>
                            <Show
                                when={filteredSubmissions().length > 0}
                                fallback={
                                    <div class="p-12 text-center">
                                        <Icon icon="ph:files-bold" class="text-4xl text-base-content/40 mb-4" aria-hidden="true" />
                                        <p class="text-white font-bold mb-2">
                                            {expenseFilter() !== "all" || statusFilter() !== "all"
                                                ? "No proposals match these filters"
                                                : submissionsError()
                                                  ? "Proposals could not be loaded"
                                                  : "No proposals yet"}
                                        </p>
                                        <p class="text-sm text-base-content/60 font-mono max-w-md mx-auto leading-relaxed text-pretty">
                                            {expenseFilter() !== "all" || statusFilter() !== "all"
                                                ? "Try changing the expense or status filters above."
                                                : submissionsError()
                                                  ? "Check the error above, then refresh when the admin API is available."
                                                  : "CFP submissions will appear here after applicants submit proposals."}
                                        </p>
                                    </div>
                                }
                            >
                            {/* Mobile Card View */}
                            <div class="md:hidden space-y-4 p-4">
                                <For each={filteredSubmissions()}>
                                    {(item, index) => (
                                        <article class="bg-white/5 rounded-xl p-4 border border-white/10 space-y-3">
                                            <div class="flex justify-between items-start gap-3">
                                                <div class="flex items-center gap-2">
                                                    <input
                                                        type="checkbox"
                                                        class="checkbox checkbox-sm checkbox-secondary"
                                                        checked={isSelected(item.id)}
                                                        aria-label={`Select proposal ${proposalTitle(item)}`}
                                                        disabled={bulkBusyStatus() !== null}
                                                        onChange={(e) =>
                                                            setSubmissionSelected(item.id, e.currentTarget.checked)
                                                        }
                                                    />
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
                                                              : "border-white/15 text-base-content/70"
                                                    }`}
                                                    value={submissionStatus(item)}
                                                    disabled={statusSelectDisabled(item.id)}
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
                                                <h2 class="font-bold text-white leading-tight mb-1 [overflow-wrap:anywhere]">{proposalTitle(item)}</h2>
                                                <div class="flex items-center gap-2 mt-2">
                                                    <div class="avatar">
                                                        <div class="w-6 rounded-full ring-1 ring-white/20">
                                                            <img
                                                                src={getGravatarUrl(applicantEmail(item))}
                                                                alt={applicantName(item)}
                                                            />
                                                        </div>
                                                    </div>
                                                    <div class="min-w-0 text-sm text-gray-200 [overflow-wrap:anywhere]">{applicantName(item)}</div>
                                                </div>
                                            </div>

                                            <div class="flex flex-col gap-3 pt-3 border-t border-white/5 sm:flex-row sm:items-center sm:justify-between">
                                                <div class="flex flex-wrap items-center gap-2">
                                                    <span class="text-xs font-mono text-base-content/60">{item.reviewCount} Reviews</span>
                                                    {(() => {
                                                        const val = expenseValue(item);
                                                        return (
                                                            <div class={`badge badge-xs font-mono font-bold ${val === "Yes" ? "bg-success/20 border-success/40 text-success" : val === "No" ? "bg-error/20 border-error/40 text-error" : val === "Other" ? "bg-warning/20 border-warning/40 text-warning" : "badge-ghost text-base-content/60"}`}>
                                                                {val || "N/A"}
                                                            </div>
                                                        );
                                                    })()}
                                                 </div>
                                                 <div class="flex items-center gap-2 flex-wrap justify-end">
                                                     <PromotionActions item={item} compact />
                                                     <a
                                                          href={`/reviewer/${item.id}`}
                                                          class="btn btn-sm btn-ghost hover:bg-primary-500/20 hover:text-primary-300 text-base-content/70"
                                                     >
                                                        Review
                                                     </a>
                                                     <button
                                                          type="button"
                                                          class="btn btn-sm btn-ghost hover:bg-error/20 hover:text-error text-base-content/60"
                                                          aria-label={`Delete proposal ${proposalTitle(item)}`}
                                                          onClick={() => setDeleteId(item.id)}
                                                      >
                                                         <Icon icon="ph:trash-bold" aria-hidden="true" />
                                                     </button>
                                                 </div>
                                             </div>
                                        </article>
                                    )}
                                </For>
                            </div>

                            {/* Desktop Table View */}
                             <div class="hidden md:block overflow-x-auto">
                                 <table class="table table-lg w-full">
                                    <caption class="sr-only">CFP proposals, review scores, status, and promotion actions</caption>
                                     <thead>
                                         <tr class="text-white border-b border-white/10 bg-white/5">
                                             <th scope="col" class="w-10 text-center">
                                                 <input
                                                    type="checkbox"
                                                    class="checkbox checkbox-sm checkbox-secondary"
                                                    checked={allVisibleSelected()}
                                                    disabled={visibleSubmissionIds().length === 0 || bulkBusyStatus() !== null}
                                                     aria-label={allVisibleSelected() ? "Deselect visible proposals" : "Select visible proposals"}
                                                     onChange={() => toggleVisibleSelection()}
                                                 />
                                             </th>
                                             <th scope="col" class="text-center font-mono text-accent-400">#</th>
                                             <th scope="col" class="text-center font-mono text-secondary-300">Score</th>
                                             <th scope="col" class="font-bold text-gray-300">Proposal</th>
                                             <th scope="col" class="font-bold text-gray-300">Speaker</th>
                                             <th scope="col" class="text-center font-bold text-gray-300">Expenses</th>
                                             <th scope="col" class="text-center font-bold text-gray-300">Status</th>
                                             <th scope="col" class="text-center font-bold text-gray-300">Reviews</th>
                                             <th scope="col" class="text-center font-bold text-gray-300">Actions</th>
                                         </tr>
                                     </thead>
                                    <tbody>
                                        <For each={filteredSubmissions()}>
                                            {(item, index) => (
                                                <tr class="hover:bg-white/5 border-b border-white/5 transition-colors group">
                                                    <td class="text-center">
                                                        <input
                                                            type="checkbox"
                                                             class="checkbox checkbox-sm checkbox-secondary"
                                                             checked={isSelected(item.id)}
                                                             aria-label={`Select proposal ${proposalTitle(item)}`}
                                                             disabled={bulkBusyStatus() !== null}
                                                            onChange={(e) =>
                                                                setSubmissionSelected(item.id, e.currentTarget.checked)
                                                            }
                                                        />
                                                    </td>
                                                     <td class="text-center font-mono font-bold text-base-content/60 text-xl group-hover:text-accent-400 transition-colors">
                                                         {index() + 1}
                                                     </td>
                                                    <td class="text-center">
                                                        <div class={`badge badge-lg font-mono font-black text-white ${item.totalScore >= 4 ? 'bg-success/20 border-success/40' : item.totalScore >= 3 ? 'bg-warning/20 border-warning/40' : 'bg-error/20 border-error/40'}`}>
                                                            {item.totalScore.toFixed(2)}
                                                        </div>
                                                    </td>
                                                     <td class="min-w-72 max-w-md">
                                                         <div class="font-bold text-lg text-white mb-1 leading-tight group-hover:text-primary-300 transition-colors [overflow-wrap:anywhere]">{proposalTitle(item)}</div>
                                                         <div class="text-xs font-mono text-base-content/55 break-all">{item.id}</div>
                                                     </td>
                                                     <td>
                                                         <div class="flex items-center gap-3">
                                                            <div class="avatar">
                                                                <div class="w-10 rounded-full ring-1 ring-white/20">
                                                                     <img
                                                                         src={getGravatarUrl(applicantEmail(item))}
                                                                         alt={applicantName(item)}
                                                                     />
                                                                </div>
                                                            </div>
                                                            <div>
                                                                 <div class="font-bold text-gray-200 [overflow-wrap:anywhere]">{applicantName(item)}</div>
                                                                 <div class="text-xs text-base-content/60 font-mono break-all">{applicantEmail(item)}</div>
                                                             </div>
                                                         </div>
                                                     </td>
                                                     <td class="text-center">
                                                         {(() => {
                                                             const val = expenseValue(item);
                                                             return (
                                                                 <div class={`badge badge-sm font-mono font-bold ${val === "Yes" ? "bg-success/20 border-success/40 text-success" : val === "No" ? "bg-error/20 border-error/40 text-error" : val === "Other" ? "bg-warning/20 border-warning/40 text-warning" : "badge-ghost text-base-content/60"}`}>
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
                                                                      : "border-white/15 text-base-content/70"
                                                            }`}
                                                            value={submissionStatus(item)}
                                                            disabled={statusSelectDisabled(item.id)}
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
                                                     <td class="text-center font-mono text-base-content/70">
                                                         {item.reviewCount}
                                                     </td>
                                                      <td class="text-center">
                                                          <div class="flex flex-col items-end gap-2">
                                                              <PromotionActions item={item} />
                                                              <div class="flex flex-wrap justify-end gap-2">
                                                                  <a
                                                                      href={`/reviewer/${item.id}`}
                                                                      class="btn btn-sm btn-ghost hover:bg-primary-500/20 hover:text-primary-300 text-base-content/70"
                                                                     title="Review"
                                                                 >
                                                                     Review
                                                                  </a>
                                                                  <button
                                                                      type="button"
                                                                      class="btn btn-sm btn-ghost hover:bg-error/20 hover:text-error text-base-content/60"
                                                                      title="Delete"
                                                                      aria-label={`Delete proposal ${proposalTitle(item)}`}
                                                                      onClick={() => setDeleteId(item.id)}
                                                                 >
                                                                     <Icon icon="ph:trash-bold" aria-hidden="true" />
                                                                 </button>
                                                              </div>
                                                          </div>
                                                     </td>
                                                </tr>
                                            )}
                                        </For>
                                    </tbody>
                                 </table>
                             </div>
                            </Show>
                        </AdminDataPanel>
                    </Show>


            {/* Delete Confirmation Modal */}
            <Show when={deleteId()}>
                <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <div
                        class="absolute inset-0 bg-black/80 backdrop-blur-sm"
                        aria-hidden="true"
                        onClick={() => !isDeleting() && setDeleteId(null)}
                    ></div>
                    <div
                        class="relative bg-base-100 border border-white/10 rounded-2xl shadow-2xl p-6 max-w-sm w-full"
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="delete-submission-title"
                        aria-describedby="delete-submission-description"
                    >
                        <h3 id="delete-submission-title" class="text-xl font-bold text-white mb-2">
                            Delete submission?
                        </h3>
                        <p id="delete-submission-description" class="text-base-content/70 mb-6 leading-relaxed">
                            Delete <span class="font-semibold text-white">{deleteTargetTitle()}</span>? This action cannot be undone.
                        </p>
                        <div class="flex justify-end gap-3">
                            <button
                                type="button"
                                class="btn btn-ghost"
                                onClick={() => setDeleteId(null)}
                                disabled={isDeleting()}
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                class="btn btn-error"
                                onClick={handleDelete}
                                disabled={isDeleting()}
                            >
                                <Show when={isDeleting()} fallback="Delete">
                                    <span class="loading loading-spinner loading-xs" aria-hidden="true"></span>
                                    Deleting...
                                </Show>
                            </button>
                        </div>
                    </div>
                </div>
            </Show>
        </AdminPageShell>
    );
}
