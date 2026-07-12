import { createMemo, createResource, createSignal, For, Show } from "solid-js";
import { Icon } from "@iconify-icon/solid";
import {
  AdminDataPanel,
  AdminFormField,
  AdminFormSection,
  AdminPageShell,
  adminFormPanelClass,
  adminInputClass,
  adminSelectClass,
  adminTextareaClass,
  useAdminToast,
} from "~/components/admin/AdminPageShell";
import {
  adminActivateGamificationDefinition,
  adminActivateGamificationScoreSchedule,
  adminCreateGamificationScoreScheduleDraft,
  adminFetchGamificationOperations,
  adminGenerateGamificationCodes,
  adminInvalidateGamificationCode,
  adminLookupGamificationCodes,
  adminReissueGamificationCode,
  adminRetireGamificationDefinition,
  adminSaveGamificationAchievementDraft,
  adminSaveGamificationActivityDraft,
  adminSaveGamificationMissionDraft,
} from "~/lib/gamification-operations-actions";
import AdminGamificationSupport from "~/components/admin/gamification/AdminGamificationSupport";
import AdminHiEventsReconciliation from "~/components/admin/gamification/AdminHiEventsReconciliation";
import AdminSessionAttendanceMissions from "~/components/admin/gamification/AdminSessionAttendanceMissions";
import AdminConfiguredEventMissions from "~/components/admin/gamification/AdminConfiguredEventMissions";
import AdminCommunityPartnerMissions from "~/components/admin/gamification/AdminCommunityPartnerMissions";
import AdminEasterEggMissions from "~/components/admin/gamification/AdminEasterEggMissions";
import type {
  AdminActivityDto,
  AdminCodeBatchResult,
  AdminCodeDto,
  AdminGamificationOperationsDto,
  AdminScorePolicyDto,
  GamificationDefinitionKind,
} from "~/lib/gamification-operations";

const CATEGORIES = ["onboarding", "ticketing", "attendance", "session", "partner", "booth", "workshop", "satellite_event", "warmup_event", "community", "social", "meta", "admin_manual"];
const ACTIVITY_KINDS = ["booth", "community_partner", "hievents", "admin_manual", "meta"];
const EVIDENCE_MODES = ["single_code", "two_code_start", "two_code_finish", "hievents_ticket", "hievents_checkin", "admin_manual", "meta_rule"];
const RARITIES = ["common", "uncommon", "rare", "epic", "legendary"];
const DEDICATED_EVENT_KINDS = new Set(["workshop", "warmup", "satellite", "social"]);
type AdminGamificationTab = "catalog" | "events" | "community" | "eggs" | "sessions" | "codes" | "schedule" | "hievents" | "support";

function usesDedicatedConfiguration(kind: GamificationDefinitionKind, item: any): boolean {
  if (kind === "activity") return item.kind === "session" || item.kind === "community_partner" || item.kind === "easter_egg" || ["workshop", "warmup_event", "satellite_event", "social"].includes(item.kind);
  if (kind === "mission") return Boolean(item.sessionId || item.category === "community" || item.category === "easter_egg" || DEDICATED_EVENT_KINDS.has(item.eventRef?.kind));
  if (kind === "achievement") return item.category === "easter_egg";
  return false;
}

