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
import { adminSaveSessionAttendanceMissionDraft } from "~/lib/gamification-operations-actions";
import type { AdminGamificationOperationsDto } from "~/lib/gamification-operations";
import { scheduleInstantToLocalDateTime, scheduleLocalDateTimeToInstant } from "~/lib/programme";

interface AdminSessionAttendanceMissionsProps {
  operations: () => AdminGamificationOperationsDto | null | undefined;
  onChanged: () => unknown;
}

function operationId(): string {
  return globalThis.crypto?.randomUUID?.() || `session-mission-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function AdminSessionAttendanceMissions(props: AdminSessionAttendanceMissionsProps) {
  const [busy, setBusy] = createSignal(false);
  const [message, setMessage] = createSignal<{ kind: "success" | "error"; text: string }>();
  const [sessionId, setSessionId] = createSignal("");
  const [sessionKey, setSessionKey] = createSignal("");
  const [title, setTitle] = createSignal("");
  const [summary, setSummary] = createSignal("");
  const [visibility, setVisibility] = createSignal<"public" | "hidden_until_unlocked" | "admin_only">("public");
  const [evidenceChannel, setEvidenceChannel] = createSignal<"wts_qr" | "wts_link" | "wts_manual_code">("wts_qr");
  const [deploymentLabel, setDeploymentLabel] = createSignal("");
  const [activeFrom, setActiveFrom] = createSignal("");
  const [activeUntil, setActiveUntil] = createSignal("");
  const [maxClaims, setMaxClaims] = createSignal("100");
  const [achievementId, setAchievementId] = createSignal("");
  const [metaEligible, setMetaEligible] = createSignal(false);
  const [scoreScheduleId, setScoreScheduleId] = createSignal("");
  const [scoreDay, setScoreDay] = createSignal("");
  const [sortOrder, setSortOrder] = createSignal("0");
  const [reason, setReason] = createSignal("");

  const publishedSessions = createMemo(() =>
    (props.operations()?.references.sessions || []).filter((session) => session.published),
  );
  const selectedSession = createMemo(() => publishedSessions().find((session) => session.id === sessionId()));
  const draftSchedules = createMemo(() =>
    (props.operations()?.schedules || []).filter((schedule) => schedule.status === "draft"),
  );
  const sessionBadges = createMemo(() =>
    (props.operations()?.achievements || []).filter((achievement) => achievement.category === "session" && achievement.status !== "retired"),
  );
  const sessionActivities = createMemo(() =>
    (props.operations()?.activities || []).filter((activity) => activity.kind === "session"),
  );

  const chooseSession = (value: string) => {
    setSessionId(value);
    setActiveFrom("");
    setActiveUntil("");
    setScoreDay("");
    const session = publishedSessions().find((candidate) => candidate.id === value);
    const context = session?.scheduleContext;
    if (!context) return;
    setActiveFrom(scheduleInstantToLocalDateTime(context.startAt) || "");
    setActiveUntil(scheduleInstantToLocalDateTime(context.endAt) || "");
    setScoreDay(context.dayDate);
  };

  const reset = () => {
    setSessionId(""); setSessionKey(""); setTitle(""); setSummary(""); setVisibility("public"); setEvidenceChannel("wts_qr");
    setDeploymentLabel(""); setActiveFrom(""); setActiveUntil(""); setMaxClaims("100"); setAchievementId(""); setMetaEligible(false);
    setScoreScheduleId(""); setScoreDay(""); setSortOrder("0"); setReason("");
  };

  const save = async (event: Event) => {
    event.preventDefault();
    if (busy()) return;
    setBusy(true);
    setMessage(undefined);
    try {
      const result = await adminSaveSessionAttendanceMissionDraft({
        sessionId: sessionId(),
        sessionKey: sessionKey(),
        title: title(),
        summary: summary(),
        visibility: visibility(),
        evidenceChannel: evidenceChannel(),
        deploymentLabel: deploymentLabel(),
        activeFrom: scheduleLocalDateTimeToInstant(activeFrom()),
        activeUntil: scheduleLocalDateTimeToInstant(activeUntil()),
        perUserClaimLimit: 1,
        maxClaims: Number(maxClaims()),
        achievementId: achievementId() || undefined,
        metaEligible: metaEligible(),
        scoreScheduleId: scoreScheduleId(),
        scoreDay: scoreDay(),
        sortOrder: Number(sortOrder()),
        reason: reason() || undefined,
        operationId: operationId(),
      });
      if (!result.success) throw new Error(result.error || "Could not save the Session Mission draft.");
      await props.onChanged();
      reset();
      setMessage({ kind: "success", text: "Session attendance Mission saved as drafts. Activate the Mission, then its Activity, when ready." });
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "Could not save the Session Mission draft." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="space-y-8">
      <Show when={message()}>{(notice) => <div class={`alert ${notice().kind === "error" ? "alert-error" : "alert-success"}`} role="status">{notice().text}</div>}</Show>
      <form class={adminFormPanelClass} onSubmit={save}>
        <AdminFormSection title="Session attendance Mission" description="The Agenda Slot provides a proposed window only. This form persists independent WTS evidence, limits, caps, and safe historic presentation; slot changes cannot award attendance.">
          <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <AdminFormField id="session-mission-session" label="Published Session" required>
              <select id="session-mission-session" class={adminSelectClass()} required value={sessionId()} onChange={(event) => chooseSession(event.currentTarget.value)}>
                <option value="" disabled>Choose published Session</option>
                <For each={publishedSessions()}>{(session) => <option value={session.id}>{session.title}</option>}</For>
              </select>
            </AdminFormField>
            <AdminFormField id="session-mission-key" label="Immutable Session key" hint="Admin key only, not the mutable public Session slug." required>
              <input id="session-mission-key" class={adminInputClass("font-mono")} required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" value={sessionKey()} onInput={(event) => setSessionKey(event.currentTarget.value)} />
            </AdminFormField>
            <AdminFormField id="session-mission-sort" label="Mission sort order" required>
              <input id="session-mission-sort" class={adminInputClass("font-mono")} required type="number" value={sortOrder()} onInput={(event) => setSortOrder(event.currentTarget.value)} />
            </AdminFormField>
            <AdminFormField id="session-mission-title" label="Mission title" required>
              <input id="session-mission-title" class={adminInputClass()} required value={title()} onInput={(event) => setTitle(event.currentTarget.value)} />
            </AdminFormField>
            <AdminFormField id="session-mission-visibility" label="Mission visibility">
              <select id="session-mission-visibility" class={adminSelectClass()} value={visibility()} onChange={(event) => setVisibility(event.currentTarget.value as "public" | "hidden_until_unlocked" | "admin_only")}>
                <option value="public">Public</option><option value="hidden_until_unlocked">Hidden until unlocked</option><option value="admin_only">Admin only</option>
              </select>
            </AdminFormField>
            <AdminFormField id="session-mission-badge" label="Optional direct Badge">
              <select id="session-mission-badge" class={adminSelectClass()} value={achievementId()} onChange={(event) => setAchievementId(event.currentTarget.value)}>
                <option value="">No direct Badge</option>
                <For each={sessionBadges()}>{(badge) => <option value={badge.id}>{badge.key}</option>}</For>
              </select>
            </AdminFormField>
            <AdminFormField id="session-mission-summary" label="Mission summary" required class="md:col-span-2 xl:col-span-3">
              <textarea id="session-mission-summary" class={adminTextareaClass("min-h-20")} required value={summary()} onInput={(event) => setSummary(event.currentTarget.value)} />
            </AdminFormField>
          </div>
        </AdminFormSection>

        <Show when={selectedSession()?.scheduleContext} fallback={<p class="mt-5 text-sm font-mono text-warning-200">No Agenda Slot context is available for this published Session. Configure the independent evidence window manually.</p>}>
          {(context) => <p class="mt-5 rounded-lg border border-info/30 bg-info/10 p-3 text-sm text-info-content">Agenda context: {context().dayDate}, {scheduleInstantToLocalDateTime(context().startAt)} to {scheduleInstantToLocalDateTime(context().endAt)} Europe/Skopje. Selecting it prefilled the proposed evidence window only.</p>}
        </Show>

        <AdminFormSection title="WTS evidence and policy" description="QR, WTS link, and manual entry are delivery forms for one generated single-code Activity. The fixed 20 total XP / 15 Leaderboard XP policy receives independent Activity, category, day, and conference caps." class="mt-6">
          <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <AdminFormField id="session-mission-channel" label="Primary WTS artifact" required>
              <select id="session-mission-channel" class={adminSelectClass()} value={evidenceChannel()} onChange={(event) => setEvidenceChannel(event.currentTarget.value as "wts_qr" | "wts_link" | "wts_manual_code")}>
                <option value="wts_qr">WTS QR artifact</option><option value="wts_link">WTS link artifact</option><option value="wts_manual_code">WTS manual-code artifact</option>
              </select>
            </AdminFormField>
            <AdminFormField id="session-mission-deployment" label="Deployment label" hint="Describe the WTS-controlled location, never a raw code." required>
              <input id="session-mission-deployment" class={adminInputClass()} required value={deploymentLabel()} onInput={(event) => setDeploymentLabel(event.currentTarget.value)} />
            </AdminFormField>
            <AdminFormField id="session-mission-global-limit" label="Global claim limit" required>
              <input id="session-mission-global-limit" class={adminInputClass("font-mono")} required type="number" min="1" value={maxClaims()} onInput={(event) => setMaxClaims(event.currentTarget.value)} />
            </AdminFormField>
            <AdminFormField id="session-mission-from" label="Evidence active from" required>
              <input id="session-mission-from" class={adminInputClass("font-mono")} required type="datetime-local" value={activeFrom()} onInput={(event) => setActiveFrom(event.currentTarget.value)} />
            </AdminFormField>
            <AdminFormField id="session-mission-until" label="Evidence active until" required>
              <input id="session-mission-until" class={adminInputClass("font-mono")} required type="datetime-local" value={activeUntil()} onInput={(event) => setActiveUntil(event.currentTarget.value)} />
            </AdminFormField>
            <AdminFormField id="session-mission-schedule" label="Draft score schedule" required>
              <select id="session-mission-schedule" class={adminSelectClass()} required value={scoreScheduleId()} onChange={(event) => setScoreScheduleId(event.currentTarget.value)}>
                <option value="" disabled>Choose draft schedule</option>
                <For each={draftSchedules()}>{(schedule) => <option value={schedule.id}>{schedule.key}</option>}</For>
              </select>
            </AdminFormField>
            <AdminFormField id="session-mission-score-day" label="Configured score day" required>
              <input id="session-mission-score-day" class={adminInputClass("font-mono")} required type="date" value={scoreDay()} onInput={(event) => setScoreDay(event.currentTarget.value)} />
            </AdminFormField>
            <AdminFormField id="session-mission-reason" label="Configuration reason">
              <input id="session-mission-reason" class={adminInputClass()} value={reason()} onInput={(event) => setReason(event.currentTarget.value)} />
            </AdminFormField>
            <label class="flex min-h-12 items-center gap-2 text-sm font-mono"><input type="checkbox" class="checkbox checkbox-sm" checked={metaEligible()} onChange={(event) => setMetaEligible(event.currentTarget.checked)} /> Eligible for selected Session Meta rules</label>
          </div>
        </AdminFormSection>
        <div class="mt-5 flex items-center justify-between gap-3"><p class="text-xs font-mono text-base-content/60">Per-User limit: 1, enforced across scans, links, manual entry, and code reissues.</p><div class="flex gap-2"><button type="button" class="btn btn-ghost font-mono" onClick={reset}>Clear</button><button type="submit" class="btn btn-primary font-mono" disabled={busy()}>Save Session Mission draft</button></div></div>
      </form>

      <AdminDataPanel>
        <div class="border-b border-white/10 p-5"><h2 class="font-bold text-white">Configured Session attendance Activities</h2><p class="mt-1 text-xs font-mono text-base-content/60">Mission evidence and source schedule details remain admin-only. Activate the Mission before its Activity.</p></div>
        <ul class="divide-y divide-white/10" role="list"><For each={sessionActivities()}>{(activity) => <li class="p-5"><div class="flex flex-wrap items-center justify-between gap-3"><div><p class="font-bold text-white">{activity.key}</p><p class="mt-1 text-xs font-mono text-base-content/60">window {activity.activeFrom || "unset"} to {activity.activeUntil || "unset"} / claims {activity.acceptedClaims} / Meta {activity.sessionMetaEligible ? "eligible" : "not eligible"}</p></div><span class={`badge badge-sm font-mono ${activity.status === "active" && activity.enabled ? "badge-success" : "badge-ghost"}`}>{activity.status}</span></div></li>}</For><Show when={sessionActivities().length === 0}><li class="p-5 text-sm font-mono text-base-content/60">No Session attendance Activities configured.</li></Show></ul>
      </AdminDataPanel>
    </div>
  );
}
