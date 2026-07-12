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
import { adminSaveEasterEggMissionDraft } from "~/lib/gamification-operations-actions";
import type { AdminGamificationOperationsDto } from "~/lib/gamification-operations";
import { scheduleLocalDateTimeToInstant } from "~/lib/programme";

interface AdminEasterEggMissionsProps {
  operations: () => AdminGamificationOperationsDto | null | undefined;
  onChanged: () => unknown;
}

type BadgeRarity = "common" | "uncommon" | "rare" | "epic" | "legendary";

function operationId(): string {
  return globalThis.crypto?.randomUUID?.() || `easter-egg-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function AdminEasterEggMissions(props: AdminEasterEggMissionsProps) {
  const [busy, setBusy] = createSignal(false);
  const [message, setMessage] = createSignal<{ kind: "success" | "error"; text: string }>();
  const [eggKey, setEggKey] = createSignal("");
  const [missionTitle, setMissionTitle] = createSignal("");
  const [missionSummary, setMissionSummary] = createSignal("");
  const [badgeName, setBadgeName] = createSignal("");
  const [badgeDescription, setBadgeDescription] = createSignal("");
  const [badgeIcon, setBadgeIcon] = createSignal("");
  const [badgeRarity, setBadgeRarity] = createSignal<BadgeRarity>("rare");
  const [evidenceChannel, setEvidenceChannel] = createSignal<"wts_qr" | "wts_link" | "wts_manual_code">("wts_qr");
  const [deploymentNote, setDeploymentNote] = createSignal("");
  const [activeFrom, setActiveFrom] = createSignal("");
  const [activeUntil, setActiveUntil] = createSignal("");
  const [maxClaims, setMaxClaims] = createSignal("100");
  const [scoreScheduleId, setScoreScheduleId] = createSignal("");
  const [sortOrder, setSortOrder] = createSignal("0");
  const [reason, setReason] = createSignal("");
  const [configurationOperationId, setConfigurationOperationId] = createSignal("");

  const draftSchedules = createMemo(() => (props.operations()?.schedules || []).filter((schedule) => schedule.status === "draft"));
  const configuredDiscoveries = createMemo(() => (props.operations()?.activities || []).filter((activity) => activity.kind === "easter_egg"));

  const reset = () => {
    setEggKey(""); setMissionTitle(""); setMissionSummary(""); setBadgeName(""); setBadgeDescription(""); setBadgeIcon("");
    setBadgeRarity("rare"); setEvidenceChannel("wts_qr"); setDeploymentNote(""); setActiveFrom(""); setActiveUntil("");
    setMaxClaims("100"); setScoreScheduleId(""); setSortOrder("0"); setReason(""); setConfigurationOperationId("");
  };

  const save = async (event: Event) => {
    event.preventDefault();
    if (busy()) return;
    setBusy(true);
    setMessage(undefined);
    const stableOperationId = configurationOperationId() || operationId();
    setConfigurationOperationId(stableOperationId);
    try {
      const result = await adminSaveEasterEggMissionDraft({
        eggKey: eggKey(),
        missionTitle: missionTitle(),
        missionSummary: missionSummary(),
        badgeName: badgeName(),
        badgeDescription: badgeDescription(),
        badgeIcon: badgeIcon() || undefined,
        badgeRarity: badgeRarity(),
        evidenceChannel: evidenceChannel(),
        deploymentNote: deploymentNote(),
        activeFrom: scheduleLocalDateTimeToInstant(activeFrom()),
        activeUntil: scheduleLocalDateTimeToInstant(activeUntil()),
        maxClaims: Number(maxClaims()),
        scoreScheduleId: scoreScheduleId(),
        sortOrder: Number(sortOrder()),
        reason: reason() || undefined,
        operationId: stableOperationId,
      });
      if (!result.success) throw new Error(result.error || "Could not save the Easter Egg Mission.");
      await props.onChanged();
      reset();
      setMessage({ kind: "success", text: "Hidden Easter Egg drafts saved with fixed 10/0 scoring. Activate the Badge, Mission, discovery Activity, and schedule before generating a static-puzzle code." });
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "Could not save the Easter Egg Mission." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="space-y-8">
      <Show when={message()}>{(notice) => <div class={`alert ${notice().kind === "error" ? "alert-error" : "alert-success"}`} role="status">{notice().text}</div>}</Show>
      <form class={adminFormPanelClass} onSubmit={save}>
        <AdminFormSection title="Hidden Easter Egg Mission" description="Creates one hidden Badge, one hidden Mission, and one static discovery Activity. Public surfaces receive no locked teaser, deployment note, code, or discovery location.">
          <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <AdminFormField id="easter-egg-key" label="Immutable egg key" hint="Use a neutral organizer key, not a location, answer, or code." required><input id="easter-egg-key" name="eggKey" class={adminInputClass("font-mono")} pattern="[a-z0-9]+(?:-[a-z0-9]+)*" required value={eggKey()} onInput={(event) => setEggKey(event.currentTarget.value)} /></AdminFormField>
            <AdminFormField id="easter-egg-mission-title" label="Post-unlock Mission title" required><input id="easter-egg-mission-title" name="missionTitle" class={adminInputClass()} required value={missionTitle()} onInput={(event) => setMissionTitle(event.currentTarget.value)} /></AdminFormField>
            <AdminFormField id="easter-egg-sort" label="Mission sort order" required><input id="easter-egg-sort" name="sortOrder" type="number" class={adminInputClass("font-mono")} required value={sortOrder()} onInput={(event) => setSortOrder(event.currentTarget.value)} /></AdminFormField>
            <AdminFormField id="easter-egg-mission-summary" label="Post-unlock Mission summary" hint="Spoiler-safe copy for the owning User after discovery." required class="md:col-span-2 xl:col-span-3"><textarea id="easter-egg-mission-summary" name="missionSummary" class={adminTextareaClass("min-h-20")} required value={missionSummary()} onInput={(event) => setMissionSummary(event.currentTarget.value)} /></AdminFormField>
            <AdminFormField id="easter-egg-from" label="Active from" required><input id="easter-egg-from" name="activeFrom" type="datetime-local" class={adminInputClass("font-mono")} required value={activeFrom()} onInput={(event) => setActiveFrom(event.currentTarget.value)} /></AdminFormField>
            <AdminFormField id="easter-egg-until" label="Active until" required><input id="easter-egg-until" name="activeUntil" type="datetime-local" class={adminInputClass("font-mono")} required value={activeUntil()} onInput={(event) => setActiveUntil(event.currentTarget.value)} /></AdminFormField>
            <AdminFormField id="easter-egg-max-claims" label="Global claim limit" required><input id="easter-egg-max-claims" name="maxClaims" type="number" min="1" class={adminInputClass("font-mono")} required value={maxClaims()} onInput={(event) => setMaxClaims(event.currentTarget.value)} /></AdminFormField>
          </div>
        </AdminFormSection>

        <AdminFormSection title="Spoiler-safe Badge presentation" description="Shown to the owning User only after unlock. Existing global and per-Badge public visibility controls still apply." class="mt-6">
          <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <AdminFormField id="easter-egg-badge-name" label="Badge name" required><input id="easter-egg-badge-name" name="badgeName" class={adminInputClass()} required value={badgeName()} onInput={(event) => setBadgeName(event.currentTarget.value)} /></AdminFormField>
            <AdminFormField id="easter-egg-badge-icon" label="Badge icon"><input id="easter-egg-badge-icon" name="badgeIcon" class={adminInputClass("font-mono")} value={badgeIcon()} onInput={(event) => setBadgeIcon(event.currentTarget.value)} /></AdminFormField>
            <AdminFormField id="easter-egg-badge-rarity" label="Badge rarity" required><select id="easter-egg-badge-rarity" name="badgeRarity" class={adminSelectClass()} value={badgeRarity()} onChange={(event) => setBadgeRarity(event.currentTarget.value as BadgeRarity)}><For each={["common", "uncommon", "rare", "epic", "legendary"] as const}>{(rarity) => <option value={rarity}>{rarity}</option>}</For></select></AdminFormField>
            <AdminFormField id="easter-egg-badge-description" label="Badge description" hint="Do not reveal the code or discovery location." required class="md:col-span-2 xl:col-span-3"><textarea id="easter-egg-badge-description" name="badgeDescription" class={adminTextareaClass("min-h-20")} required value={badgeDescription()} onInput={(event) => setBadgeDescription(event.currentTarget.value)} /></AdminFormField>
          </div>
        </AdminFormSection>

        <AdminFormSection title="Safe static discovery" description="Only a WTS-controlled static QR, redemption fragment link, or manually entered Mission code is evidence. This does not configure puzzle answers, scanners, telemetry, or external validation." class="mt-6">
          <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <fieldset class="md:col-span-2 xl:col-span-3"><legend class="mb-2 text-sm font-bold text-white">Discovery surface</legend><div class="flex flex-wrap gap-4"><For each={[{ value: "wts_qr" as const, label: "WTS static QR" }, { value: "wts_link" as const, label: "WTS fragment link" }, { value: "wts_manual_code" as const, label: "Manually entered code" }]}>{(option) => <label class="flex min-h-12 items-center gap-2 text-sm font-mono"><input name="evidenceChannel" type="radio" class="radio radio-sm" value={option.value} checked={evidenceChannel() === option.value} onChange={() => setEvidenceChannel(option.value)} /> {option.label}</label>}</For></div></fieldset>
            <AdminFormField id="easter-egg-deployment-note" label="Private safe-surface deployment note" hint="Admin-only operational note. Describe why the surface is WTS-controlled and safe; do not include the code." required class="md:col-span-2 xl:col-span-3"><textarea id="easter-egg-deployment-note" name="deploymentNote" maxlength="500" class={adminTextareaClass("min-h-20")} required value={deploymentNote()} onInput={(event) => setDeploymentNote(event.currentTarget.value)} /></AdminFormField>
          </div>
        </AdminFormSection>

        <AdminFormSection title="Fixed score and caps" description="Each discovery is fixed at 10 total XP and 0 Leaderboard XP. Active policies dynamically sum into the easter-egg category and conference total-XP ceilings; they never create day, partner, or rank capacity." class="mt-6">
          <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <AdminFormField id="easter-egg-schedule" label="Draft score schedule" required><select id="easter-egg-schedule" name="scoreScheduleId" class={adminSelectClass()} required value={scoreScheduleId()} onChange={(event) => setScoreScheduleId(event.currentTarget.value)}><option value="" disabled>Choose draft schedule</option><For each={draftSchedules()}>{(schedule) => <option value={schedule.id}>{schedule.key}</option>}</For></select></AdminFormField>
            <AdminFormField id="easter-egg-cap-membership" label="Required cap membership" hint="Fixed by the server and not editable."><input id="easter-egg-cap-membership" class={adminInputClass("font-mono")} value="Activity + easter_egg category + conference" disabled /></AdminFormField>
            <AdminFormField id="easter-egg-reason" label="Configuration reason"><input id="easter-egg-reason" name="reason" class={adminInputClass()} value={reason()} onInput={(event) => setReason(event.currentTarget.value)} /></AdminFormField>
          </div>
        </AdminFormSection>
        <div class="mt-5 flex items-center justify-between gap-3"><p class="text-xs font-mono text-base-content/60">Per-User claim limit: 1 across original and replacement codes.</p><div class="flex gap-2"><button type="button" class="btn btn-ghost font-mono" onClick={reset}>Clear</button><button type="submit" class="btn btn-primary font-mono" disabled={busy()}>Save Easter Egg drafts</button></div></div>
      </form>

      <AdminDataPanel>
        <div class="border-b border-white/10 p-5"><h2 class="font-bold text-white">Configured Easter Egg discoveries</h2><p class="mt-1 text-xs font-mono text-base-content/60">Only safe keys and lifecycle state are shown here. Codes and private deployment notes are not public catalog data.</p></div>
        <ul class="divide-y divide-white/10" role="list"><For each={configuredDiscoveries()}>{(activity) => <li class="p-5"><div class="flex flex-wrap items-center justify-between gap-3"><div><p class="font-bold text-white">{activity.key}</p><p class="mt-1 text-xs font-mono text-base-content/60">{activity.evidenceChannel} / 10 total XP / 0 Leaderboard XP / claims {activity.acceptedClaims}</p></div><span class={`badge badge-sm font-mono ${activity.status === "active" && activity.enabled ? "badge-success" : "badge-ghost"}`}>{activity.status}</span></div></li>}</For><Show when={configuredDiscoveries().length === 0}><li class="p-5 text-sm font-mono text-base-content/60">No Easter Egg discoveries configured.</li></Show></ul>
      </AdminDataPanel>
    </div>
  );
}
