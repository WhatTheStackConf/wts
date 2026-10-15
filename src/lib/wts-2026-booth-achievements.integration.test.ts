import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import PocketBase from "pocketbase";
import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { startLiveQaPocketBase } from "~/lib/live-qa-pocketbase-test-helper";
import { createGamificationAccountingStore } from "~/lib/gamification-accounting-store";
import { GAMIFICATION_COLLECTIONS as C } from "~/lib/gamification-accounting";
import { GamificationOperationsService } from "~/lib/gamification-operations";
import { prepareBoothAchievements, type BoothSetupInput, type BoothSetupReceipt } from "~/lib/wts-2026-booth-setup";
import { boothAchievementKey, boothQuestionnaire, WTS_2026_BOOTH_ACHIEVEMENTS as catalogue } from "~/lib/wts-2026-booth-achievements";
import { evaluateMissionAnswers, parseQuestionnaire, publicQuestions } from "~/lib/mission-questions";
import { QUESTION_COLLECTIONS as Q } from "~/lib/mission-question-records";
import { MissionCodeRedemptionService } from "~/lib/mission-code-redemption";
import { createMissionCodeGeneration } from "~/lib/mission-code-crypto";

const connection = vi.hoisted(() => ({ pb: null as unknown as PocketBase }));
vi.mock("~/lib/pocketbase-admin-service", () => ({ getAdminPB: () => ({
  getInstance: async () => connection.pb,
  fetchRecordById: (c: string, id: string) => connection.pb.collection(c).getOne(id),
  createRecord: (c: string, data: Record<string, unknown>) => connection.pb.collection(c).create(data),
  updateRecord: (c: string, id: string, data: Record<string, unknown>) => connection.pb.collection(c).update(id, data),
}) }));

it("has exactly 12 distinct three-choice questions bound to the original printed identities and programme", () => {
  expect(catalogue).toHaveLength(12);
  for (const field of ["key", "booth", "name", "question", "lookupPrefix", "printedLabel"] as const) expect(new Set(catalogue.map(entry => entry[field])).size).toBe(12);
  const programme = JSON.parse(readFileSync("scripts/main-day-agenda.manifest.json", "utf8"));
  const slugs = new Set(programme.bindings.map((binding: { session: { slug: string } }) => binding.session.slug));
  for (const entry of catalogue) {
    expect(entry.lookupPrefix).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/);
    expect(entry.choices).toHaveLength(3);
    expect(new Set(entry.choices).size).toBe(3);
    if (entry.programmeSlug) expect(slugs.has(entry.programmeSlug)).toBe(true);
    const definition = parseQuestionnaire(boothQuestionnaire(entry));
    expect(definition.policy).toBe("correct_or_half");
    expect(evaluateMissionAnswers(definition, { question: `option_${entry.correctIndex + 1}` })).toBe("passed");
    expect(evaluateMissionAnswers(definition, {})).toBe("incomplete");
    expect(JSON.stringify(publicQuestions(definition))).not.toContain("acceptedAnswers");
  }
});

