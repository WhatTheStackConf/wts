import { createMemo, createSignal, For, Show } from "solid-js";
import {
  AdminDataPanel,
  AdminFormField,
  AdminFormSection,
  adminFormPanelClass,
  adminInputClass,
  adminSelectClass,
  adminTextareaClass,
} from "~/components/admin/AdminPageShell";
import { adminSaveCommunityPartnerMissionDraft } from "~/lib/gamification-operations-actions";
import type { AdminGamificationOperationsDto } from "~/lib/gamification-operations";
import type { CommunityPartnerOutcome } from "~/lib/gamification-community-partners";
import type { GamificationEvidenceChannel } from "~/lib/pocketbase-types";
import { scheduleLocalDateTimeToInstant } from "~/lib/programme";

interface AdminCommunityPartnerMissionsProps {
  operations: () => AdminGamificationOperationsDto | null | undefined;
  onChanged: () => unknown;
}

function operationId(): string {
  return globalThis.crypto?.randomUUID?.() || `community-partner-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function AdminCommunityPartnerMissions(props: AdminCommunityPartnerMissionsProps) {
  const [busy, setBusy] = createSignal(false);
  const [message, setMessage] = createSignal<{ kind: "success" | "error"; text: string }>();
  const [partnerId, setPartnerId] = createSignal("");
  const [partnerKey, setPartnerKey] = createSignal("");
  const [programmeKey, setProgrammeKey] = createSignal("");
  const [missionTitle, setMissionTitle] = createSignal("");
  const [summary, setSummary] = createSignal("");
  const [visibility, setVisibility] = createSignal<"public" | "hidden_until_unlocked" | "admin_only">("admin_only");
  const [suggested, setSuggested] = createSignal(false);
  const [flow, setFlow] = createSignal<"one_code" | "two_code">("one_code");
  const [selectedOutcomes, setSelectedOutcomes] = createSignal<CommunityPartnerOutcome[]>(["attendance"]);
  const [outcomeDeployments, setOutcomeDeployments] = createSignal<Record<CommunityPartnerOutcome, string>>({ attendance: "", participation: "", completion: "" });
  const [outcomeAchievements, setOutcomeAchievements] = createSignal<Record<CommunityPartnerOutcome, string>>({ attendance: "", participation: "", completion: "" });
  const [metaOutcome, setMetaOutcome] = createSignal<CommunityPartnerOutcome | "">("");
  const [twoCodeApproved, setTwoCodeApproved] = createSignal(false);
  const [evidenceChannel, setEvidenceChannel] = createSignal<GamificationEvidenceChannel>("wts_qr");
  const [primaryDeployment, setPrimaryDeployment] = createSignal("");
  const [finishDeployment, setFinishDeployment] = createSignal("");
  const [activeFrom, setActiveFrom] = createSignal("");
  const [activeUntil, setActiveUntil] = createSignal("");
  const [maxClaims, setMaxClaims] = createSignal("100");
  const [directAchievementId, setDirectAchievementId] = createSignal("");
  const [completionAchievementId, setCompletionAchievementId] = createSignal("");
  const [metaEligible, setMetaEligible] = createSignal(false);
  const [followUpEnabled, setFollowUpEnabled] = createSignal(false);
  const [followUpOutcome, setFollowUpOutcome] = createSignal<CommunityPartnerOutcome>("attendance");
  const [noticeVersion, setNoticeVersion] = createSignal("");
  const [scoreScheduleId, setScoreScheduleId] = createSignal("");
  const [scoreDay, setScoreDay] = createSignal("");
  const [sortOrder, setSortOrder] = createSignal("0");
  const [reason, setReason] = createSignal("");
  const [configurationOperationId, setConfigurationOperationId] = createSignal("");

  const communityBadges = createMemo(() => (props.operations()?.achievements || [])
    .filter((achievement) => achievement.category === "community" && achievement.status !== "retired"));
  const draftSchedules = createMemo(() => (props.operations()?.schedules || []).filter((schedule) => schedule.status === "draft"));
  const configuredActivities = createMemo(() => (props.operations()?.activities || [])
    .filter((activity) => activity.kind === "community_partner"));

  const reset = () => {
    setPartnerId(""); setPartnerKey(""); setProgrammeKey(""); setMissionTitle(""); setSummary(""); setVisibility("admin_only");
    setSuggested(false); setFlow("one_code"); setSelectedOutcomes(["attendance"]); setOutcomeDeployments({ attendance: "", participation: "", completion: "" });
    setOutcomeAchievements({ attendance: "", participation: "", completion: "" }); setMetaOutcome(""); setTwoCodeApproved(false); setEvidenceChannel("wts_qr");
    setPrimaryDeployment(""); setFinishDeployment(""); setActiveFrom(""); setActiveUntil(""); setMaxClaims("100");
    setDirectAchievementId(""); setCompletionAchievementId(""); setMetaEligible(false); setFollowUpEnabled(false);
    setFollowUpOutcome("attendance"); setNoticeVersion(""); setScoreScheduleId(""); setScoreDay(""); setSortOrder("0"); setReason(""); setConfigurationOperationId("");
  };

  const save = async (event: Event) => {
    event.preventDefault();
    if (busy()) return;
    setBusy(true);
    setMessage(undefined);
    const stableOperationId = configurationOperationId() || operationId();
    setConfigurationOperationId(stableOperationId);
    try {
      const result = await adminSaveCommunityPartnerMissionDraft({
        partnerId: partnerId(), partnerKey: partnerKey(), activityKey: programmeKey(), missionTitle: missionTitle(), summary: summary(),
        visibility: visibility(), suggested: suggested(), flow: flow(),
        outcomes: flow() === "one_code" ? selectedOutcomes().map((selectedOutcome) => ({
          outcome: selectedOutcome,
          deploymentLabel: outcomeDeployments()[selectedOutcome],
          achievementId: outcomeAchievements()[selectedOutcome],
          metaEligible: metaOutcome() === selectedOutcome,
          partnerFollowUp: { enabled: followUpEnabled() && followUpOutcome() === selectedOutcome, noticeVersion: followUpEnabled() && followUpOutcome() === selectedOutcome ? noticeVersion() : undefined },
        })) : [],
        communityTwoCodeApproved: twoCodeApproved(),
        evidenceChannel: evidenceChannel(), primaryDeploymentLabel: flow() === "two_code" ? primaryDeployment() : undefined, finishDeploymentLabel: flow() === "two_code" ? finishDeployment() : undefined,
        activeFrom: scheduleLocalDateTimeToInstant(activeFrom()), activeUntil: scheduleLocalDateTimeToInstant(activeUntil()), perUserClaimLimit: 1,
        maxClaims: Number(maxClaims()), directAchievementId: directAchievementId() || undefined,
        completionAchievementId: flow() === "two_code" ? completionAchievementId() || undefined : undefined,
        metaEligible: metaEligible(), partnerFollowUp: { enabled: followUpEnabled(), noticeVersion: followUpEnabled() ? noticeVersion() : undefined },
        scoreScheduleId: scoreScheduleId(), scoreDay: scoreDay(), sortOrder: Number(sortOrder()), reason: reason() || undefined,
        operationId: stableOperationId,
      });
      if (!result.success) throw new Error(result.error || "Could not save the Community Partner programme.");
      await props.onChanged();
      reset();
      setMessage({ kind: "success", text: "Community Partner Mission and Activities saved as canonical drafts." });
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "Could not save the Community Partner programme." });
    } finally {
      setBusy(false);
    }
  };

  return <div class="space-y-8">
    <Show when={message()}>{(notice) => <div class={`alert ${notice().kind === "error" ? "alert-error" : "alert-success"}`} role="status">{notice().text}</div>}</Show>
    <form class={adminFormPanelClass} onSubmit={save}>
      <AdminFormSection title="Community Partner programme" description="This explicit gamification classification is independent of the partner's public type or tier. Immutable keys use community.{partnerKey}.{activityKey}.">
        <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <AdminFormField id="community-partner-id" label="Existing partner" required hint="Selecting a record does not create a partner account or infer sponsor/community status."><select id="community-partner-id" name="partnerId" class={adminSelectClass()} required value={partnerId()} onChange={(event) => setPartnerId(event.currentTarget.value)}><option value="" disabled>Choose partner record</option><For each={props.operations()?.references.partners || []}>{(partner) => <option value={partner.id}>{partner.name} (public type: {partner.type})</option>}</For></select></AdminFormField>
          <AdminFormField id="community-partner-key" label="Immutable partner key" required><input id="community-partner-key" name="partnerKey" class={adminInputClass("font-mono")} pattern="[a-z0-9]+(?:-[a-z0-9]+)*" required value={partnerKey()} onInput={(event) => setPartnerKey(event.currentTarget.value)} /></AdminFormField>
          <AdminFormField id="community-programme-key" label="Immutable programme key" required><input id="community-programme-key" name="activityKey" class={adminInputClass("font-mono")} pattern="[a-z0-9]+(?:-[a-z0-9]+)*" required value={programmeKey()} onInput={(event) => setProgrammeKey(event.currentTarget.value)} /></AdminFormField>
          <AdminFormField id="community-mission-title" label="Mission title" required><input id="community-mission-title" name="missionTitle" class={adminInputClass()} required value={missionTitle()} onInput={(event) => setMissionTitle(event.currentTarget.value)} /></AdminFormField>
          <AdminFormField id="community-visibility" label="Approved presentation" required><select id="community-visibility" name="visibility" class={adminSelectClass()} value={visibility()} onChange={(event) => { const value = event.currentTarget.value as "public" | "hidden_until_unlocked" | "admin_only"; setVisibility(value); if (value !== "public") setSuggested(false); }}><option value="admin_only">Admin only</option><option value="hidden_until_unlocked">Locked until unlocked</option><option value="public">Public</option></select></AdminFormField>
          <AdminFormField id="community-sort" label="Sort order" required><input id="community-sort" name="sortOrder" type="number" class={adminInputClass("font-mono")} required value={sortOrder()} onInput={(event) => setSortOrder(event.currentTarget.value)} /></AdminFormField>
          <AdminFormField id="community-summary" label="Mission summary" required class="md:col-span-2 xl:col-span-3"><textarea id="community-summary" name="summary" class={adminTextareaClass("min-h-20")} required value={summary()} onInput={(event) => setSummary(event.currentTarget.value)} /></AdminFormField>
          <label class="flex min-h-12 items-center gap-2 text-sm font-mono"><input name="suggested" type="checkbox" class="checkbox checkbox-sm" checked={suggested()} disabled={visibility() !== "public"} onChange={(event) => setSuggested(event.currentTarget.checked)} /> Suggest on public Mission surfaces</label>
        </div>
      </AdminFormSection>

      <AdminFormSection title="WTS evidence and outcome" description="External URLs, RSVP forms, screenshots, clicks, and partner assertions never qualify as evidence." class="mt-6">
        <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <fieldset class="md:col-span-2 xl:col-span-3"><legend class="mb-2 text-sm font-bold text-white">Delivery flow</legend><div class="flex flex-wrap gap-4"><For each={[{ value: "one_code" as const, label: "One-code outcome" }, { value: "two_code" as const, label: "Approved start/finish" }]}>{(option) => <label class="flex min-h-12 items-center gap-2 text-sm font-mono"><input name="flow" type="radio" class="radio radio-sm" checked={flow() === option.value} onChange={() => setFlow(option.value)} /> {option.label}</label>}</For></div></fieldset>
          <Show when={flow() === "one_code"}><fieldset class="md:col-span-2 xl:col-span-3"><legend class="mb-2 text-sm font-bold text-white">Selected outcomes and fixed scores</legend><div class="flex flex-wrap gap-4"><For each={[{ value: "attendance" as const, label: "Attendance 20/15" }, { value: "participation" as const, label: "Participation 25/20" }, { value: "completion" as const, label: "Completion 30/25" }]}>{(option) => <label class="flex min-h-12 items-center gap-2 text-sm font-mono"><input name={`outcome-${option.value}`} type="checkbox" class="checkbox checkbox-sm" checked={selectedOutcomes().includes(option.value)} onChange={(event) => { setSelectedOutcomes((current) => event.currentTarget.checked ? [...current, option.value] : current.filter((value) => value !== option.value)); if (!event.currentTarget.checked && metaOutcome() === option.value) setMetaOutcome(""); if (!event.currentTarget.checked && followUpOutcome() === option.value) setFollowUpEnabled(false); }} /> {option.label}</label>}</For></div></fieldset></Show>
          <Show when={flow() === "two_code"}><label class="flex min-h-12 items-center gap-2 text-sm font-mono md:col-span-2 xl:col-span-3"><input name="twoCodeApproved" type="checkbox" class="checkbox checkbox-sm" required checked={twoCodeApproved()} onChange={(event) => setTwoCodeApproved(event.currentTarget.checked)} /> Explicit organizer approval for the shared 40/30 start-and-finish model</label></Show>
          <AdminFormField id="community-channel" label="WTS evidence channel" required><select id="community-channel" name="evidenceChannel" class={adminSelectClass()} value={evidenceChannel()} onChange={(event) => setEvidenceChannel(event.currentTarget.value as GamificationEvidenceChannel)}><option value="wts_qr">WTS QR</option><option value="wts_link">WTS link</option><option value="wts_manual_code">WTS manual code</option><option value="wts_static_code">WTS static code</option></select></AdminFormField>
          <Show when={flow() === "one_code"}><div class="grid gap-4 md:col-span-2 xl:col-span-3 md:grid-cols-2 xl:grid-cols-3"><For each={selectedOutcomes()}>{(selectedOutcome) => <>
            <AdminFormField id={`community-${selectedOutcome}-deployment`} label={`${selectedOutcome} deployment`} required><input id={`community-${selectedOutcome}-deployment`} name={`${selectedOutcome}Deployment`} class={adminInputClass()} required value={outcomeDeployments()[selectedOutcome]} onInput={(event) => setOutcomeDeployments((current) => ({ ...current, [selectedOutcome]: event.currentTarget.value }))} /></AdminFormField>
            <AdminFormField id={`community-${selectedOutcome}-badge`} label={`${selectedOutcome} Badge`} required><select id={`community-${selectedOutcome}-badge`} name={`${selectedOutcome}AchievementId`} class={adminSelectClass()} required value={outcomeAchievements()[selectedOutcome]} onChange={(event) => setOutcomeAchievements((current) => ({ ...current, [selectedOutcome]: event.currentTarget.value }))}><option value="" disabled>Choose Community Badge</option><For each={communityBadges()}>{(badge) => <option value={badge.id}>{badge.key}</option>}</For></select></AdminFormField>
          </>}</For></div></Show>
          <Show when={flow() === "two_code"}><AdminFormField id="community-primary-deployment" label="Start deployment" required><input id="community-primary-deployment" name="primaryDeployment" class={adminInputClass()} required value={primaryDeployment()} onInput={(event) => setPrimaryDeployment(event.currentTarget.value)} /></AdminFormField></Show>
          <Show when={flow() === "two_code"}><AdminFormField id="community-finish-deployment" label="Finish deployment" required><input id="community-finish-deployment" name="finishDeployment" class={adminInputClass()} required value={finishDeployment()} onInput={(event) => setFinishDeployment(event.currentTarget.value)} /></AdminFormField></Show>
          <AdminFormField id="community-from" label="Active from" required><input id="community-from" name="activeFrom" type="datetime-local" class={adminInputClass("font-mono")} required value={activeFrom()} onInput={(event) => setActiveFrom(event.currentTarget.value)} /></AdminFormField>
          <AdminFormField id="community-until" label="Active until" required><input id="community-until" name="activeUntil" type="datetime-local" class={adminInputClass("font-mono")} required value={activeUntil()} onInput={(event) => setActiveUntil(event.currentTarget.value)} /></AdminFormField>
          <AdminFormField id="community-max-claims" label="Global claim limit per Activity" required><input id="community-max-claims" name="maxClaims" type="number" min="1" class={adminInputClass("font-mono")} required value={maxClaims()} onInput={(event) => setMaxClaims(event.currentTarget.value)} /></AdminFormField>
          <Show when={flow() === "two_code"}><AdminFormField id="community-direct-badge" label="Start Badge" required><select id="community-direct-badge" name="directAchievementId" class={adminSelectClass()} required value={directAchievementId()} onChange={(event) => setDirectAchievementId(event.currentTarget.value)}><option value="" disabled>Choose Community Badge</option><For each={communityBadges()}>{(badge) => <option value={badge.id}>{badge.key}</option>}</For></select></AdminFormField></Show>
          <Show when={flow() === "two_code"}><AdminFormField id="community-completion-badge" label="Completion claim-set Badge" required><select id="community-completion-badge" name="completionAchievementId" class={adminSelectClass()} required value={completionAchievementId()} onChange={(event) => setCompletionAchievementId(event.currentTarget.value)}><option value="" disabled>Choose Community Badge</option><For each={communityBadges()}>{(badge) => <option value={badge.id}>{badge.key}</option>}</For></select></AdminFormField></Show>
          <Show when={flow() === "one_code"}><AdminFormField id="community-meta-outcome" label="Meta-designated outcome" hint="At most one qualifying Activity per programme."><select id="community-meta-outcome" name="metaOutcome" class={adminSelectClass()} value={metaOutcome()} onChange={(event) => setMetaOutcome(event.currentTarget.value as CommunityPartnerOutcome | "")}><option value="">No Meta source</option><For each={selectedOutcomes()}>{(selectedOutcome) => <option value={selectedOutcome}>{selectedOutcome}</option>}</For></select></AdminFormField></Show>
          <Show when={flow() === "two_code"}><label class="flex min-h-12 items-center gap-2 text-sm font-mono"><input name="metaEligible" type="checkbox" class="checkbox checkbox-sm" checked={metaEligible()} onChange={(event) => setMetaEligible(event.currentTarget.checked)} /> Register derived completion with shared Meta rules</label></Show>
        </div>
      </AdminFormSection>

      <AdminFormSection title="Consent and caps" description="Partner follow-up is unchecked, current-User controlled, withdrawable, name/email only, and separate from every gamification outcome." class="mt-6">
        <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <label class="flex min-h-12 items-center gap-2 text-sm font-mono"><input name="followUpEnabled" type="checkbox" class="checkbox checkbox-sm" checked={followUpEnabled()} onChange={(event) => setFollowUpEnabled(event.currentTarget.checked)} /> Offer separate partner_follow_up consent</label>
          <Show when={flow() === "one_code" && followUpEnabled()}><AdminFormField id="community-follow-up-outcome" label="Consent Activity" required><select id="community-follow-up-outcome" name="followUpOutcome" class={adminSelectClass()} required value={followUpOutcome()} onChange={(event) => setFollowUpOutcome(event.currentTarget.value as CommunityPartnerOutcome)}><For each={selectedOutcomes()}>{(selectedOutcome) => <option value={selectedOutcome}>{selectedOutcome}</option>}</For></select></AdminFormField></Show>
          <AdminFormField id="community-notice-version" label="Consent notice version" required={followUpEnabled()}><input id="community-notice-version" name="noticeVersion" class={adminInputClass("font-mono")} required={followUpEnabled()} disabled={!followUpEnabled()} value={noticeVersion()} onInput={(event) => setNoticeVersion(event.currentTarget.value)} /></AdminFormField>
          <AdminFormField id="community-schedule" label="Draft score schedule" required><select id="community-schedule" name="scoreScheduleId" class={adminSelectClass()} required value={scoreScheduleId()} onChange={(event) => setScoreScheduleId(event.currentTarget.value)}><option value="" disabled>Choose draft schedule</option><For each={draftSchedules()}>{(schedule) => <option value={schedule.id}>{schedule.key}</option>}</For></select></AdminFormField>
          <AdminFormField id="community-score-day" label="Score day" required><input id="community-score-day" name="scoreDay" type="date" class={adminInputClass("font-mono")} required value={scoreDay()} onInput={(event) => setScoreDay(event.currentTarget.value)} /></AdminFormField>
          <AdminFormField id="community-reason" label="Configuration reason"><input id="community-reason" name="reason" class={adminInputClass()} value={reason()} onInput={(event) => setReason(event.currentTarget.value)} /></AdminFormField>
        </div>
      </AdminFormSection>
      <div class="mt-5 flex items-center justify-between gap-3"><p class="text-xs font-mono text-base-content/60">One accepted claim per User and Activity across every code and reissue.</p><div class="flex gap-2"><button type="button" class="btn btn-ghost font-mono" onClick={reset}>Clear</button><button type="submit" class="btn btn-primary font-mono" disabled={busy()}>Save Community Partner drafts</button></div></div>
    </form>

    <AdminDataPanel><div class="border-b border-white/10 p-5"><h2 class="font-bold text-white">Community Partner Activities</h2><p class="mt-1 text-xs font-mono text-base-content/60">Administratively distinct from commercial sponsor booths. Only safe configuration metadata is shown.</p></div><ul class="divide-y divide-white/10" role="list"><For each={configuredActivities()}>{(activity) => <li class="p-5"><div class="flex flex-wrap items-center justify-between gap-3"><div><p class="font-bold text-white">{activity.key}</p><p class="mt-1 text-xs font-mono text-base-content/60">{activity.outcomeKey} / {activity.evidenceMode} / Meta {activity.communityMetaEligible ? "eligible" : "not eligible"} / claims {activity.acceptedClaims}</p></div><span class={`badge badge-sm font-mono ${activity.status === "active" && activity.enabled ? "badge-success" : "badge-ghost"}`}>{activity.status}</span></div></li>}</For><Show when={configuredActivities().length === 0}><li class="p-5 text-sm font-mono text-base-content/60">No Community Partner Activities.</li></Show></ul></AdminDataPanel>
  </div>;
}
