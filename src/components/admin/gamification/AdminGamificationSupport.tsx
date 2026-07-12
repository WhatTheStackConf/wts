import { createSignal, For, Show } from "solid-js";
import {
  AdminDataPanel,
  AdminFormField,
  AdminFormSection,
  adminFormPanelClass,
  adminInputClass,
  adminSelectClass,
  adminTextareaClass,
  useAdminToast,
} from "~/components/admin/AdminPageShell";
import {
  adminApplyGamificationXpCorrection,
  adminManualAwardGamificationAchievement,
  adminRebuildGamificationProfile,
  adminRevokeGamificationBadge,
  adminSearchGamificationCase,
  adminVoidGamificationActivityClaim,
  adminVoidGamificationXpEvent,
} from "~/lib/gamification-admin-actions";
import { adminHandoffPartnerContactConsent } from "~/lib/partner-contact-consent-actions";
import type { PartnerContactDisclosureHandoff } from "~/lib/partner-contact-consent";
import type { AdminGamificationCaseDto } from "~/lib/gamification-admin-support";
import type { AdminActivityDto, AdminAchievementDto } from "~/lib/gamification-operations";

interface AdminGamificationSupportProps {
  activities: AdminActivityDto[];
  achievements: AdminAchievementDto[];
  onChanged: () => unknown;
}