describe("2026 booth catalogue using real PocketBase", () => {
  let fixture: Awaited<ReturnType<typeof startLiveQaPocketBase>>;
  let actor: { id: string; role: "admin" };
  let store: ReturnType<typeof createGamificationAccountingStore>;
  let operations: GamificationOperationsService;
  let config: BoothSetupInput;
  let receipts: BoothSetupReceipt[];
  const pepper = "synthetic-booth-catalogue-pepper";
  beforeAll(async () => {
    fixture = await startLiveQaPocketBase({ workspace: true });
    connection.pb = fixture.pb;
    actor = { id: (await fixture.user("admin")).record.id, role: "admin" };
    store = createGamificationAccountingStore();
    operations = new GamificationOperationsService(store, pepper);
    const from = new Date(Date.now() - 60000).toISOString();
    const schedule = await operations.createScoreScheduleDraft({ key: "booth-test-schedule", effectiveAt: from, operationId: randomUUID(), reason: "Synthetic booth rehearsal" }, actor);
    config = { scheduleId: schedule.id, fullXp: 20, startsAt: from, endsAt: new Date(Date.now() + 3600000).toISOString(), operationId: randomUUID() };
  }, 60000);
  afterAll(async () => { await fixture?.cleanup(); });

  it("validates before writes, then creates twelve complete drafts and resumes a lost response without duplicates", async () => {
    await expect(prepareBoothAchievements(store, pepper, { ...config, fullXp: 19 }, actor)).rejects.toThrow();
    expect(await store.list(C.activities, { category: "booth" })).toHaveLength(0);
    for (const boundary of [C.achievements, C.missions, C.activities, C.scoreSchedulePolicies, Q.definitions]) {
      let lost = true;
      const interrupted = { ...store, create: async <T>(collection: string, data: Record<string, unknown>): Promise<T> => {
        const result = await store.create<T>(collection, data);
        if (collection === boundary && lost) { lost = false; throw new Error("Synthetic lost response after persisted configuration"); }
        return result;
      } };
      await expect(prepareBoothAchievements(interrupted, pepper, config, actor)).rejects.toThrow("Synthetic lost response");
    }
    receipts = await prepareBoothAchievements(store, pepper, config, actor);
    expect(receipts).toHaveLength(12);
    expect(await prepareBoothAchievements(store, pepper, config, actor)).toEqual(receipts);
    for (const collection of [C.achievements, C.missions, C.activities]) {
      const rows = await store.list<{ status: string }>(collection, { category: "booth" });
      expect(rows).toHaveLength(12);
      expect(rows.every(row => row.status === "draft")).toBe(true);
    }
    expect(await store.list(Q.definitions)).toHaveLength(12);
    expect(await store.list(C.adminActions, { related_collection: Q.definitions })).toHaveLength(12);
    for (const collection of [C.achievements, C.missions, C.activities, C.scoreSchedulePolicies]) {
      expect(await store.list(C.adminActions, { related_collection: collection })).toHaveLength(12);
    }
    expect(await store.list(C.scoreSchedulePolicies, { schedule: config.scheduleId })).toHaveLength(12);
    expect(await store.list(C.codes)).toHaveLength(0);
    expect(await store.list(C.xpEvents)).toHaveLength(0);
    await expect(prepareBoothAchievements(store, pepper, { ...config, fullXp: 40 }, actor)).rejects.toThrow(/conflicts/);
    const policies = await store.list<{ total_xp: number }>(C.scoreSchedulePolicies, { schedule: config.scheduleId });
    expect(policies.every(row => row.total_xp === 20)).toBe(true);
  }, 120000);

  it("preserves existing Activity metadata and policies on a different draft schedule", async () => {
    const before = await store.getById<{ id: string; metadata: Record<string, unknown> }>(C.activities, receipts[0].activityId);
    const metadata = { ...before.metadata, organizer_note: "Keep this unrelated configuration" };
    await store.update(C.activities, before.id, { metadata });
    const second = await operations.createScoreScheduleDraft({ key: "second-booth-draft", effectiveAt: config.startsAt, operationId: randomUUID(), reason: "Synthetic second schedule" }, actor);
    await prepareBoothAchievements(store, pepper, { ...config, scheduleId: second.id, operationId: randomUUID() }, actor);
    expect((await store.getById<{ metadata: unknown }>(C.activities, before.id)).metadata).toEqual(metadata);
    for (const schedule of [config.scheduleId, second.id]) {
      const policies = await store.list<{ active: boolean }>(C.scoreSchedulePolicies, { schedule });
      expect(policies).toHaveLength(12);
      expect(policies.every(policy => policy.active)).toBe(true);
    }
    expect(await prepareBoothAchievements(store, pepper, config, actor)).toEqual(receipts);
    expect(await store.list(C.adminActions, { related_collection: Q.definitions })).toHaveLength(12);
  }, 60000);

  it("fences definition and score-schedule activation while preparation is suspended after validation", async () => {
    let release!: () => void;
    let reached!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    const entered = new Promise<void>(resolve => { reached = resolve; });
    let paused = false;
    const suspendedStore = { ...store,
      findOne: async <T>(collection: string, match: Record<string, unknown>): Promise<T | undefined> => {
        const row = await store.findOne<T>(collection, match);
        if (collection === Q.definitions && !paused) { paused = true; reached(); await barrier; }
        return row;
      },
    };
    const preparing = prepareBoothAchievements(suspendedStore, pepper, config, actor);
    await entered;
    const activating = operations.activateDefinition("achievement", { id: receipts[0].achievementId, confirmation: true, reason: "Concurrent synthetic activation", operationId: randomUUID() }, actor);
    const scheduling = operations.activateScoreSchedule(config.scheduleId, { id: config.scheduleId, confirmation: true, reason: "Concurrent synthetic schedule activation", operationId: randomUUID() }, actor).then(() => "activated", () => "rejected");
    try {
      const first = await Promise.race([activating.then(() => "definition"), scheduling, new Promise<string>(resolve => setTimeout(() => resolve("blocked"), 100))]);
      expect(first).toBe("blocked");
      expect((await store.getById<{ status: string }>(C.achievements, receipts[0].achievementId)).status).toBe("draft");
      expect((await store.getById<{ status: string }>(C.scoreSchedules, config.scheduleId)).status).toBe("draft");
    } finally { release(); }
    expect(await preparing).toEqual(receipts);
    expect(await activating).toMatchObject({ status: "active" });
    expect(await scheduling).toBe("rejected"); // Activities are still drafts.
  }, 60000);

  it("activates and registers synthetic equivalents for every mapping, then awards 20 or 10 and one Badge per participant", async () => {
    for (const receipt of receipts) {
      for (const [kind, id] of [["achievement", receipt.achievementId], ["mission", receipt.missionId], ["activity", receipt.activityId]] as const) {
        await operations.activateDefinition(kind, { id, confirmation: true, reason: "Synthetic booth rehearsal", operationId: randomUUID() }, actor);
      }
    }
    await operations.activateScoreSchedule(config.scheduleId, { id: config.scheduleId, confirmation: true, reason: "Synthetic booth rehearsal", operationId: randomUUID() }, actor);
    for (const entry of catalogue) {
      const receipt = receipts.find(row => row.key === boothAchievementKey(entry))!;
      // Only the public lookup prefix is real; never load production bearer codes in tests.
      const rawCode = `WTS26-${entry.lookupPrefix}-${createMissionCodeGeneration(pepper).rawCode.split("-")[2]}`;
      const registration = { activityId: receipt.activityId, label: entry.booth, rawCodes: [rawCode], evidenceRole: "single" as const, startsAt: config.startsAt, endsAt: config.endsAt, maxRedemptions: 10000, perUserLimit: 1, operationId: randomUUID() };
      await operations.registerCodes(registration, actor);
      const service = new MissionCodeRedemptionService(store, pepper);
      for (const correct of [true, false]) {
        const user = (await fixture.user()).record;
        const scan = () => service.redeem({ user, rawCode, requestFingerprint: "booth-rehearsal" });
        const gate = await scan();
        expect(gate.status).toBe("questions_required");
        expect(gate.questionnaire?.questions[0].prompt).toBe(entry.question);
        expect(JSON.stringify(gate)).not.toContain("acceptedAnswers");
        const index = correct ? entry.correctIndex : (entry.correctIndex + 1) % 3;
        const result = await service.submitAnswers({ user, challengeId: gate.questionnaire!.challengeId, operationId: randomUUID(), answers: { question: `option_${index + 1}` }, requestFingerprint: "booth-rehearsal" });
        expect(result).toMatchObject({ status: "accepted", xpAwarded: correct ? 20 : 10, leaderboardXpAwarded: correct ? 20 : 10 });
        expect(result.badges?.map(badge => badge.name)).toContain(entry.name);
        expect(await scan()).toMatchObject({ status: "already_redeemed", xpAwarded: 0 });
        expect(await store.list(C.xpEvents, { user: user.id })).toHaveLength(1);
      }
    }
    await expect(prepareBoothAchievements(store, pepper, config, actor)).rejects.toThrow(/draft score schedule/);
  }, 120000);
});
