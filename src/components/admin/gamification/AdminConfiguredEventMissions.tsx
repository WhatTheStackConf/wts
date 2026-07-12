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
import { adminSaveConfiguredEventMissionDraft } from "~/lib/gamification-operations-actions";
import type { AdminGamificationOperationsDto } from "~/lib/gamification-operations";
import type { ConfiguredEventKind } from "~/lib/gamification-event-missions";
import { scheduleLocalDateTimeToInstant } from "~/lib/programme";

interface AdminConfiguredEventMissionsProps {
  operations: () => AdminGamificationOperationsDto | null | undefined;
  onChanged: () => unknown;
}

function operationId(): string {
  return globalThis.crypto?.randomUUID?.() || `configured-event-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function categoryFor(kind: ConfiguredEventKind): "workshop" | "warmup_event" | "satellite_event" | "social" {
  if (kind === "warmup") return "warmup_event";
  if (kind === "satellite") return "satellite_event";
  return kind;
}

export default function AdminConfiguredEventMissions(props: AdminConfiguredEventMissionsProps) {
  const [busy, setBusy] = createSignal(false);
  const [message, setMessage] = createSignal<{ kind: "success" | "error"; text: string }>();
  const [eventKey, setEventKey] = createSignal("");
  const [kind, setKind] = createSignal<ConfiguredEventKind>("workshop");
  const [title, setTitle] = createSignal("");
  const [missionTitle, setMissionTitle] = createSignal("");
  const [summary, setSummary] = createSignal("");
  const [visibility, setVisibility] = createSignal<"public" | "hidden_until_unlocked" | "admin_only">("public");
  const [locationLabel, setLocationLabel] = createSignal("");
  const [hostPartnerId, setHostPartnerId] = createSignal("");
  const [capGroupKey, setCapGroupKey] = createSignal("");
  const [flow, setFlow] = createSignal<"one_code" | "two_code">("one_code");
  const [relatedApproval, setRelatedApproval] = createSignal(false);
  const [suggested, setSuggested] = createSignal(true);
  const [evidenceChannel, setEvidenceChannel] = createSignal<"wts_qr" | "wts_link" | "wts_manual_code">("wts_qr");
  const [attendanceDeployment, setAttendanceDeployment] = createSignal("");
  const [finishDeployment, setFinishDeployment] = createSignal("");
  const [activeFrom, setActiveFrom] = createSignal("");
  const [activeUntil, setActiveUntil] = createSignal("");
  const [maxClaims, setMaxClaims] = createSignal("100");
  const [attendanceAchievementId, setAttendanceAchievementId] = createSignal("");
  const [completionAchievementId, setCompletionAchievementId] = createSignal("");
  const [metaEligible, setMetaEligible] = createSignal(false);
  const [scoreScheduleId, setScoreScheduleId] = createSignal("");
  const [scoreDay, setScoreDay] = createSignal("");
  const [sortOrder, setSortOrder] = createSignal("0");
  const [reason, setReason] = createSignal("");
  const [configurationOperationId, setConfigurationOperationId] = createSignal("");

  const draftSchedules = createMemo(() => (props.operations()?.schedules || []).filter((schedule) => schedule.status === "draft"));
  const eventBadges = createMemo(() => (props.operations()?.achievements || []).filter((achievement) =>
    achievement.category === categoryFor(kind()) && achievement.status !== "retired",
  ));
  const configuredActivities = createMemo(() => (props.operations()?.activities || []).filter((activity) =>
    ["workshop", "warmup_event", "satellite_event", "social"].includes(activity.kind),
  ));

  const reset = () => {
    setEventKey(""); setKind("workshop"); setTitle(""); setMissionTitle(""); setSummary(""); setVisibility("public");
    setLocationLabel(""); setHostPartnerId(""); setCapGroupKey(""); setFlow("one_code"); setRelatedApproval(false); setSuggested(true);
    setEvidenceChannel("wts_qr"); setAttendanceDeployment(""); setFinishDeployment(""); setActiveFrom(""); setActiveUntil("");
    setMaxClaims("100"); setAttendanceAchievementId(""); setCompletionAchievementId(""); setMetaEligible(false);
    setScoreScheduleId(""); setScoreDay(""); setSortOrder("0"); setReason(""); setConfigurationOperationId("");
  };

  const save = async (event: Event) => {
    event.preventDefault();
    if (busy()) return;
    setBusy(true);
    setMessage(undefined);
    const stableOperationId = configurationOperationId() || operationId();
    setConfigurationOperationId(stableOperationId);
    try {
      const result = await adminSaveConfiguredEventMissionDraft({
        eventKey: eventKey(),
        kind: kind(),
        title: title(),
        missionTitle: missionTitle(),
        summary: summary(),
        visibility: visibility(),
        locationLabel: locationLabel() || undefined,
        hostPartnerId: hostPartnerId() || undefined,
        capGroupKey: capGroupKey(),
        flow: flow(),
        relatedEventTwoCodeApproved: relatedApproval(),
        suggested: suggested(),
        evidenceChannel: evidenceChannel(),
        attendanceDeploymentLabel: attendanceDeployment(),
        finishDeploymentLabel: flow() === "two_code" ? finishDeployment() : undefined,
        activeFrom: scheduleLocalDateTimeToInstant(activeFrom()),
        activeUntil: scheduleLocalDateTimeToInstant(activeUntil()),
        perUserClaimLimit: 1,
        maxClaims: Number(maxClaims()),
        attendanceAchievementId: attendanceAchievementId() || undefined,
        completionAchievementId: flow() === "two_code" ? completionAchievementId() || undefined : undefined,
        metaEligible: metaEligible(),
        scoreScheduleId: scoreScheduleId(),
        scoreDay: scoreDay(),
        sortOrder: Number(sortOrder()),
        reason: reason() || undefined,
        operationId: stableOperationId,
      });
      if (!result.success) throw new Error(result.error || "Could not save the configured event Mission.");
      await props.onChanged();
      reset();
      setMessage({ kind: "success", text: "Event Mission saved as canonical drafts. Activate the Mission, Activities, linked Badges, and score schedule before generating codes." });
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "Could not save the configured event Mission." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="space-y-8">
      <Show when={message()}>{(notice) => <div class={`alert ${notice().kind === "error" ? "alert-error" : "alert-success"}`} role="status">{notice().text}</div>}</Show>
      <form class={adminFormPanelClass} onSubmit={save}>
        <AdminFormSection title="Configured event reference" description="This private organizer inventory is independent of Agenda Slots, timeline entries, and Hi.Events. Its key and operating context become immutable when saved.">
          <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <AdminFormField id="event-mission-key" label="Immutable event key" required><input id="event-mission-key" name="eventKey" class={adminInputClass("font-mono")} pattern="[a-z0-9]+(?:-[a-z0-9]+)*" required value={eventKey()} onInput={(event) => setEventKey(event.currentTarget.value)} /></AdminFormField>
            <AdminFormField id="event-mission-title" label="Event title" required><input id="event-mission-title" name="title" class={adminInputClass()} required value={title()} onInput={(event) => setTitle(event.currentTarget.value)} /></AdminFormField>
            <AdminFormField id="event-mission-location" label="Location context"><input id="event-mission-location" name="locationLabel" class={adminInputClass()} value={locationLabel()} onInput={(event) => setLocationLabel(event.currentTarget.value)} /></AdminFormField>
            <fieldset class="md:col-span-2 xl:col-span-3"><legend class="mb-2 text-sm font-bold text-white">Event kind</legend><div class="flex flex-wrap gap-4"><For each={["workshop", "warmup", "satellite", "social"] as const}>{(option) => <label class="flex min-h-12 items-center gap-2 text-sm font-mono"><input name="eventKind" type="radio" class="radio radio-sm" value={option} checked={kind() === option} onChange={() => { setKind(option); setAttendanceAchievementId(""); setCompletionAchievementId(""); }} /> {option}</label>}</For></div></fieldset>
            <AdminFormField id="event-mission-public-title" label="Mission title" required><input id="event-mission-public-title" name="missionTitle" class={adminInputClass()} required value={missionTitle()} onInput={(event) => setMissionTitle(event.currentTarget.value)} /></AdminFormField>
            <AdminFormField id="event-mission-visibility" label="Mission visibility" required><select id="event-mission-visibility" name="visibility" class={adminSelectClass()} value={visibility()} onChange={(event) => { const value = event.currentTarget.value as "public" | "hidden_until_unlocked" | "admin_only"; setVisibility(value); if (value !== "public") setSuggested(false); }}><option value="public">Public</option><option value="hidden_until_unlocked">Hidden until unlocked</option><option value="admin_only">Admin only</option></select></AdminFormField>
            <AdminFormField id="event-mission-host" label="Optional host partner" hint="Leave empty for WTS-run events. Attribution never creates a partner score cap."><select id="event-mission-host" name="hostPartnerId" class={adminSelectClass()} value={hostPartnerId()} onChange={(event) => setHostPartnerId(event.currentTarget.value)}><option value="">WTS-run / no host partner</option><For each={props.operations()?.references.partners || []}>{(partner) => <option value={partner.id}>{partner.name}</option>}</For></select></AdminFormField>
            <AdminFormField id="event-mission-cap-group" label="Immutable cap group key" hint="Groups this event's attendance/start/completion policies under one ceiling." required><input id="event-mission-cap-group" name="capGroupKey" class={adminInputClass("font-mono")} required value={capGroupKey()} onInput={(event) => setCapGroupKey(event.currentTarget.value)} /></AdminFormField>
            <AdminFormField id="event-mission-summary" label="Mission summary" required class="md:col-span-2 xl:col-span-3"><textarea id="event-mission-summary" name="summary" class={adminTextareaClass("min-h-20")} required value={summary()} onInput={(event) => setSummary(event.currentTarget.value)} /></AdminFormField>
            <AdminFormField id="event-mission-from" label="Operating from" required><input id="event-mission-from" name="activeFrom" type="datetime-local" class={adminInputClass("font-mono")} required value={activeFrom()} onInput={(event) => setActiveFrom(event.currentTarget.value)} /></AdminFormField>
            <AdminFormField id="event-mission-until" label="Operating until" required><input id="event-mission-until" name="activeUntil" type="datetime-local" class={adminInputClass("font-mono")} required value={activeUntil()} onInput={(event) => setActiveUntil(event.currentTarget.value)} /></AdminFormField>
            <AdminFormField id="event-mission-sort" label="Mission sort order" required><input id="event-mission-sort" name="sortOrder" type="number" class={adminInputClass("font-mono")} required value={sortOrder()} onInput={(event) => setSortOrder(event.currentTarget.value)} /></AdminFormField>
            <label class="flex min-h-12 items-center gap-2 text-sm font-mono"><input name="suggested" type="checkbox" class="checkbox checkbox-sm" checked={suggested()} disabled={visibility() !== "public"} onChange={(event) => setSuggested(event.currentTarget.checked)} /> Suggest on public Mission surfaces</label>
          </div>
        </AdminFormSection>

        <AdminFormSection title="Evidence and outcomes" description="One-code attendance awards 30/25. Two-code completion awards 10/5 at start, 0/0 at finish, then derives 30/25 after both claims with a 40/30 event ceiling. Code order is irrelevant." class="mt-6">
          <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <fieldset class="md:col-span-2 xl:col-span-3"><legend class="mb-2 text-sm font-bold text-white">Evidence flow</legend><div class="flex flex-wrap gap-4"><For each={[{ value: "one_code" as const, label: "One-code attendance" }, { value: "two_code" as const, label: "Two-code completion" }]}>{(option) => <label class="flex min-h-12 items-center gap-2 text-sm font-mono"><input name="flow" type="radio" class="radio radio-sm" value={option.value} checked={flow() === option.value} onChange={() => setFlow(option.value)} /> {option.label}</label>}</For></div></fieldset>
            <Show when={flow() === "two_code" && kind() !== "workshop"}><label class="flex min-h-12 items-center gap-2 text-sm font-mono md:col-span-2 xl:col-span-3"><input name="relatedApproval" type="checkbox" class="checkbox checkbox-sm" required checked={relatedApproval()} onChange={(event) => setRelatedApproval(event.currentTarget.checked)} /> Explicit organizer approval for two-code use on this related event</label></Show>
            <AdminFormField id="event-mission-channel" label="WTS evidence channel" required><select id="event-mission-channel" name="evidenceChannel" class={adminSelectClass()} value={evidenceChannel()} onChange={(event) => setEvidenceChannel(event.currentTarget.value as "wts_qr" | "wts_link" | "wts_manual_code")}><option value="wts_qr">WTS QR artifact</option><option value="wts_link">WTS link artifact</option><option value="wts_manual_code">WTS manual-code artifact</option></select></AdminFormField>
            <AdminFormField id="event-mission-attendance-deployment" label={flow() === "one_code" ? "Attendance deployment" : "Start deployment"} required><input id="event-mission-attendance-deployment" name="attendanceDeployment" class={adminInputClass()} required value={attendanceDeployment()} onInput={(event) => setAttendanceDeployment(event.currentTarget.value)} /></AdminFormField>
            <Show when={flow() === "two_code"}><AdminFormField id="event-mission-finish-deployment" label="Finish deployment" required><input id="event-mission-finish-deployment" name="finishDeployment" class={adminInputClass()} required value={finishDeployment()} onInput={(event) => setFinishDeployment(event.currentTarget.value)} /></AdminFormField></Show>
            <AdminFormField id="event-mission-max-claims" label="Global claim limit per Activity" required><input id="event-mission-max-claims" name="maxClaims" type="number" min="1" class={adminInputClass("font-mono")} required value={maxClaims()} onInput={(event) => setMaxClaims(event.currentTarget.value)} /></AdminFormField>
            <AdminFormField id="event-mission-attendance-badge" label="Optional attendance Badge"><select id="event-mission-attendance-badge" name="attendanceAchievementId" class={adminSelectClass()} value={attendanceAchievementId()} onChange={(event) => setAttendanceAchievementId(event.currentTarget.value)}><option value="">No attendance Badge</option><For each={eventBadges()}>{(badge) => <option value={badge.id}>{badge.key}</option>}</For></select></AdminFormField>
            <Show when={flow() === "two_code"}><AdminFormField id="event-mission-completion-badge" label="Completion claim-set Badge" required><select id="event-mission-completion-badge" name="completionAchievementId" class={adminSelectClass()} required value={completionAchievementId()} onChange={(event) => setCompletionAchievementId(event.currentTarget.value)}><option value="" disabled>Choose completion Badge</option><For each={eventBadges()}>{(badge) => <option value={badge.id}>{badge.key}</option>}</For></select></AdminFormField></Show>
            <label class="flex min-h-12 items-center gap-2 text-sm font-mono"><input name="metaEligible" type="checkbox" class="checkbox checkbox-sm" checked={metaEligible()} onChange={(event) => setMetaEligible(event.currentTarget.checked)} /> Register attendance/completion with shared Meta rules</label>
          </div>
        </AdminFormSection>

        <AdminFormSection title="Score schedule" description="Category, score day, and conference caps are snapshotted independently when the selected draft schedule is activated." class="mt-6">
          <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <AdminFormField id="event-mission-schedule" label="Draft score schedule" required><select id="event-mission-schedule" name="scoreScheduleId" class={adminSelectClass()} required value={scoreScheduleId()} onChange={(event) => setScoreScheduleId(event.currentTarget.value)}><option value="" disabled>Choose draft schedule</option><For each={draftSchedules()}>{(schedule) => <option value={schedule.id}>{schedule.key}</option>}</For></select></AdminFormField>
            <AdminFormField id="event-mission-score-day" label="Score day" required><input id="event-mission-score-day" name="scoreDay" type="date" class={adminInputClass("font-mono")} required value={scoreDay()} onInput={(event) => setScoreDay(event.currentTarget.value)} /></AdminFormField>
            <AdminFormField id="event-mission-reason" label="Configuration reason"><input id="event-mission-reason" name="reason" class={adminInputClass()} value={reason()} onInput={(event) => setReason(event.currentTarget.value)} /></AdminFormField>
          </div>
        </AdminFormSection>
        <div class="mt-5 flex items-center justify-between gap-3"><p class="text-xs font-mono text-base-content/60">Per-User claim limit: 1 per Activity, including replacement codes.</p><div class="flex gap-2"><button type="button" class="btn btn-ghost font-mono" onClick={reset}>Clear</button><button type="submit" class="btn btn-primary font-mono" disabled={busy()}>Save event Mission drafts</button></div></div>
      </form>

      <AdminDataPanel>
        <div class="border-b border-white/10 p-5"><h2 class="font-bold text-white">Configured event Activities</h2><p class="mt-1 text-xs font-mono text-base-content/60">Only safe organizer context is shown. Raw codes remain available only in their one-time generation response.</p></div>
        <ul class="divide-y divide-white/10" role="list"><For each={configuredActivities()}>{(activity) => <li class="p-5"><div class="flex flex-wrap items-center justify-between gap-3"><div><p class="font-bold text-white">{activity.key}</p><p class="mt-1 text-xs font-mono text-base-content/60">{activity.eventRef?.title || activity.kind} / {activity.evidenceMode} / Meta {activity.eventMetaEligible ? "eligible" : "not eligible"} / claims {activity.acceptedClaims}</p></div><span class={`badge badge-sm font-mono ${activity.status === "active" && activity.enabled ? "badge-success" : "badge-ghost"}`}>{activity.status}</span></div></li>}</For><Show when={configuredActivities().length === 0}><li class="p-5 text-sm font-mono text-base-content/60">No configured event Activities.</li></Show></ul>
      </AdminDataPanel>
    </div>
  );
}