function operationId(): string {
  return globalThis.crypto?.randomUUID?.() || `admin-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function localDateTime(value?: string): string {
  if (!value || Number.isNaN(Date.parse(value))) return "";
  const date = new Date(value);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function asInstant(value: string): string | undefined {
  if (!value) return undefined;
  const instant = new Date(value);
  return Number.isNaN(instant.valueOf()) ? undefined : instant.toISOString();
}

function statusClass(active: boolean): string {
  return active ? "badge badge-success badge-sm font-mono" : "badge badge-ghost badge-sm font-mono";
}

function formatTime(value?: string): string {
  return value ? new Date(value).toLocaleString() : "Never";
}

function downloadCsv(csv: string): void {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "wts-mission-codes.csv";
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function AdminGamificationHub() {
  const { toast, showToast } = useAdminToast();
  const [busy, setBusy] = createSignal(false);
  const [loadError, setLoadError] = createSignal<string | null>(null);
  const [tab, setTab] = createSignal<AdminGamificationTab>("catalog");
  const [lifecycleReason, setLifecycleReason] = createSignal("");
  const [oneTimeBatch, setOneTimeBatch] = createSignal<AdminCodeBatchResult | null>(null);
  const [codeMatches, setCodeMatches] = createSignal<AdminCodeDto[] | null>(null);

  const [operations, { refetch }] = createResource(async () => {
    const result = await adminFetchGamificationOperations();
    if (!result.success) {
      setLoadError(result.error || "Could not load gamification operations.");
      return null;
    }
    setLoadError(null);
    return result.data as AdminGamificationOperationsDto;
  });

  const activeActivities = createMemo(() =>
    (operations()?.activities || []).filter((activity) => activity.status === "active" && activity.enabled),
  );
  const draftSchedules = createMemo(() =>
    (operations()?.schedules || []).filter((schedule) => schedule.status === "draft"),
  );

  const [achievementId, setAchievementId] = createSignal("");
  const [achievementKey, setAchievementKey] = createSignal("");
  const [achievementName, setAchievementName] = createSignal("");
  const [achievementDescription, setAchievementDescription] = createSignal("");
  const [achievementTeaser, setAchievementTeaser] = createSignal("");
  const [achievementIcon, setAchievementIcon] = createSignal("");
  const [achievementCategory, setAchievementCategory] = createSignal("attendance");
  const [achievementRarity, setAchievementRarity] = createSignal("common");
  const [achievementVisibility, setAchievementVisibility] = createSignal("public");
  const [achievementRule, setAchievementRule] = createSignal<"activity_claim" | "claim_count" | "claim_set" | "manual_only">("activity_claim");
  const [achievementRuleActivities, setAchievementRuleActivities] = createSignal("");
  const [achievementRuleCount, setAchievementRuleCount] = createSignal("1");
  const [achievementRuleDiversity, setAchievementRuleDiversity] = createSignal<"" | "session" | "booth" | "community">("");
  const [achievementFrom, setAchievementFrom] = createSignal("");
  const [achievementUntil, setAchievementUntil] = createSignal("");
  const [achievementOrder, setAchievementOrder] = createSignal("0");

  const [missionId, setMissionId] = createSignal("");
  const [missionKey, setMissionKey] = createSignal("");
  const [missionSlug, setMissionSlug] = createSignal("");
  const [missionTitle, setMissionTitle] = createSignal("");
  const [missionSummary, setMissionSummary] = createSignal("");
  const [missionCategory, setMissionCategory] = createSignal("attendance");
  const [missionVisibility, setMissionVisibility] = createSignal<"public" | "hidden_until_unlocked" | "admin_only">("public");
  const [missionAchievement, setMissionAchievement] = createSignal("");
  const [missionPartner, setMissionPartner] = createSignal("");
  const [missionPartnerKey, setMissionPartnerKey] = createSignal("");
  const [missionFrom, setMissionFrom] = createSignal("");
  const [missionUntil, setMissionUntil] = createSignal("");
  const [missionOrder, setMissionOrder] = createSignal("0");

  const [activityId, setActivityId] = createSignal("");
  const [activityKey, setActivityKey] = createSignal("");
  const [activityMission, setActivityMission] = createSignal("");
  const [activityKind, setActivityKind] = createSignal("booth");
  const [activityCategory, setActivityCategory] = createSignal("booth");
  const [activityOutcome, setActivityOutcome] = createSignal("visit");
  const [activityEvidence, setActivityEvidence] = createSignal("single_code");
  const [activityEvidenceChannel, setActivityEvidenceChannel] = createSignal<"wts_qr" | "wts_link" | "wts_manual_code" | "wts_static_code">("wts_qr");
  const [activityDeploymentLabel, setActivityDeploymentLabel] = createSignal("");
  const [activityAchievement, setActivityAchievement] = createSignal("");
  const [activityPartner, setActivityPartner] = createSignal("");
  const [activityPartnerKind, setActivityPartnerKind] = createSignal("sponsor");
  const [activitySession, setActivitySession] = createSignal("");
  const [activityEventKey, setActivityEventKey] = createSignal("");
  const [activityLimit, setActivityLimit] = createSignal("1");
  const [activityMaxClaims, setActivityMaxClaims] = createSignal("100");
  const [activityFrom, setActivityFrom] = createSignal("");
  const [activityUntil, setActivityUntil] = createSignal("");
  const [activityEnabled, setActivityEnabled] = createSignal(true);
  const [activityPartnerFollowUpEnabled, setActivityPartnerFollowUpEnabled] = createSignal(false);
  const [activityPartnerFollowUpNoticeVersion, setActivityPartnerFollowUpNoticeVersion] = createSignal("");
  const [policySchedule, setPolicySchedule] = createSignal("");
  const [policyKey, setPolicyKey] = createSignal("");
  const [policyTotalXp, setPolicyTotalXp] = createSignal("0");
  const [policyLeaderboardXp, setPolicyLeaderboardXp] = createSignal("0");
  const [policyRelatedCap, setPolicyRelatedCap] = createSignal("");
  const [policyScoreDay, setPolicyScoreDay] = createSignal("");

  const [scheduleKey, setScheduleKey] = createSignal("");
  const [scheduleEffectiveAt, setScheduleEffectiveAt] = createSignal("");
  const [scheduleOperationIds, setScheduleOperationIds] = createSignal<Record<string, string>>({});

  const [codeActivity, setCodeActivity] = createSignal("");
  const [codeLabel, setCodeLabel] = createSignal("");
  const [codeQuantity, setCodeQuantity] = createSignal("1");
  const [codeRole, setCodeRole] = createSignal<"single" | "start" | "finish" | "static_puzzle">("single");
  const [codeFrom, setCodeFrom] = createSignal("");
  const [codeUntil, setCodeUntil] = createSignal("");
  const [codeMaxRedemptions, setCodeMaxRedemptions] = createSignal("100");
  const [codePerUserLimit, setCodePerUserLimit] = createSignal("1");
  const [codeSearch, setCodeSearch] = createSignal("");
  const [rawCodeSearch, setRawCodeSearch] = createSignal("");
  const [codeReason, setCodeReason] = createSignal("");
  const [codeGenerationOperationId, setCodeGenerationOperationId] = createSignal("");
  const [reissueOperationIds, setReissueOperationIds] = createSignal<Record<string, string>>({});

  const withBusy = async (work: () => Promise<void>) => {
    if (busy()) return;
    setBusy(true);
    try {
      await work();
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : "Gamification administration failed.");
    } finally {
      setBusy(false);
    }
  };

  const selectTab = (next: AdminGamificationTab) => {
    if (next !== "codes") setOneTimeBatch(null);
    setTab(next);
  };

  const resetAchievement = () => {
    setAchievementId(""); setAchievementKey(""); setAchievementName(""); setAchievementDescription(""); setAchievementTeaser(""); setAchievementIcon(""); setAchievementCategory("attendance");
    setAchievementRarity("common"); setAchievementVisibility("public"); setAchievementRule("activity_claim"); setAchievementRuleActivities("");
    setAchievementRuleCount("1"); setAchievementRuleDiversity(""); setAchievementFrom(""); setAchievementUntil(""); setAchievementOrder("0");
  };
  const editAchievement = (item: AdminGamificationOperationsDto["achievements"][number]) => {
    setAchievementId(item.id); setAchievementKey(item.key); setAchievementName(item.badgeName); setAchievementDescription(item.badgeDescription); setAchievementTeaser(item.lockedTeaser || ""); setAchievementIcon(item.icon || "");
    setAchievementCategory(item.category); setAchievementRarity(item.rarity); setAchievementVisibility(item.visibility === "retired" ? "public" : item.visibility);
    setAchievementRule(item.unlockRule.kind); setAchievementRuleActivities((item.unlockRule.activityKeys || []).join(", "));
    setAchievementRuleCount(String(item.unlockRule.count || 1)); setAchievementRuleDiversity(item.unlockRule.sourceDiversity || ""); setAchievementFrom(localDateTime(item.activeFrom)); setAchievementUntil(localDateTime(item.activeUntil)); setAchievementOrder(String(item.sortOrder));
  };
  const saveAchievement = (event: Event) => withBusy(async () => {
    event.preventDefault();
    const result = await adminSaveGamificationAchievementDraft({
      id: achievementId() || undefined,
      key: achievementKey(), badgeName: achievementName(), badgeDescription: achievementDescription(), lockedTeaser: achievementTeaser() || undefined, icon: achievementIcon() || undefined, category: achievementCategory() as any,
      rarity: achievementRarity() as any, visibility: achievementVisibility() as any,
      unlockRule: { kind: achievementRule(), activityKeys: achievementRuleActivities().split(",").map((key) => key.trim()).filter(Boolean), count: Number(achievementRuleCount()), sourceDiversity: achievementRuleDiversity() || undefined },
      activeFrom: asInstant(achievementFrom()), activeUntil: asInstant(achievementUntil()), sortOrder: Number(achievementOrder()), operationId: operationId(),
    });
    if (!result.success) throw new Error(result.error || "Could not save Achievement draft.");
    resetAchievement(); await refetch(); showToast("success", "Achievement saved as draft.");
  });

  const resetMission = () => {
    setMissionId(""); setMissionKey(""); setMissionSlug(""); setMissionTitle(""); setMissionSummary(""); setMissionCategory("attendance");
    setMissionVisibility("public"); setMissionAchievement(""); setMissionPartner(""); setMissionPartnerKey(""); setMissionFrom(""); setMissionUntil(""); setMissionOrder("0");
  };
  const editMission = (item: AdminGamificationOperationsDto["missions"][number]) => {
    setMissionId(item.id); setMissionKey(item.key); setMissionSlug(item.slug); setMissionTitle(item.title); setMissionSummary(item.summary);
    setMissionCategory(item.category); setMissionVisibility(item.visibility); setMissionAchievement(item.primaryAchievementId || ""); setMissionPartner(item.partnerId || ""); setMissionPartnerKey(item.partnerKey || "");
    setMissionFrom(localDateTime(item.startsAt)); setMissionUntil(localDateTime(item.endsAt)); setMissionOrder(String(item.sortOrder));
  };
  const saveMission = (event: Event) => withBusy(async () => {
    event.preventDefault();
    const result = await adminSaveGamificationMissionDraft({
      id: missionId() || undefined, key: missionKey(), slug: missionSlug(), title: missionTitle(), summary: missionSummary(),
      category: missionCategory() as any, visibility: missionVisibility(), primaryAchievementId: missionAchievement() || undefined, partnerId: missionPartner() || undefined, partnerKey: missionPartnerKey() || undefined,
      startsAt: asInstant(missionFrom()), endsAt: asInstant(missionUntil()), suggested: false, sortOrder: Number(missionOrder()), operationId: operationId(),
    });
    if (!result.success) throw new Error(result.error || "Could not save Mission draft.");
    resetMission(); await refetch(); showToast("success", "Mission saved as draft.");
  });

  const resetActivity = () => {
    setActivityId(""); setActivityKey(""); setActivityMission(""); setActivityKind("booth"); setActivityCategory("booth"); setActivityOutcome("visit");
    setActivityEvidence("single_code"); setActivityEvidenceChannel("wts_qr"); setActivityDeploymentLabel(""); setActivityAchievement(""); setActivityPartner(""); setActivityPartnerKind("sponsor"); setActivitySession("");
    setActivityEventKey(""); setActivityLimit("1"); setActivityMaxClaims("100"); setActivityFrom(""); setActivityUntil(""); setActivityEnabled(true); setActivityPartnerFollowUpEnabled(false); setActivityPartnerFollowUpNoticeVersion("");
    setPolicySchedule(""); setPolicyKey(""); setPolicyTotalXp("0"); setPolicyLeaderboardXp("0"); setPolicyRelatedCap(""); setPolicyScoreDay("");
  };
  const editActivity = (item: AdminActivityDto) => {
    const policy = item.scorePolicies.find((candidate) => draftSchedules().some((schedule) => schedule.id === candidate.scheduleId)) || item.scorePolicies[0];
    setActivityId(item.id); setActivityKey(item.key); setActivityMission(item.missionId || ""); setActivityKind(item.kind); setActivityCategory(item.category);
    setActivityOutcome(item.outcomeKey); setActivityEvidence(item.evidenceMode); setActivityEvidenceChannel(item.evidenceChannel || "wts_qr"); setActivityDeploymentLabel(item.deploymentLabel || ""); setActivityAchievement(item.achievementId || ""); setActivityPartner(item.partnerId || "");
    setActivityPartnerKind(item.partnerKind || "sponsor"); setActivitySession(item.sessionId || ""); setActivityEventKey(item.eventRef?.eventKey || item.eventRef?.eventId || "");
    setActivityLimit(String(item.perUserClaimLimit)); setActivityMaxClaims(String(item.maxClaims || "")); setActivityFrom(localDateTime(item.activeFrom)); setActivityUntil(localDateTime(item.activeUntil)); setActivityEnabled(item.enabled); setActivityPartnerFollowUpEnabled(Boolean(item.partnerFollowUp?.enabled)); setActivityPartnerFollowUpNoticeVersion(item.partnerFollowUp?.noticeVersion || "");
    setPolicySchedule(policy?.scheduleId || ""); setPolicyKey(policy?.policyKey || item.key); setPolicyTotalXp(String(policy?.totalXp || 0)); setPolicyLeaderboardXp(String(policy?.leaderboardXp || 0));
    setPolicyRelatedCap(policy?.capMembership.find((membership) => membership.dimension === "related_group")?.key || ""); setPolicyScoreDay(policy?.scoreDay || "");
  };
  const saveActivity = (event: Event) => withBusy(async () => {
    event.preventDefault();
    const id = activityId();
    const booth = activityKind() === "booth";
    const boothGroupKey = booth ? operations()?.missions.find((mission) => mission.id === activityMission())?.key : undefined;
    const memberships = id ? [
      { dimension: "activity" as const, key: id },
      ...((booth && boothGroupKey) ? [{ dimension: "related_group" as const, key: boothGroupKey }] : policyRelatedCap() ? [{ dimension: "related_group" as const, key: policyRelatedCap() }] : []),
      ...(activityPartner() ? [{ dimension: "partner" as const, key: activityPartner() }] : []),
      ...(booth && policyScoreDay() ? [
        { dimension: "category" as const, key: "booth" },
        { dimension: "conference_day" as const, key: policyScoreDay() },
        { dimension: "conference" as const, key: "conference" },
      ] : []),
    ] : [];
    const result = await adminSaveGamificationActivityDraft({
      id: id || undefined, key: activityKey(), missionId: activityMission() || undefined, kind: activityKind() as any, category: activityCategory() as any,
      outcomeKey: activityOutcome(), evidenceMode: activityEvidence() as any, evidenceChannel: booth ? activityEvidenceChannel() : undefined, deploymentLabel: booth ? activityDeploymentLabel() || undefined : undefined, achievementId: activityAchievement() || undefined, partnerId: activityPartner() || undefined,
      partnerKind: activityPartner() ? activityPartnerKind() as any : undefined, sessionId: activitySession() || undefined,
      eventRef: activityEventKey() ? { eventKey: activityEventKey(), kind: activityKind() } : undefined,
      perUserClaimLimit: Number(activityLimit()), maxClaims: Number(activityMaxClaims()), activeFrom: asInstant(activityFrom()), activeUntil: asInstant(activityUntil()), enabled: activityEnabled(), partnerFollowUp: booth ? { enabled: activityPartnerFollowUpEnabled(), noticeVersion: activityPartnerFollowUpNoticeVersion() || undefined } : undefined,
      scorePolicy: policySchedule() && id ? { scheduleId: policySchedule(), policyKey: policyKey() || activityKey(), enabled: true, totalXp: Number(policyTotalXp()), leaderboardXp: Number(policyLeaderboardXp()), capMembership: memberships, scoreDay: policyScoreDay() || undefined } : undefined,
      operationId: operationId(),
    });
    if (!result.success) throw new Error(result.error || "Could not save Activity draft.");
    resetActivity(); await refetch(); showToast("success", id ? "Activity draft updated." : "Activity draft saved. Edit it again to attach a draft score policy.");
  });

  const createSchedule = (event: Event) => withBusy(async () => {
    event.preventDefault();
    const result = await adminCreateGamificationScoreScheduleDraft({ key: scheduleKey(), effectiveAt: asInstant(scheduleEffectiveAt()) || "", operationId: operationId() });
    if (!result.success) throw new Error(result.error || "Could not create score schedule.");
    setScheduleKey(""); setScheduleEffectiveAt(""); await refetch(); showToast("success", "Score schedule draft created.");
  });

  const lifecycle = (kind: GamificationDefinitionKind, id: string, action: "activate" | "retire") => withBusy(async () => {
    const reason = lifecycleReason().trim();
    if (!reason) throw new Error("Enter a lifecycle reason before continuing.");
    if (!window.confirm(`${action === "activate" ? "Activate" : "Retire"} this ${kind}? This action is audited.`)) return;
    const input = { id, reason, confirmation: true, operationId: operationId() };
    const result = action === "activate"
      ? await adminActivateGamificationDefinition(kind, input)
      : await adminRetireGamificationDefinition(kind, input);
    if (!result.success) throw new Error(result.error || `Could not ${action} definition.`);
    await refetch(); showToast("success", `${kind} ${action}d.`);
  });

  const activateSchedule = (id: string) => withBusy(async () => {
    const reason = lifecycleReason().trim();
    if (!reason) throw new Error("Enter a schedule activation reason before continuing.");
    if (!window.confirm("Activate this versioned score schedule? The current active schedule becomes historic.")) return;
    const stableOperationId = scheduleOperationIds()[id] || operationId();
    setScheduleOperationIds((current) => ({ ...current, [id]: stableOperationId }));
    const result = await adminActivateGamificationScoreSchedule(id, { id, reason, confirmation: true, operationId: stableOperationId });
    if (!result.success) throw new Error(result.error || "Could not activate score schedule.");
    setScheduleOperationIds((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    await refetch(); showToast("success", "Score schedule activated and cap snapshot recorded.");
  });

  const generateCodes = (event: Event) => withBusy(async () => {
    event.preventDefault();
    const stableOperationId = codeGenerationOperationId() || operationId();
    setCodeGenerationOperationId(stableOperationId);
    const result = await adminGenerateGamificationCodes({
      activityId: codeActivity(), label: codeLabel(), quantity: Number(codeQuantity()), evidenceRole: codeRole(),
      startsAt: asInstant(codeFrom()) || "", endsAt: asInstant(codeUntil()) || "", maxRedemptions: Number(codeMaxRedemptions()), perUserLimit: Number(codePerUserLimit()), operationId: stableOperationId,
    });
    if (!result.success) throw new Error(result.error || "Could not generate codes.");
    setOneTimeBatch(result.data as AdminCodeBatchResult); await refetch();
    setCodeGenerationOperationId("");
    showToast("success", "Code batch committed. Export the secrets before leaving this response.");
  });

  const lookupCodes = (event: Event) => withBusy(async () => {
    event.preventDefault();
    const result = await adminLookupGamificationCodes({ query: codeSearch(), rawCode: rawCodeSearch() });
    if (!result.success) throw new Error(result.error || "Could not search codes.");
    setCodeMatches(result.data as AdminCodeDto[]);
    setRawCodeSearch("");
  });

  const invalidateCode = (code: AdminCodeDto) => withBusy(async () => {
    if (!codeReason().trim()) throw new Error("Enter an invalidation or reissue reason first.");
    if (!window.confirm(`Invalidate ${code.label} / ${code.lookupPrefix}? Existing redemption history remains.`)) return;
    const result = await adminInvalidateGamificationCode({ codeId: code.id, reason: codeReason(), confirmation: true, operationId: operationId() });
    if (!result.success) throw new Error(result.error || "Could not invalidate code.");
    await refetch(); showToast("success", "Code invalidated. Existing history was preserved.");
  });

  const reissueCode = (code: AdminCodeDto) => withBusy(async () => {
    if (!codeReason().trim()) throw new Error("Enter an invalidation or reissue reason first.");
    if (!window.confirm(`Reissue a replacement for ${code.label} / ${code.lookupPrefix}? The replacement keeps the same Activity limit.`)) return;
    const stableOperationId = reissueOperationIds()[code.id] || operationId();
    setReissueOperationIds((current) => ({ ...current, [code.id]: stableOperationId }));
    const result = await adminReissueGamificationCode({ codeId: code.id, reason: codeReason(), confirmation: true, operationId: stableOperationId });
    if (!result.success) throw new Error(result.error || "Could not reissue code.");
    setOneTimeBatch(result.data as AdminCodeBatchResult); await refetch(); showToast("success", "Replacement code committed. Export it now.");
    setReissueOperationIds((current) => {
      const next = { ...current };
      delete next[code.id];
      return next;
    });
  });

  return (
    <AdminPageShell
      layoutTitle="Admin: Gamification"
      layoutDescription="Configure September gamification, Mission codes, and single-User support"
      title="Gamification"
      subtitle="Audited September configuration, code, and single-User support operations"
      hint="Definitions are drafted first. Used accounting definitions are retired and replaced, never deleted. Support actions retain authoritative history and rebuild only the selected User's cache."
      count={operations()?.activities.length}
      countLoading={operations.loading}
      toast={toast()}
      headerActions={<a href="/missions/redeem" class="btn btn-outline btn-secondary font-mono" target="_blank">Mission redemption</a>}
    >
      <Show when={loadError()}><div class="alert alert-error mb-6 font-mono" role="alert">{loadError()}</div></Show>

       <nav class="mb-6 flex flex-wrap gap-2" aria-label="Gamification operations">
          <button type="button" class={`btn btn-sm font-mono ${tab() === "catalog" ? "btn-primary" : "btn-ghost"}`} aria-pressed={tab() === "catalog"} onClick={() => selectTab("catalog")}>Catalog</button>
            <button type="button" class={`btn btn-sm font-mono ${tab() === "schedule" ? "btn-primary" : "btn-ghost"}`} aria-pressed={tab() === "schedule"} onClick={() => selectTab("schedule")}>Score schedules</button>
            <button type="button" class={`btn btn-sm font-mono ${tab() === "sessions" ? "btn-primary" : "btn-ghost"}`} aria-pressed={tab() === "sessions"} onClick={() => selectTab("sessions")}>Session Missions</button>
            <button type="button" class={`btn btn-sm font-mono ${tab() === "events" ? "btn-primary" : "btn-ghost"}`} aria-pressed={tab() === "events"} onClick={() => selectTab("events")}>Event Missions</button>
             <button type="button" class={`btn btn-sm font-mono ${tab() === "community" ? "btn-primary" : "btn-ghost"}`} aria-pressed={tab() === "community"} onClick={() => selectTab("community")}>Community Partners</button>
            <button type="button" class={`btn btn-sm font-mono ${tab() === "eggs" ? "btn-primary" : "btn-ghost"}`} aria-pressed={tab() === "eggs"} onClick={() => selectTab("eggs")}>Easter Eggs</button>
           <button type="button" class={`btn btn-sm font-mono ${tab() === "codes" ? "btn-primary" : "btn-ghost"}`} aria-pressed={tab() === "codes"} onClick={() => selectTab("codes")}>Mission codes</button>
           <button type="button" class={`btn btn-sm font-mono ${tab() === "hievents" ? "btn-primary" : "btn-ghost"}`} aria-pressed={tab() === "hievents"} onClick={() => selectTab("hievents")}>Hi.Events sync</button>
           <button type="button" class={`btn btn-sm font-mono ${tab() === "support" ? "btn-primary" : "btn-ghost"}`} aria-pressed={tab() === "support"} onClick={() => selectTab("support")}>User support</button>
       </nav>

      <Show when={tab() === "catalog"}>
        <div class="mb-6 grid gap-4 lg:grid-cols-3">
          <AdminDataPanel><div class="p-5"><p class="text-xs font-mono text-base-content/60">PROFILE CACHE</p><p class="mt-1 text-xl font-bold text-white">{operations()?.profileCache.state || "Loading"}</p><p class="mt-1 text-xs font-mono text-base-content/55">{operations()?.profileCache.profiles || 0} profiles / last rebuild {formatTime(operations()?.profileCache.lastRecalculatedAt)}</p></div></AdminDataPanel>
          <AdminDataPanel><div class="p-5"><p class="text-xs font-mono text-base-content/60">ACTIVE ACTIVITIES</p><p class="mt-1 text-xl font-bold text-white">{activeActivities().length}</p><p class="mt-1 text-xs font-mono text-base-content/55">Only active enabled Activities accept new evidence.</p></div></AdminDataPanel>
          <AdminDataPanel><div class="p-5"><p class="text-xs font-mono text-base-content/60">LIFECYCLE CONFIRMATION</p><input class={adminInputClass("mt-2 text-sm")} value={lifecycleReason()} onInput={(event) => setLifecycleReason(event.currentTarget.value)} placeholder="Reason for activation or retirement" /></div></AdminDataPanel>
        </div>

        <div class="grid gap-8 xl:grid-cols-2">
          <form class={adminFormPanelClass} onSubmit={saveAchievement}>
            <AdminFormSection title={achievementId() ? "Edit Achievement draft" : "New Achievement draft"} description="Achievements own Badge presentation and unlock rules. Active definitions require an active window and valid rule dependencies.">
              <div class="grid gap-4 md:grid-cols-2">
                <AdminFormField id="gam-achievement-key" label="Key" required><input id="gam-achievement-key" class={adminInputClass("font-mono")} required disabled={Boolean(achievementId())} value={achievementKey()} onInput={(event) => setAchievementKey(event.currentTarget.value)} /></AdminFormField>
                <AdminFormField id="gam-achievement-name" label="Badge name" required><input id="gam-achievement-name" class={adminInputClass()} required value={achievementName()} onInput={(event) => setAchievementName(event.currentTarget.value)} /></AdminFormField>
                <AdminFormField id="gam-achievement-description" label="Badge description" required class="md:col-span-2"><textarea id="gam-achievement-description" class={adminTextareaClass("min-h-20")} required value={achievementDescription()} onInput={(event) => setAchievementDescription(event.currentTarget.value)} /></AdminFormField>
                <AdminFormField id="gam-achievement-teaser" label="Locked teaser"><input id="gam-achievement-teaser" class={adminInputClass()} value={achievementTeaser()} onInput={(event) => setAchievementTeaser(event.currentTarget.value)} /></AdminFormField>
                <AdminFormField id="gam-achievement-icon" label="Icon reference"><input id="gam-achievement-icon" class={adminInputClass("font-mono")} value={achievementIcon()} onInput={(event) => setAchievementIcon(event.currentTarget.value)} /></AdminFormField>
                <AdminFormField id="gam-achievement-category" label="Category" required><select id="gam-achievement-category" class={adminSelectClass()} value={achievementCategory()} onChange={(event) => setAchievementCategory(event.currentTarget.value)}><For each={CATEGORIES}>{(category) => <option value={category}>{category}</option>}</For></select></AdminFormField>
                <AdminFormField id="gam-achievement-rarity" label="Rarity" required><select id="gam-achievement-rarity" class={adminSelectClass()} value={achievementRarity()} onChange={(event) => setAchievementRarity(event.currentTarget.value)}><For each={RARITIES}>{(rarity) => <option value={rarity}>{rarity}</option>}</For></select></AdminFormField>
                <AdminFormField id="gam-achievement-visibility" label="Badge visibility"><select id="gam-achievement-visibility" class={adminSelectClass()} value={achievementVisibility()} onChange={(event) => setAchievementVisibility(event.currentTarget.value)}><option value="public">Public</option><option value="locked_teaser">Locked teaser</option><option value="hidden_until_unlocked">Hidden until unlocked</option></select></AdminFormField>
                <AdminFormField id="gam-achievement-rule" label="Unlock rule" required><select id="gam-achievement-rule" class={adminSelectClass()} value={achievementRule()} onChange={(event) => setAchievementRule(event.currentTarget.value as "activity_claim" | "claim_count" | "claim_set" | "manual_only")}><option value="activity_claim">Direct Activity claim</option><option value="claim_set">Claim set</option><option value="claim_count">Claim count</option><option value="manual_only">Manual only</option></select></AdminFormField>
                <AdminFormField id="gam-achievement-rule-activities" label="Activity keys" hint="Comma-separated. Meta claim counts must use selected sources; claim sets need at least two active Activities."><input id="gam-achievement-rule-activities" class={adminInputClass("font-mono")} value={achievementRuleActivities()} onInput={(event) => setAchievementRuleActivities(event.currentTarget.value)} /></AdminFormField>
                <AdminFormField id="gam-achievement-count" label="Claim count"><input id="gam-achievement-count" type="number" min="1" class={adminInputClass("font-mono")} value={achievementRuleCount()} onInput={(event) => setAchievementRuleCount(event.currentTarget.value)} /></AdminFormField>
                <AdminFormField id="gam-achievement-diversity" label="Meta source diversity" hint="Optional. One qualifying Activity per Session, sponsor booth, or Community Partner programme."><select id="gam-achievement-diversity" class={adminSelectClass()} value={achievementRuleDiversity()} onChange={(event) => setAchievementRuleDiversity(event.currentTarget.value as "" | "session" | "booth" | "community")}><option value="">No diversity selector</option><option value="session">Cross-Session</option><option value="booth">Cross-booth</option><option value="community">Cross-community</option></select></AdminFormField>
                <AdminFormField id="gam-achievement-from" label="Active from" required><input id="gam-achievement-from" type="datetime-local" class={adminInputClass("font-mono")} required value={achievementFrom()} onInput={(event) => setAchievementFrom(event.currentTarget.value)} /></AdminFormField>
                <AdminFormField id="gam-achievement-until" label="Active until" required><input id="gam-achievement-until" type="datetime-local" class={adminInputClass("font-mono")} required value={achievementUntil()} onInput={(event) => setAchievementUntil(event.currentTarget.value)} /></AdminFormField>
              </div>
            </AdminFormSection>
            <div class="mt-5 flex justify-end gap-2"><button type="button" class="btn btn-ghost font-mono" onClick={resetAchievement}>Clear</button><button type="submit" class="btn btn-primary font-mono" disabled={busy()}>Save draft</button></div>
          </form>

          <form class={adminFormPanelClass} onSubmit={saveMission}>
            <AdminFormSection title={missionId() ? "Edit Mission draft" : "New Mission draft"} description="Missions are user-facing groupings. Activities own evidence, limits, caps, and score policies.">
              <div class="grid gap-4 md:grid-cols-2">
                <AdminFormField id="gam-mission-key" label="Key" required><input id="gam-mission-key" class={adminInputClass("font-mono")} required disabled={Boolean(missionId())} value={missionKey()} onInput={(event) => setMissionKey(event.currentTarget.value)} /></AdminFormField>
                <AdminFormField id="gam-mission-slug" label="Slug" required><input id="gam-mission-slug" class={adminInputClass("font-mono")} required disabled={Boolean(missionId())} value={missionSlug()} onInput={(event) => setMissionSlug(event.currentTarget.value)} /></AdminFormField>
                 <AdminFormField id="gam-mission-title" label="Title" required><input id="gam-mission-title" class={adminInputClass()} required value={missionTitle()} onInput={(event) => setMissionTitle(event.currentTarget.value)} /></AdminFormField>
                 <AdminFormField id="gam-mission-achievement" label="Primary Achievement"><select id="gam-mission-achievement" class={adminSelectClass()} value={missionAchievement()} onChange={(event) => setMissionAchievement(event.currentTarget.value)}><option value="">None</option><For each={operations()?.achievements || []}>{(achievement) => <option value={achievement.id}>{achievement.key}</option>}</For></select></AdminFormField>
                 <AdminFormField id="gam-mission-partner" label="Partner attribution"><select id="gam-mission-partner" class={adminSelectClass()} value={missionPartner()} onChange={(event) => setMissionPartner(event.currentTarget.value)}><option value="">No partner</option><For each={operations()?.references.partners || []}>{(partner) => <option value={partner.id}>{partner.name}{partner.type === "sponsor" ? "" : ` (${partner.type})`}</option>}</For></select></AdminFormField>
                 <AdminFormField id="gam-mission-partner-key" label="Immutable sponsor key" hint="For booth Missions: the partnerKey in booth.{partnerKey}.{activityKey}."><input id="gam-mission-partner-key" class={adminInputClass("font-mono")} value={missionPartnerKey()} onInput={(event) => setMissionPartnerKey(event.currentTarget.value)} /></AdminFormField>
                <AdminFormField id="gam-mission-summary" label="Summary" required class="md:col-span-2"><textarea id="gam-mission-summary" class={adminTextareaClass("min-h-20")} required value={missionSummary()} onInput={(event) => setMissionSummary(event.currentTarget.value)} /></AdminFormField>
                <AdminFormField id="gam-mission-category" label="Category"><select id="gam-mission-category" class={adminSelectClass()} value={missionCategory()} onChange={(event) => setMissionCategory(event.currentTarget.value)}><For each={CATEGORIES}>{(category) => <option value={category}>{category}</option>}</For></select></AdminFormField>
                <AdminFormField id="gam-mission-visibility" label="Visibility"><select id="gam-mission-visibility" class={adminSelectClass()} value={missionVisibility()} onChange={(event) => setMissionVisibility(event.currentTarget.value as "public" | "hidden_until_unlocked" | "admin_only")}><option value="public">Public</option><option value="hidden_until_unlocked">Hidden until unlocked</option><option value="admin_only">Admin only</option></select></AdminFormField>
                <AdminFormField id="gam-mission-from" label="Active from" required><input id="gam-mission-from" type="datetime-local" class={adminInputClass("font-mono")} required value={missionFrom()} onInput={(event) => setMissionFrom(event.currentTarget.value)} /></AdminFormField>
                <AdminFormField id="gam-mission-until" label="Active until" required><input id="gam-mission-until" type="datetime-local" class={adminInputClass("font-mono")} required value={missionUntil()} onInput={(event) => setMissionUntil(event.currentTarget.value)} /></AdminFormField>
              </div>
            </AdminFormSection>
            <div class="mt-5 flex justify-end gap-2"><button type="button" class="btn btn-ghost font-mono" onClick={resetMission}>Clear</button><button type="submit" class="btn btn-primary font-mono" disabled={busy()}>Save draft</button></div>
          </form>
        </div>

        <form class={`${adminFormPanelClass} mt-8`} onSubmit={saveActivity}>
          <AdminFormSection title={activityId() ? "Edit Activity draft" : "New Activity draft"} description="Activity-owned direct scoring is attached to a draft score schedule after the Activity has an ID. Activate only after dependencies, limits, source references, and score policy validate.">
            <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <AdminFormField id="gam-activity-key" label="Key" required><input id="gam-activity-key" class={adminInputClass("font-mono")} required disabled={Boolean(activityId())} value={activityKey()} onInput={(event) => setActivityKey(event.currentTarget.value)} /></AdminFormField>
              <AdminFormField id="gam-activity-mission" label="Mission"><select id="gam-activity-mission" class={adminSelectClass()} value={activityMission()} onChange={(event) => setActivityMission(event.currentTarget.value)}><option value="">No Mission</option><For each={operations()?.missions || []}>{(mission) => <option value={mission.id}>{mission.key}</option>}</For></select></AdminFormField>
              <AdminFormField id="gam-activity-kind" label="Kind" required><select id="gam-activity-kind" class={adminSelectClass()} value={activityKind()} onChange={(event) => setActivityKind(event.currentTarget.value)}><For each={ACTIVITY_KINDS}>{(kind) => <option value={kind}>{kind}</option>}</For></select></AdminFormField>
              <AdminFormField id="gam-activity-category" label="Category" required><select id="gam-activity-category" class={adminSelectClass()} value={activityCategory()} onChange={(event) => setActivityCategory(event.currentTarget.value)}><For each={CATEGORIES}>{(category) => <option value={category}>{category}</option>}</For></select></AdminFormField>
              <AdminFormField id="gam-activity-outcome" label="Outcome key" required><Show when={activityKind() === "booth"} fallback={<input id="gam-activity-outcome" class={adminInputClass("font-mono")} required value={activityOutcome()} onInput={(event) => setActivityOutcome(event.currentTarget.value)} />}><select id="gam-activity-outcome" class={adminSelectClass("font-mono")} value={activityOutcome()} onChange={(event) => setActivityOutcome(event.currentTarget.value)}><option value="visit">visit</option><option value="participation">participation</option><option value="completion">completion</option><option value="win">win</option><option value="high_score">high_score</option></select></Show></AdminFormField>
              <AdminFormField id="gam-activity-evidence" label="Evidence mode" required><select id="gam-activity-evidence" class={adminSelectClass()} value={activityEvidence()} onChange={(event) => setActivityEvidence(event.currentTarget.value)}><For each={EVIDENCE_MODES}>{(mode) => <option value={mode}>{mode}</option>}</For></select></AdminFormField>
              <Show when={activityKind() === "booth"}>
                <AdminFormField id="gam-activity-evidence-channel" label="WTS evidence channel" required><select id="gam-activity-evidence-channel" class={adminSelectClass()} value={activityEvidenceChannel()} onChange={(event) => setActivityEvidenceChannel(event.currentTarget.value as "wts_qr" | "wts_link" | "wts_manual_code")}><option value="wts_qr">WTS QR artifact</option><option value="wts_link">WTS link artifact</option><option value="wts_manual_code">WTS manual-code artifact</option></select></AdminFormField>
                <AdminFormField id="gam-activity-deployment" label="WTS deployment label" required><input id="gam-activity-deployment" class={adminInputClass()} required value={activityDeploymentLabel()} onInput={(event) => setActivityDeploymentLabel(event.currentTarget.value)} placeholder="WTS-owned sign, screen, or official page" /></AdminFormField>
                <Show when={activityOutcome() === "win" || activityOutcome() === "high_score"}><p class="md:col-span-2 xl:col-span-4 text-sm text-warning-200">High-tier outcomes need their own WTS-controlled, outcome-specific artifact and code. Do not configure one from staff assertions, external forms, or generic booth evidence.</p></Show>
              </Show>
              <AdminFormField id="gam-activity-achievement" label="Direct Achievement"><select id="gam-activity-achievement" class={adminSelectClass()} value={activityAchievement()} onChange={(event) => setActivityAchievement(event.currentTarget.value)}><option value="">None</option><For each={operations()?.achievements || []}>{(achievement) => <option value={achievement.id}>{achievement.key}</option>}</For></select></AdminFormField>
              <AdminFormField id="gam-activity-session" label="Session source"><select id="gam-activity-session" class={adminSelectClass()} value={activitySession()} onChange={(event) => setActivitySession(event.currentTarget.value)}><option value="">None</option><For each={operations()?.references.sessions || []}>{(session) => <option value={session.id}>{session.title}{session.published ? "" : " (draft)"}</option>}</For></select></AdminFormField>
              <AdminFormField id="gam-activity-partner" label="Partner source"><select id="gam-activity-partner" class={adminSelectClass()} value={activityPartner()} onChange={(event) => setActivityPartner(event.currentTarget.value)}><option value="">None</option><For each={operations()?.references.partners || []}>{(partner) => <option value={partner.id}>{partner.name}{partner.type === "sponsor" ? "" : ` (${partner.type})`}</option>}</For></select></AdminFormField>
              <AdminFormField id="gam-activity-partner-kind" label="Partner kind"><select id="gam-activity-partner-kind" class={adminSelectClass()} value={activityPartnerKind()} onChange={(event) => setActivityPartnerKind(event.currentTarget.value)}><option value="sponsor">Sponsor</option><option value="community_partner">Community partner</option><option value="organizer">Organizer</option><option value="workshop_host">Workshop host</option></select></AdminFormField>
              <AdminFormField id="gam-activity-event" label="Event key / ID"><input id="gam-activity-event" class={adminInputClass("font-mono")} value={activityEventKey()} onInput={(event) => setActivityEventKey(event.currentTarget.value)} /></AdminFormField>
              <AdminFormField id="gam-activity-limit" label="Per-User limit" required><input id="gam-activity-limit" type="number" min="1" class={adminInputClass("font-mono")} required value={activityLimit()} onInput={(event) => setActivityLimit(event.currentTarget.value)} /></AdminFormField>
              <AdminFormField id="gam-activity-max" label="Global claim limit" required><input id="gam-activity-max" type="number" min="1" class={adminInputClass("font-mono")} required value={activityMaxClaims()} onInput={(event) => setActivityMaxClaims(event.currentTarget.value)} /></AdminFormField>
              <AdminFormField id="gam-activity-from" label="Active from" required><input id="gam-activity-from" type="datetime-local" class={adminInputClass("font-mono")} required value={activityFrom()} onInput={(event) => setActivityFrom(event.currentTarget.value)} /></AdminFormField>
              <AdminFormField id="gam-activity-until" label="Active until" required><input id="gam-activity-until" type="datetime-local" class={adminInputClass("font-mono")} required value={activityUntil()} onInput={(event) => setActivityUntil(event.currentTarget.value)} /></AdminFormField>
            </div>
          </AdminFormSection>
           <AdminFormSection title="Direct score policy" description="A policy is stored on a draft schedule. Total-only policies set Leaderboard XP to zero and cannot increase leaderboard capacity." class="mt-6">
            <Show when={activityId()} fallback={<p class="text-sm font-mono text-base-content/60">Save this Activity first, then edit it to attach its Activity cap membership and direct score policy.</p>}>
              <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
                <AdminFormField id="gam-policy-schedule" label="Draft schedule"><select id="gam-policy-schedule" class={adminSelectClass()} value={policySchedule()} onChange={(event) => setPolicySchedule(event.currentTarget.value)}><option value="">No score policy</option><For each={draftSchedules()}>{(schedule) => <option value={schedule.id}>{schedule.key}</option>}</For></select></AdminFormField>
                <AdminFormField id="gam-policy-key" label="Policy key"><input id="gam-policy-key" class={adminInputClass("font-mono")} value={policyKey()} onInput={(event) => setPolicyKey(event.currentTarget.value)} /></AdminFormField>
                <AdminFormField id="gam-policy-total" label="Total XP"><input id="gam-policy-total" type="number" min="0" class={adminInputClass("font-mono")} value={policyTotalXp()} onInput={(event) => setPolicyTotalXp(event.currentTarget.value)} /></AdminFormField>
                <AdminFormField id="gam-policy-leaderboard" label="Leaderboard XP"><input id="gam-policy-leaderboard" type="number" min="0" class={adminInputClass("font-mono")} value={policyLeaderboardXp()} onInput={(event) => setPolicyLeaderboardXp(event.currentTarget.value)} /></AdminFormField>
                <AdminFormField id="gam-policy-related" label="Related cap group"><input id="gam-policy-related" class={adminInputClass("font-mono")} value={policyRelatedCap()} onInput={(event) => setPolicyRelatedCap(event.currentTarget.value)} /></AdminFormField>
                <AdminFormField id="gam-policy-day" label="Score day"><input id="gam-policy-day" type="date" class={adminInputClass("font-mono")} value={policyScoreDay()} onInput={(event) => setPolicyScoreDay(event.currentTarget.value)} /></AdminFormField>
              </div>
            </Show>
           </AdminFormSection>
           <Show when={activityKind() === "booth"}>
             <AdminFormSection title="Optional partner follow-up consent" description="This is a separate current-User opt-in after redemption or from their profile. It never changes a Claim, Badge, total XP, or Leaderboard XP." class="mt-6">
               <div class="grid gap-4 md:grid-cols-2">
                 <label class="flex items-center gap-2 text-sm font-mono"><input type="checkbox" class="checkbox checkbox-sm" checked={activityPartnerFollowUpEnabled()} onChange={(event) => setActivityPartnerFollowUpEnabled(event.currentTarget.checked)} /> Offer separate partner_follow_up consent</label>
                 <AdminFormField id="gam-activity-consent-notice" label="Notice version" required={activityPartnerFollowUpEnabled()}><input id="gam-activity-consent-notice" class={adminInputClass("font-mono")} required={activityPartnerFollowUpEnabled()} disabled={!activityPartnerFollowUpEnabled()} value={activityPartnerFollowUpNoticeVersion()} onInput={(event) => setActivityPartnerFollowUpNoticeVersion(event.currentTarget.value)} placeholder="2026-09-v1" /></AdminFormField>
               </div>
             </AdminFormSection>
           </Show>
          <div class="mt-5 flex items-center justify-between gap-3"><label class="flex items-center gap-2 text-sm font-mono"><input type="checkbox" class="checkbox checkbox-sm" checked={activityEnabled()} onChange={(event) => setActivityEnabled(event.currentTarget.checked)} /> Enabled when active</label><div class="flex gap-2"><button type="button" class="btn btn-ghost font-mono" onClick={resetActivity}>Clear</button><button type="submit" class="btn btn-primary font-mono" disabled={busy()}>Save draft</button></div></div>
        </form>

        <div class="mt-8 grid gap-8 xl:grid-cols-3">
          <For each={[{ kind: "achievement" as const, title: "Achievements", rows: operations()?.achievements || [] }, { kind: "mission" as const, title: "Missions", rows: operations()?.missions || [] }, { kind: "activity" as const, title: "Activities", rows: operations()?.activities || [] }]}>
            {(group) => <AdminDataPanel>
              <div class="border-b border-white/10 p-4"><h2 class="font-bold text-white">{group.title}</h2></div>
              <ul class="divide-y divide-white/10" role="list">
                <For each={group.rows}>{(item: any) => <li class="p-4">
                  <div class="flex items-start justify-between gap-3"><div class="min-w-0"><p class="font-bold text-white break-words">{item.badgeName || item.title || item.key}</p><p class="text-xs font-mono text-base-content/55 break-all">{item.key}</p></div><span class={statusClass(item.status === "active" && (item.enabled ?? true))}>{item.status}</span></div>
                  <Show when={group.kind === "activity"}><p class="mt-2 text-xs font-mono text-base-content/60">accepted {item.acceptedClaims} / rejected {item.rejectedRedemptions} / last success {formatTime(item.lastSuccessAt)}</p></Show>
                  <div class="mt-3 flex flex-wrap gap-2">
                    <Show when={item.status === "draft"}>
                      <Show when={!usesDedicatedConfiguration(group.kind, item)}><button type="button" class="btn btn-xs btn-ghost font-mono" onClick={() => group.kind === "achievement" ? editAchievement(item) : group.kind === "mission" ? editMission(item) : editActivity(item)}>Edit draft</button></Show>
                      <button type="button" class="btn btn-xs btn-success font-mono" disabled={busy()} onClick={() => lifecycle(group.kind, item.id, "activate")}>Activate</button>
                    </Show>
                    <Show when={item.status === "active"}><button type="button" class="btn btn-xs btn-error btn-outline font-mono" disabled={busy()} onClick={() => lifecycle(group.kind, item.id, "retire")}>Retire</button></Show>
                  </div>
                </li>}</For>
                <Show when={group.rows.length === 0}><li class="p-4 text-sm font-mono text-base-content/60">No configured {group.title.toLowerCase()}.</li></Show>
              </ul>
            </AdminDataPanel>}
          </For>
        </div>
      </Show>

       <Show when={tab() === "schedule"}>
        <div class="grid gap-8 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
          <form class={adminFormPanelClass} onSubmit={createSchedule}><AdminFormSection title="New score schedule draft" description="Activate only after every intended direct Activity policy is attached and its Activity is active."><div class="grid gap-4"><AdminFormField id="gam-schedule-key" label="Schedule key" required><input id="gam-schedule-key" class={adminInputClass("font-mono")} required value={scheduleKey()} onInput={(event) => setScheduleKey(event.currentTarget.value)} /></AdminFormField><AdminFormField id="gam-schedule-effective" label="Effective at" required><input id="gam-schedule-effective" type="datetime-local" class={adminInputClass("font-mono")} required value={scheduleEffectiveAt()} onInput={(event) => setScheduleEffectiveAt(event.currentTarget.value)} /></AdminFormField></div></AdminFormSection><div class="mt-5 flex justify-end"><button type="submit" class="btn btn-primary font-mono" disabled={busy()}>Create schedule draft</button></div></form>
          <AdminDataPanel><div class="border-b border-white/10 p-5"><h2 class="font-bold text-white">Versioned September schedules</h2><p class="mt-1 text-xs font-mono text-base-content/60">Only active score-bearing policies on active Activities produce the cap snapshot and Access Level thresholds.</p></div><ul class="divide-y divide-white/10" role="list"><For each={operations()?.schedules || []}>{(schedule) => <li class="flex flex-wrap items-center justify-between gap-4 p-5"><div><p class="font-bold text-white">{schedule.key}</p><p class="text-xs font-mono text-base-content/60">total cap {schedule.totalXpCeiling} / leaderboard cap {schedule.leaderboardXpCeiling} / effective {formatTime(schedule.effectiveAt)}</p></div><div class="flex items-center gap-2"><span class={statusClass(schedule.status === "active")}>{schedule.status}</span><Show when={schedule.status === "draft"}><button type="button" class="btn btn-sm btn-success font-mono" disabled={busy()} onClick={() => activateSchedule(schedule.id)}>Activate</button></Show></div></li>}</For></ul></AdminDataPanel>
        </div>
       </Show>

       <Show when={tab() === "sessions"}>
         <AdminSessionAttendanceMissions operations={operations} onChanged={refetch} />
       </Show>

       <Show when={tab() === "events"}>
         <AdminConfiguredEventMissions operations={operations} onChanged={refetch} />
       </Show>
       <Show when={tab() === "community"}>
         <AdminCommunityPartnerMissions operations={operations} onChanged={refetch} />
       </Show>
       <Show when={tab() === "eggs"}>
         <AdminEasterEggMissions operations={operations} onChanged={refetch} />
       </Show>

        <Show when={tab() === "codes"}>
        <div class="grid gap-8 xl:grid-cols-2">
          <form class={adminFormPanelClass} onSubmit={generateCodes}><AdminFormSection title="Generate Mission code batch" description="The raw code, QR/link URL, and CSV are shown once only. A retry with the same operation never creates a second secret batch."><div class="grid gap-4 md:grid-cols-2"><AdminFormField id="gam-code-activity" label="Active Activity" required><select id="gam-code-activity" class={adminSelectClass()} required value={codeActivity()} onChange={(event) => setCodeActivity(event.currentTarget.value)}><option value="">Choose Activity</option><For each={activeActivities()}>{(activity) => <option value={activity.id}>{activity.key}</option>}</For></select></AdminFormField><AdminFormField id="gam-code-label" label="Batch label" required><input id="gam-code-label" class={adminInputClass()} required value={codeLabel()} onInput={(event) => setCodeLabel(event.currentTarget.value)} /></AdminFormField><AdminFormField id="gam-code-quantity" label="Quantity" required><input id="gam-code-quantity" type="number" min="1" max="100" class={adminInputClass("font-mono")} required value={codeQuantity()} onInput={(event) => setCodeQuantity(event.currentTarget.value)} /></AdminFormField><AdminFormField id="gam-code-role" label="Evidence role" required><select id="gam-code-role" class={adminSelectClass()} value={codeRole()} onChange={(event) => setCodeRole(event.currentTarget.value as "single" | "start" | "finish" | "static_puzzle")}><option value="single">single</option><option value="start">start</option><option value="finish">finish</option><option value="static_puzzle">static puzzle</option></select></AdminFormField><AdminFormField id="gam-code-from" label="Code active from" required><input id="gam-code-from" type="datetime-local" class={adminInputClass("font-mono")} required value={codeFrom()} onInput={(event) => setCodeFrom(event.currentTarget.value)} /></AdminFormField><AdminFormField id="gam-code-until" label="Code active until" required><input id="gam-code-until" type="datetime-local" class={adminInputClass("font-mono")} required value={codeUntil()} onInput={(event) => setCodeUntil(event.currentTarget.value)} /></AdminFormField><AdminFormField id="gam-code-max" label="Max redemptions" required><input id="gam-code-max" type="number" min="1" class={adminInputClass("font-mono")} required value={codeMaxRedemptions()} onInput={(event) => setCodeMaxRedemptions(event.currentTarget.value)} /></AdminFormField><AdminFormField id="gam-code-user-limit" label="Per-User limit" required><input id="gam-code-user-limit" type="number" min="1" class={adminInputClass("font-mono")} required value={codePerUserLimit()} onInput={(event) => setCodePerUserLimit(event.currentTarget.value)} /></AdminFormField></div></AdminFormSection><div class="mt-5 flex justify-end"><button type="submit" class="btn btn-primary font-mono" disabled={busy()}>Generate one-time batch</button></div></form>
          <AdminDataPanel><div class="border-b border-white/10 p-5"><h2 class="font-bold text-white">One-time secret response</h2><p class="mt-1 text-xs font-mono text-base-content/60">This panel is intentionally not recoverable from later admin reads.</p></div><Show when={oneTimeBatch()} fallback={<p class="p-5 text-sm font-mono text-base-content/60">Generate or reissue a code to receive its one-time export.</p>}>{(batch) => <div class="p-5"><Show when={batch().batch.secretsAvailable} fallback={<div class="alert alert-warning text-sm">{batch().batch.committed ? "This batch was committed, but its secret response is unrecoverable. Invalidate the affected code and reissue a replacement. No raw code can be regenerated." : "Code generation did not complete. Any persisted code definitions were disabled and their secrets cannot be recovered."}</div>}><div class="alert alert-warning mb-4 items-start text-sm" role="alert"><span>These bearer codes are visible only in this response. Download the CSV, store it securely, then clear the secrets from this page. Leaving Mission codes clears them automatically.</span></div><div class="mb-4 flex flex-wrap gap-2"><button type="button" class="btn btn-sm btn-secondary font-mono" onClick={() => batch().csvExport && downloadCsv(batch().csvExport!)}>Download CSV now</button><button type="button" class="btn btn-sm btn-outline btn-warning font-mono" onClick={() => setOneTimeBatch(null)}>Clear secrets from this page</button></div><ul class="space-y-3" role="list"><For each={batch().codes || []}>{(code) => <li class="rounded-lg border border-warning-400/30 bg-warning-500/10 p-3"><p class="font-mono text-xs text-base-content/60">{code.label}</p><code class="mt-1 block break-all text-sm text-warning-100">{code.rawCode}</code><code class="mt-2 block break-all text-xs text-secondary-200">{code.qrLink}</code></li>}</For></ul></Show></div>}</Show></AdminDataPanel>
        </div>

        <div class={`${adminFormPanelClass} mt-8`}><form onSubmit={lookupCodes}><AdminFormSection title="Safe code lookup" description="Search batch ID, label, lookup prefix, Activity/Mission, or redemption support reference. Raw-code verification is compared on the server and is never stored or returned."><div class="grid gap-4 md:grid-cols-2"><AdminFormField id="gam-code-search" label="Safe search"><input id="gam-code-search" class={adminInputClass("font-mono")} value={codeSearch()} onInput={(event) => setCodeSearch(event.currentTarget.value)} /></AdminFormField><AdminFormField id="gam-code-raw-search" label="Verify raw code"><input id="gam-code-raw-search" class={adminInputClass("font-mono")} value={rawCodeSearch()} onInput={(event) => setRawCodeSearch(event.currentTarget.value)} /></AdminFormField><AdminFormField id="gam-code-reason" label="Invalidation / reissue reason" required class="md:col-span-2"><input id="gam-code-reason" class={adminInputClass()} required value={codeReason()} onInput={(event) => setCodeReason(event.currentTarget.value)} placeholder="Do not include secrets, hashes, tokens, or unnecessary personal data." /></AdminFormField></div></AdminFormSection><div class="mt-5 flex justify-end"><button type="submit" class="btn btn-secondary font-mono" disabled={busy()}>Look up</button></div></form></div>

        <AdminDataPanel><div class="border-b border-white/10 p-5"><h2 class="font-bold text-white">Code operations status</h2><p class="mt-1 text-xs font-mono text-base-content/60">Safe labels and prefixes only. Accepted/rejected counts are operational support status, not attendee exports.</p></div><ul class="divide-y divide-white/10" role="list"><For each={codeMatches() || operations()?.codes || []}>{(code) => <li class="flex flex-col gap-3 p-5 lg:flex-row lg:items-center lg:justify-between"><div class="min-w-0"><div class="flex flex-wrap items-center gap-2"><p class="font-bold text-white">{code.label}</p><span class={statusClass(code.status === "active" && code.enabled)}>{code.status}</span></div><p class="mt-1 break-all text-xs font-mono text-base-content/60">batch {code.batchId || "legacy"} / prefix {code.lookupPrefix} / {code.missionKey || "no mission"} / {code.activityKey || code.activityId}</p><p class="mt-1 text-xs font-mono text-base-content/60">accepted {code.acceptedRedemptions} / rejected {code.rejectedRedemptions} / last attempt {formatTime(code.lastAttemptAt)} / last success {formatTime(code.lastSuccessAt)}</p></div><div class="flex shrink-0 flex-wrap gap-2"><Show when={code.status === "active" && code.enabled}><button type="button" class="btn btn-sm btn-error btn-outline font-mono" disabled={busy()} onClick={() => invalidateCode(code)}>Invalidate</button></Show><Show when={code.status === "disabled"}><button type="button" class="btn btn-sm btn-secondary font-mono" disabled={busy()} onClick={() => reissueCode(code)}>Reissue</button></Show></div></li>}</For><Show when={(codeMatches() || operations()?.codes || []).length === 0}><li class="p-5 text-sm font-mono text-base-content/60">No code definitions match.</li></Show></ul></AdminDataPanel>
       </Show>

       <Show when={tab() === "support"}>
         <AdminGamificationSupport
           activities={operations()?.activities || []}
           achievements={operations()?.achievements || []}
           onChanged={refetch}
         />
       </Show>

       <Show when={tab() === "hievents"}>
         <AdminHiEventsReconciliation />
       </Show>
     </AdminPageShell>
  );
}