function operationId(): string {
  return globalThis.crypto?.randomUUID?.() || `admin-support-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function formatTime(value?: string): string {
  return value ? new Date(value).toLocaleString() : "Never";
}

function localDateTime(value = new Date().toISOString()): string {
  const date = new Date(value);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function asInstant(value: string): string | undefined {
  if (!value) return undefined;
  const instant = new Date(value);
  return Number.isNaN(instant.valueOf()) ? undefined : instant.toISOString();
}

export default function AdminGamificationSupport(props: AdminGamificationSupportProps) {
  const { toast, showToast } = useAdminToast();
  const [busy, setBusy] = createSignal(false);
  const [query, setQuery] = createSignal("");
  const [cases, setCases] = createSignal<AdminGamificationCaseDto[]>([]);
  const [selectedUserId, setSelectedUserId] = createSignal("");
  const [reason, setReason] = createSignal("");
  const [supportReference, setSupportReference] = createSignal("");
  const [operationIds, setOperationIds] = createSignal<Record<string, string>>({});
  const [awardActivityId, setAwardActivityId] = createSignal("");
  const [awardAchievementId, setAwardAchievementId] = createSignal("");
  const [awardMode, setAwardMode] = createSignal<"badge_only" | "missed_evidence">("badge_only");
  const [awardOccurredAt, setAwardOccurredAt] = createSignal(localDateTime());
  const [awardRanking, setAwardRanking] = createSignal(false);
  const [awardError, setAwardError] = createSignal<"automation" | "source_sync" | "prior_accounting">("automation");
  const [awardHighImpact, setAwardHighImpact] = createSignal(false);
  const [correctionTotal, setCorrectionTotal] = createSignal("0");
  const [correctionLeaderboard, setCorrectionLeaderboard] = createSignal("0");
  const [correctionActivityId, setCorrectionActivityId] = createSignal("");
  const [correctionOriginalEventId, setCorrectionOriginalEventId] = createSignal("");
  const [correctionError, setCorrectionError] = createSignal<"automation" | "source_sync" | "prior_accounting">("prior_accounting");
  const [correctionHighImpact, setCorrectionHighImpact] = createSignal(false);
  const [partnerConsentId, setPartnerConsentId] = createSignal("");
  const [partnerHandoffConfirmed, setPartnerHandoffConfirmed] = createSignal(false);
  const [partnerHandoff, setPartnerHandoff] = createSignal<PartnerContactDisclosureHandoff>();
  const [historyPage, setHistoryPage] = createSignal(1);
  const [hasMoreHistory, setHasMoreHistory] = createSignal(false);

  const selected = () => cases().find((candidate) => candidate.user.id === selectedUserId());

  const search = async (value = query(), page = historyPage()) => {
    const result = await adminSearchGamificationCase(value, page, 50);
    if (!result.success) throw new Error(result.error || "Could not search gamification history.");
    const nextCases = result.data?.cases || [];
    setHistoryPage(result.data?.historyPage || page);
    setHasMoreHistory(Boolean(result.data?.hasMoreHistory));
    setCases(nextCases);
    setSelectedUserId((current) => nextCases.some((candidate) => candidate.user.id === current) ? current : nextCases[0]?.user.id || "");
  };

  const refreshSelected = async () => {
    const current = selected();
    if (current) await search(current.user.id);
    await props.onChanged();
  };

  const run = async (key: string, work: (stableOperationId: string) => Promise<{ success: boolean; error?: string }>) => {
    if (busy()) return;
    setBusy(true);
    const stableOperationId = operationIds()[key] || operationId();
    setOperationIds((current) => ({ ...current, [key]: stableOperationId }));
    try {
      const result = await work(stableOperationId);
      if (!result.success) throw new Error(result.error || "Support operation failed.");
      setOperationIds((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      await refreshSelected();
      showToast("success", "Audited support operation completed.");
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : "Support operation failed.");
    } finally {
      setBusy(false);
    }
  };

  const submitSearch = (event: Event) => {
    event.preventDefault();
    void run("search", async () => {
      await search(query(), 1);
      return { success: true };
    });
  };

  const changeHistoryPage = (page: number) => {
    if (busy() || page < 1) return;
    void run("search-page", async () => {
      await search(query(), page);
      return { success: true };
    });
  };

  const submitPartnerHandoff = (event: Event) => {
    event.preventDefault();
    if (!partnerConsentId().trim()) return showToast("error", "Enter the explicit partner contact consent ID.");
    if (!partnerHandoffConfirmed()) return showToast("error", "Confirm the one-time name/email handoff first.");
    if (!window.confirm("Record and reveal this one-time partner contact handoff? It cannot be repeated.")) return;
    if (busy()) return;
    setBusy(true);
    setPartnerHandoff(undefined);
    void adminHandoffPartnerContactConsent({ consentId: partnerConsentId(), confirmation: true })
      .then((handoff) => {
        setPartnerHandoff(handoff);
        showToast("success", "One-time partner contact handoff recorded.");
      })
      .catch((error) => showToast("error", error instanceof Error ? error.message : "Partner contact handoff failed."))
      .finally(() => setBusy(false));
  };

  const submitManualAward = (event: Event) => {
    event.preventDefault();
    const current = selected();
    if (!current) return showToast("error", "Select exactly one User first.");
    if (!reason().trim()) return showToast("error", "A support reason is required.");
    if (!window.confirm("Apply this audited manual award to the selected User?")) return;
    void run("manual-award", (stableOperationId) => adminManualAwardGamificationAchievement({
      targetUserId: current.user.id,
      achievementId: awardAchievementId(),
      activityId: awardActivityId(),
      mode: awardMode(),
      occurredAt: asInstant(awardOccurredAt()),
      supportReference: supportReference() || undefined,
      rankingError: awardRanking() ? awardError() : undefined,
      highImpactConfirmed: awardRanking() && awardHighImpact(),
      reason: reason(),
      confirmation: true,
      operationId: stableOperationId,
    }));
  };

  const submitCorrection = (event: Event) => {
    event.preventDefault();
    const current = selected();
    if (!current) return showToast("error", "Select exactly one User first.");
    if (!reason().trim()) return showToast("error", "A support reason is required.");
    if (!window.confirm("Apply this signed XP correction? It does not alter existing XP history.")) return;
    void run("xp-correction", (stableOperationId) => adminApplyGamificationXpCorrection({
      targetUserId: current.user.id,
      amount: Number(correctionTotal()),
      leaderboardAmount: Number(correctionLeaderboard()),
      activityId: correctionActivityId() || undefined,
      originalXpEventId: correctionOriginalEventId() || undefined,
      supportReference: supportReference() || undefined,
      rankingError: Number(correctionLeaderboard()) !== 0 ? correctionError() : undefined,
      highImpactConfirmed: correctionHighImpact(),
      reason: reason(),
      confirmation: true,
      operationId: stableOperationId,
    }));
  };

  const revokeBadge = (badgeId: string) => {
    const current = selected();
    if (!current) return;
    if (!reason().trim()) return showToast("error", "A support reason is required.");
    if (!window.confirm("Revoke this Badge only? Its XP history will remain unchanged.")) return;
    void run(`revoke:${badgeId}`, (stableOperationId) => adminRevokeGamificationBadge({
      userAchievementId: badgeId,
      targetUserId: current.user.id,
      reason: reason(),
      confirmation: true,
      operationId: stableOperationId,
    }));
  };

  const voidXpEvent = (eventId: string) => {
    const current = selected();
    if (!current) return;
    if (!reason().trim()) return showToast("error", "A support reason is required.");
    if (!window.confirm("Void this XP Event only? Its Badge and claim history will remain unchanged.")) return;
    void run(`void:${eventId}`, (stableOperationId) => adminVoidGamificationXpEvent({
      xpEventId: eventId,
      targetUserId: current.user.id,
      reason: reason(),
      confirmation: true,
      operationId: stableOperationId,
    }));
  };

  const voidActivityClaim = (claimId: string) => {
    const current = selected();
    if (!current) return;
    if (!reason().trim()) return showToast("error", "A support reason is required.");
    if (!window.confirm("Void this source Activity Claim? Unsupported automated Meta outcomes will be revoked; manual awards remain.")) return;
    void run(`void-claim:${claimId}`, (stableOperationId) => adminVoidGamificationActivityClaim({
      activityClaimId: claimId,
      targetUserId: current.user.id,
      reason: reason(),
      confirmation: true,
      operationId: stableOperationId,
    }));
  };

  const rebuildProfile = () => {
    const current = selected();
    if (!current) return;
    if (!reason().trim()) return showToast("error", "A rebuild reason is required.");
    if (!window.confirm("Rebuild this User's profile cache from retained accounting history?")) return;
    void run("rebuild", (stableOperationId) => adminRebuildGamificationProfile({
      targetUserId: current.user.id,
      reason: reason(),
      confirmation: true,
      operationId: stableOperationId,
    }));
  };

  return (
    <div class="space-y-8">
      <Show when={toast()}>{(currentToast) => <div class={`alert ${currentToast().type === "error" ? "alert-error" : "alert-success"}`} role="status">{currentToast().text}</div>}</Show>
      <form class={adminFormPanelClass} onSubmit={submitSearch}>
        <AdminFormSection title="Single-User support lookup" description="Exact WTS User ID, email, display name, Mission/Activity/Achievement key, code label/prefix, redemption ID, support reference, or Hi.Events stable source ID. Results never include raw codes, hashes, ticket URLs, payment data, or unrelated Users.">
          <div class="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto]">
            <AdminFormField id="gam-support-query" label="Exact case reference" required><input id="gam-support-query" class={adminInputClass("font-mono")} required value={query()} onInput={(event) => setQuery(event.currentTarget.value)} /></AdminFormField>
            <div class="flex items-end"><button type="submit" class="btn btn-secondary font-mono" disabled={busy()}>Search case</button></div>
          </div>
        </AdminFormSection>
      </form>

      <form class={adminFormPanelClass} onSubmit={submitPartnerHandoff}>
        <AdminFormSection title="One-time partner contact handoff" description="Use only an explicit consent ID supplied through an authenticated support case. This records the admin, partner, Activity, time, and approved fields, but never stores copied contact values. It is not a partner portal or export.">
          <div class="grid gap-4 md:grid-cols-2">
            <AdminFormField id="partner-contact-consent-id" label="Partner contact consent ID" required><input id="partner-contact-consent-id" class={adminInputClass("font-mono")} required value={partnerConsentId()} onInput={(event) => setPartnerConsentId(event.currentTarget.value)} /></AdminFormField>
            <label class="flex items-end gap-2 pb-3 text-sm"><input type="checkbox" class="checkbox checkbox-warning" checked={partnerHandoffConfirmed()} onChange={(event) => setPartnerHandoffConfirmed(event.currentTarget.checked)} /> I confirm this is the one permitted name/email handoff.</label>
          </div>
        </AdminFormSection>
        <div class="mt-5 flex justify-end"><button type="submit" class="btn btn-warning font-mono" disabled={busy()}>Record and reveal once</button></div>
        <Show when={partnerHandoff()}>{(handoff) => <div class="alert alert-warning mt-5 items-start text-sm" role="alert"><div class="w-full"><p class="font-bold">Copy only for {handoff().partner.name}</p><p class="mt-1 break-words">{handoff().contact.name} / {handoff().contact.email}</p><p class="mt-2 text-xs">{handoff().activityKey} / {handoff().purpose} / {handoff().fields.join(", ")} / recorded {formatTime(handoff().disclosedAt)}</p><button type="button" class="btn btn-sm btn-outline btn-warning mt-3 font-mono" onClick={() => setPartnerHandoff(undefined)}>Clear contact details from this page</button></div></div>}</Show>
      </form>

      <Show when={cases().length > 1}>
        <AdminDataPanel><div class="p-5"><h2 class="font-bold text-white">Matched support cases</h2><ul class="mt-3 flex flex-wrap gap-2"><For each={cases()}>{(candidate) => <li><button type="button" class={`btn btn-sm font-mono ${candidate.user.id === selectedUserId() ? "btn-primary" : "btn-ghost"}`} onClick={() => setSelectedUserId(candidate.user.id)}>{candidate.user.displayName} <span class="opacity-60">{candidate.user.id}</span></button></li>}</For></ul></div></AdminDataPanel>
      </Show>

      <Show when={selected()}>{(current) => <>
        <div class="grid gap-4 lg:grid-cols-3">
          <AdminDataPanel><div class="p-5"><p class="text-xs font-mono text-base-content/60">SELECTED USER</p><p class="mt-1 font-bold text-white">{current().user.displayName}</p><p class="mt-1 break-all text-xs font-mono text-base-content/60">{current().user.id} / {current().user.email}</p></div></AdminDataPanel>
          <AdminDataPanel><div class="p-5"><p class="text-xs font-mono text-base-content/60">PROFILE CACHE</p><p class="mt-1 font-bold text-white">{current().profile.state}</p><p class="mt-1 text-xs font-mono text-base-content/60">Total {current().profile.totalXp ?? 0} / leaderboard {current().profile.leaderboardXp ?? 0} / level {current().profile.accessLevel ?? 1}</p></div></AdminDataPanel>
          <AdminDataPanel><div class="p-5"><p class="text-xs font-mono text-base-content/60">CASE STATUS</p><p class="mt-1 text-sm font-mono text-white">{current().status.codeCount} codes / {current().status.activityCount} Activities</p><p class="mt-1 text-xs font-mono text-base-content/60">Hi.Events {current().status.hiEvents.reconciliationState} / last sync {formatTime(current().status.hiEvents.lastSyncAt)}</p></div></AdminDataPanel>
        </div>

        <AdminDataPanel><div class="p-5"><p class="text-xs font-mono text-base-content/60">HI.EVENTS SUPPORT STATUS</p><p class="mt-1 font-mono text-sm text-white">{current().status.hiEvents.reconciliationState} / last complete source {formatTime(current().status.hiEvents.lastSuccessfulSyncAt)}</p><Show when={current().status.hiEvents.sources.length > 0} fallback={<p class="mt-1 text-xs font-mono text-base-content/60">No retained source evidence for this User.</p>}><ul class="mt-2 space-y-1"><For each={current().status.hiEvents.sources}>{(source) => <li class="text-xs font-mono text-base-content/60">{source.type} / {source.status} / source {source.stableSourceId}</li>}</For></ul></Show></div></AdminDataPanel>

        <nav class="flex items-center justify-between gap-3" aria-label="Support history pages">
          <button type="button" class="btn btn-sm btn-outline btn-secondary font-mono" disabled={busy() || historyPage() <= 1} onClick={() => changeHistoryPage(historyPage() - 1)}>Previous history</button>
          <p class="font-mono text-xs text-base-content/60" aria-live="polite">History page {historyPage()}</p>
          <button type="button" class="btn btn-sm btn-outline btn-secondary font-mono" disabled={busy() || !hasMoreHistory()} onClick={() => changeHistoryPage(historyPage() + 1)}>Next history</button>
        </nav>

        <AdminDataPanel><div class="border-b border-white/10 p-5"><h2 class="font-bold text-white">Partner follow-up consent</h2><p class="mt-1 text-xs font-mono text-base-content/60">Exact-case consent references only. No copied name/email or partner history is shown here.</p></div><ul class="divide-y divide-white/10"><For each={current().partnerContactConsents}>{(consent) => <li class="p-5"><p class="font-bold text-white">{consent.partnerName} / {consent.activityKey || "retained Activity"}</p><p class="mt-1 text-xs font-mono text-base-content/60">consent {consent.id} / {consent.state} / notice {consent.noticeVersion} / fields {consent.fields.join(", ")}</p><p class="mt-1 text-xs font-mono text-base-content/60">granted {formatTime(consent.grantedAt)} / {consent.handoffState === "handed_off" ? `handoff recorded ${formatTime(consent.handedOffAt)}` : "no handoff recorded"}</p></li>}</For><Show when={current().partnerContactConsents.length === 0}><li class="p-5 text-sm font-mono text-base-content/60">No partner follow-up consent for this User.</li></Show></ul></AdminDataPanel>

        <div class={adminFormPanelClass}>
          <AdminFormSection title="Reason and source reference" description="Required for every mutation. Do not include raw Mission codes, hashes, credentials, URLs, payment data, or unnecessary personal data.">
            <div class="grid gap-4 md:grid-cols-2"><AdminFormField id="gam-support-reason" label="Support reason" required><textarea id="gam-support-reason" class={adminTextareaClass("min-h-20")} required value={reason()} onInput={(event) => setReason(event.currentTarget.value)} /></AdminFormField><AdminFormField id="gam-support-reference" label="Source / support reference"><input id="gam-support-reference" class={adminInputClass("font-mono")} value={supportReference()} onInput={(event) => setSupportReference(event.currentTarget.value)} /></AdminFormField></div>
          </AdminFormSection>
        </div>

        <div class="grid gap-8 xl:grid-cols-2">
          <form class={adminFormPanelClass} onSubmit={submitManualAward}>
            <AdminFormSection title="Manual Achievement award" description="Creates one audited admin_manual Activity Claim and Badge. Badge-only awards are 0 total XP / 0 Leaderboard XP. Missed evidence uses the configured total-XP policy but defaults Leaderboard XP to zero.">
              <div class="grid gap-4 md:grid-cols-2">
                <AdminFormField id="gam-support-award-activity" label="Concrete Activity" required><select id="gam-support-award-activity" class={adminSelectClass()} required value={awardActivityId()} onChange={(event) => setAwardActivityId(event.currentTarget.value)}><option value="">Choose Activity</option><For each={props.activities}>{(activity) => <option value={activity.id}>{activity.key}</option>}</For></select></AdminFormField>
                <AdminFormField id="gam-support-award-achievement" label="Achievement" required><select id="gam-support-award-achievement" class={adminSelectClass()} required value={awardAchievementId()} onChange={(event) => setAwardAchievementId(event.currentTarget.value)}><option value="">Choose Achievement</option><For each={props.achievements}>{(achievement) => <option value={achievement.id}>{achievement.key}</option>}</For></select></AdminFormField>
                <AdminFormField id="gam-support-award-mode" label="Award type" required><select id="gam-support-award-mode" class={adminSelectClass()} value={awardMode()} onChange={(event) => setAwardMode(event.currentTarget.value as "badge_only" | "missed_evidence")}><option value="badge_only">Badge only (0 / 0)</option><option value="missed_evidence">Missed evidence remediation</option></select></AdminFormField>
                <AdminFormField id="gam-support-award-occurred" label="Evidence occurred at"><input id="gam-support-award-occurred" type="datetime-local" class={adminInputClass("font-mono")} value={awardOccurredAt()} onInput={(event) => setAwardOccurredAt(event.currentTarget.value)} /></AdminFormField>
              </div>
              <Show when={awardMode() === "missed_evidence"}><div class="mt-4 space-y-3 rounded-lg border border-warning-400/30 bg-warning-500/10 p-4"><label class="flex items-start gap-3 text-sm"><input type="checkbox" class="checkbox checkbox-sm mt-0.5" checked={awardRanking()} onChange={(event) => setAwardRanking(event.currentTarget.checked)} /> <span>Correct a ranking error. This may apply the original Activity Leaderboard XP only for a WTS automation, source-sync, or prior-accounting error.</span></label><Show when={awardRanking()}><div class="grid gap-3 md:grid-cols-2"><select class={adminSelectClass()} value={awardError()} onChange={(event) => setAwardError(event.currentTarget.value as "automation" | "source_sync" | "prior_accounting")}><option value="automation">WTS automation error</option><option value="source_sync">Source-sync error</option><option value="prior_accounting">Prior-accounting error</option></select><label class="flex items-center gap-2 text-sm font-mono"><input type="checkbox" class="checkbox checkbox-sm" checked={awardHighImpact()} onChange={(event) => setAwardHighImpact(event.currentTarget.checked)} /> High-impact ranking confirmation</label></div></Show></div></Show>
            </AdminFormSection>
            <div class="mt-5 flex justify-end"><button type="submit" class="btn btn-primary font-mono" disabled={busy()}>Confirm manual award</button></div>
          </form>

          <form class={adminFormPanelClass} onSubmit={submitCorrection}>
            <AdminFormSection title="Signed XP correction" description="Creates a new append-only admin_correction XP Event. It never edits earlier accounting. Negative totals and all ranking changes need the separate high-impact confirmation.">
              <div class="grid gap-4 md:grid-cols-2">
                <AdminFormField id="gam-support-correction-total" label="Total XP delta" required><input id="gam-support-correction-total" type="number" class={adminInputClass("font-mono")} required value={correctionTotal()} onInput={(event) => setCorrectionTotal(event.currentTarget.value)} /></AdminFormField>
                <AdminFormField id="gam-support-correction-leaderboard" label="Leaderboard XP delta" required><input id="gam-support-correction-leaderboard" type="number" class={adminInputClass("font-mono")} required value={correctionLeaderboard()} onInput={(event) => setCorrectionLeaderboard(event.currentTarget.value)} /></AdminFormField>
                <AdminFormField id="gam-support-correction-activity" label="Original Activity for ranking changes"><select id="gam-support-correction-activity" class={adminSelectClass()} value={correctionActivityId()} onChange={(event) => setCorrectionActivityId(event.currentTarget.value)}><option value="">No Activity (total-only correction)</option><For each={props.activities}>{(activity) => <option value={activity.id}>{activity.key}</option>}</For></select></AdminFormField>
                <AdminFormField id="gam-support-correction-event" label="Original XP Event"><select id="gam-support-correction-event" class={adminSelectClass()} value={correctionOriginalEventId()} onChange={(event) => setCorrectionOriginalEventId(event.currentTarget.value)}><option value="">Use current policy/cap outcome</option><For each={current().xpEvents.filter((event) => event.sourceType === "activity_claim")}>{(xpEvent) => <option value={xpEvent.id}>{xpEvent.id} / {xpEvent.amount} total / {xpEvent.leaderboardAmount} leaderboard</option>}</For></select></AdminFormField>
              </div>
              <Show when={Number(correctionTotal()) < 0 || Number(correctionLeaderboard()) !== 0}><div class="mt-4 grid gap-3 rounded-lg border border-warning-400/30 bg-warning-500/10 p-4 md:grid-cols-2"><select class={adminSelectClass()} value={correctionError()} onChange={(event) => setCorrectionError(event.currentTarget.value as "automation" | "source_sync" | "prior_accounting")}><option value="automation">WTS automation error</option><option value="source_sync">Source-sync error</option><option value="prior_accounting">Prior-accounting error</option></select><label class="flex items-center gap-2 text-sm font-mono"><input type="checkbox" class="checkbox checkbox-sm" checked={correctionHighImpact()} onChange={(event) => setCorrectionHighImpact(event.currentTarget.checked)} /> High-impact confirmation</label></div></Show>
            </AdminFormSection>
            <div class="mt-5 flex justify-end"><button type="submit" class="btn btn-warning font-mono" disabled={busy()}>Confirm signed correction</button></div>
          </form>
        </div>

        <div class="grid gap-8 xl:grid-cols-2">
          <AdminDataPanel><div class="border-b border-white/10 p-5"><h2 class="font-bold text-white">Badge history</h2><p class="mt-1 text-xs font-mono text-base-content/60">Badge revocation does not void XP.</p></div><ul class="divide-y divide-white/10"><For each={current().badges}>{(badge) => <li class="flex items-center justify-between gap-3 p-5"><div><p class="font-bold text-white">{badge.name || badge.achievementKey || badge.achievementId}</p><p class="text-xs font-mono text-base-content/60">{badge.status} / unlocked {formatTime(badge.unlockedAt)}</p></div><Show when={badge.status === "unlocked"}><button type="button" class="btn btn-sm btn-error btn-outline font-mono" disabled={busy()} onClick={() => revokeBadge(badge.id)}>Revoke Badge</button></Show></li>}</For><Show when={current().badges.length === 0}><li class="p-5 text-sm font-mono text-base-content/60">No Badge history for this User.</li></Show></ul></AdminDataPanel>
          <AdminDataPanel><div class="border-b border-white/10 p-5"><h2 class="font-bold text-white">XP ledger</h2><p class="mt-1 text-xs font-mono text-base-content/60">Voiding an XP Event does not revoke a Badge.</p></div><ul class="divide-y divide-white/10"><For each={current().xpEvents}>{(xpEvent) => <li class="flex items-center justify-between gap-3 p-5"><div><p class="font-bold text-white">{xpEvent.amount >= 0 ? "+" : ""}{xpEvent.amount} total / {xpEvent.leaderboardAmount >= 0 ? "+" : ""}{xpEvent.leaderboardAmount} leaderboard</p><p class="text-xs font-mono text-base-content/60">{xpEvent.sourceType} / {xpEvent.voided ? "voided" : "active"} / {formatTime(xpEvent.occurredAt)}</p></div><Show when={!xpEvent.voided}><button type="button" class="btn btn-sm btn-error btn-outline font-mono" disabled={busy()} onClick={() => voidXpEvent(xpEvent.id)}>Void XP</button></Show></li>}</For><Show when={current().xpEvents.length === 0}><li class="p-5 text-sm font-mono text-base-content/60">No XP history for this User.</li></Show></ul></AdminDataPanel>
        </div>

        <div class="grid gap-8 xl:grid-cols-2">
          <AdminDataPanel><div class="border-b border-white/10 p-5"><h2 class="font-bold text-white">Evidence and code status</h2><p class="mt-1 text-xs font-mono text-base-content/60">Compact case telemetry only. Hi.Events reconciliation is not implemented in this slice.</p></div><div class="divide-y divide-white/10"><For each={current().activities}>{(activity) => <div class="p-5"><p class="font-bold text-white">{activity.key}</p><p class="mt-1 text-xs font-mono text-base-content/60">claims {activity.acceptedClaims} accepted / {activity.voidedClaims} voided / redemptions {activity.acceptedRedemptions} accepted / {activity.rejectedRedemptions} rejected</p><p class="mt-1 text-xs font-mono text-base-content/60">last attempt {formatTime(activity.lastAttemptAt)} / success {formatTime(activity.lastSuccessAt)}</p></div>}</For><For each={current().claims}>{(claim) => <div class="flex items-center justify-between gap-3 p-5"><div><p class="font-bold text-white">{claim.activityKey || claim.activityId}</p><p class="mt-1 text-xs font-mono text-base-content/60">{claim.sourceType} / {claim.status} / {formatTime(claim.occurredAt)}</p><Show when={claim.policyOutcome}><p class="mt-1 text-xs font-mono text-base-content/60">policy {claim.policyOutcome!.totalXp} total / {claim.policyOutcome!.leaderboardXp} leaderboard / caps {claim.policyOutcome!.appliedCaps?.map((cap) => cap.key).join(", ") || "none"}</p></Show><Show when={claim.metaRule}><p class="mt-1 text-xs font-mono text-base-content/60">Meta {claim.metaRule!.kind} / {claim.metaRule!.diversity || "selected Activities"} / sources {claim.metaRule!.sourceClaimIds.join(", ")}</p></Show></div><Show when={claim.status === "accepted" && claim.sourceType !== "system_meta"}><button type="button" class="btn btn-sm btn-error btn-outline font-mono" disabled={busy()} onClick={() => voidActivityClaim(claim.id)}>Void evidence</button></Show></div>}</For><For each={current().codes}>{(code) => <div class="p-5"><p class="font-bold text-white">{code.label} <span class="font-mono text-xs text-base-content/60">{code.lookupPrefix}</span></p><p class="mt-1 text-xs font-mono text-base-content/60">{code.status} / {code.acceptedRedemptions} accepted / {code.rejectedRedemptions} rejected</p></div>}</For><Show when={current().status.hiEvents.sources.length > 0}><div class="p-5"><p class="font-bold text-white">Hi.Events evidence</p><For each={current().status.hiEvents.sources}>{(source) => <p class="mt-1 text-xs font-mono text-base-content/60">{source.type} {source.stableSourceId} / {source.status} / {formatTime(source.occurredAt)}</p>}</For></div></Show></div></AdminDataPanel>
          <AdminDataPanel><div class="border-b border-white/10 p-5"><h2 class="font-bold text-white">Audit history and cache repair</h2><p class="mt-1 text-xs font-mono text-base-content/60">Audit records are append-only. A rebuild repairs only this User's profile cache and resolves pending cache work without replaying awards or corrections.</p></div><div class="p-5"><button type="button" class="btn btn-secondary font-mono" disabled={busy()} onClick={rebuildProfile}>Rebuild profile cache</button></div><ul class="divide-y divide-white/10"><For each={current().audit}>{(action) => <li class="p-5"><p class="font-bold text-white">{action.action} <span class="font-mono text-xs text-base-content/60">{action.status}</span></p><p class="mt-1 text-sm text-base-content/80">{action.reason}</p><p class="mt-1 text-xs font-mono text-base-content/60">actor {action.actorId} / {formatTime(action.occurredAt)} / {action.correlationId || "no correlation ID"}</p><Show when={action.summary.totalXpDelta !== undefined || action.summary.leaderboardXpDelta !== undefined}><p class="mt-1 text-xs font-mono text-base-content/60">delta {action.summary.totalXpDelta ?? 0} total / {action.summary.leaderboardXpDelta ?? 0} leaderboard</p></Show><Show when={action.affected.claimIds.length || action.affected.badgeIds.length || action.affected.xpEventIds.length || action.affected.profileId}><p class="mt-1 break-all text-xs font-mono text-base-content/60">records {action.affected.claimIds.concat(action.affected.badgeIds, action.affected.xpEventIds, action.affected.profileId ? [action.affected.profileId] : []).join(" / ")}</p></Show></li>}</For><Show when={current().audit.length === 0}><li class="p-5 text-sm font-mono text-base-content/60">No support mutations for this User.</li></Show></ul></AdminDataPanel>
        </div>
      </>}</Show>
    </div>
  );
}
