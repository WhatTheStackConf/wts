import { describe, expect, it } from "vitest";
import { AdminActions } from "~/lib/admin-action-ledger";
import { createInMemoryAdminActionStore } from "~/lib/admin-action-memory-store";
import {
  McpPartnerAdministration,
  type McpPartnerUpdateInput,
} from "~/lib/mcp-partner-administration";
import { PartnerAdministration } from "~/lib/partner-administration";
import { createInMemoryPartnerAdministrationStore } from "~/lib/partner-administration-memory-store";

function administrations() {
  const partnerStore = createInMemoryPartnerAdministrationStore();
  const actionStore = createInMemoryAdminActionStore();
  const actions = new AdminActions(actionStore);
  return {
    actions,
    agent: new McpPartnerAdministration(new PartnerAdministration(
      partnerStore,
      { mode: "agent", userId: "admin-user", source: "mcp", mcpTokenId: "mcp-token" },
      actions,
    )),
    human: new PartnerAdministration(
      partnerStore,
      { mode: "human_admin", userId: "admin-user", source: "admin_ui" },
      actions,
    ),
  };
}

describe("MCP Partner administration adapter", () => {
  it("keeps list and write results free of Partner Note text while detail follows human approval", async () => {
    const { agent, human } = administrations();
    const created = await agent.createPartnerDraft({
      operation_id: "create-note-draft",
      name: "Note Review Partner",
      type: "supporter",
      notes: "Approved organizational context",
    });
    expect(created).toMatchObject({
      success: true,
      data: {
        partner: { state: "draft", logo_present: false },
        action: { operation_id: "create-note-draft", replayed: false },
      },
    });
    expect(JSON.stringify(created)).not.toContain("Approved organizational context");
    if (!created.success) throw new Error(created.error.message);

    const beforeApproval = await agent.getPartner(created.data.partner.id);
    expect(beforeApproval).toMatchObject({
      success: true,
      data: { partner: { note_agent_visible: false } },
    });
    expect(JSON.stringify(beforeApproval)).not.toContain("Approved organizational context");

    const humanPartner = await human.getPartner(created.data.partner.id);
    if (!humanPartner) throw new Error("Expected the human Partner detail.");
    const approved = await human.setNoteApproval(
      created.data.partner.id,
      humanPartner.partner.version,
      true,
      "approve-note",
    );
    expect(approved).toMatchObject({ success: true });

    const detail = await agent.getPartner(created.data.partner.id);
    expect(detail).toMatchObject({
      success: true,
      data: {
        partner: {
          note_agent_visible: true,
          partner_note: "Approved organizational context",
        },
      },
    });
    const list = await agent.listPartners();
    expect(list).toMatchObject({
      success: true,
      data: {
        partners: [{ id: created.data.partner.id, state: "draft" }],
        duplicate_check: expect.any(Object),
      },
    });
    expect(JSON.stringify(list)).not.toContain("Approved organizational context");

    if (!approved.success) throw new Error(approved.error);
    const revised = await human.updatePartner(
      approved.data.partner.id,
      approved.data.partner.version,
      { notes: "Revised context requires review" },
      "revise-note",
    );
    expect(revised).toMatchObject({
      success: true,
      data: { partner: { noteAgentVisible: false } },
    });
    const revisedDetail = await agent.getPartner(created.data.partner.id);
    expect(revisedDetail).toMatchObject({
      success: true,
      data: { partner: { note_agent_visible: false } },
    });
    expect(JSON.stringify(revisedDetail)).not.toContain("Revised context requires review");
  });

  it("round-trips updated_at across exact replay and rejects stale or changed operations safely", async () => {
    const { agent, human } = administrations();
    const created = await agent.createPartnerDraft({
      operation_id: "create-update-draft",
      name: "Timestamp Partner",
      type: "other",
      notes: "Never leak this note",
    });
    if (!created.success) throw new Error(created.error.message);
    const update: McpPartnerUpdateInput = {
      operation_id: "patch-update-draft",
      partner_id: created.data.partner.id,
      expected_updated_at: created.data.partner.expected_updated_at,
      patch: { url: "https://timestamp.example/partner" },
    };

    const applied = await agent.updatePartnerDraft(update);
    const replayed = await agent.updatePartnerDraft(update);
    const changed = await agent.updatePartnerDraft({
      ...update,
      patch: { url: "https://timestamp.example/changed" },
    });

    expect(applied).toMatchObject({
      success: true,
      data: { action: { replayed: false }, partner: { state: "draft" } },
    });
    if (!applied.success || !replayed.success) throw new Error("Expected an applied replay.");
    expect(replayed.data).toEqual({
      ...applied.data,
      action: { ...applied.data.action, replayed: true },
    });
    expect(changed).toMatchObject({
      success: false,
      error: { code: "operation_mismatch", retryable: false },
    });

    const current = await human.getPartner(created.data.partner.id);
    if (!current) throw new Error("Expected current Partner detail.");
    const humanEdit = await human.updatePartner(
      current.partner.id,
      current.partner.version,
      { name: "Human Timestamp Partner" },
      "human-edit",
    );
    expect(humanEdit).toMatchObject({ success: true });

    const stale = await agent.updatePartnerDraft({
      ...update,
      operation_id: "stale-patch",
    });
    expect(stale).toMatchObject({
      success: false,
      error: {
        code: "stale",
        current: { name: "Human Timestamp Partner", expected_updated_at: expect.any(String) },
      },
    });
    expect(JSON.stringify(stale)).not.toContain("Never leak this note");
  });

  it("blocks exact duplicates, returns fuzzy warnings, and cannot mutate a Published Partner", async () => {
    const { agent, human } = administrations();
    const existing = await human.createDraft(
      { name: "Existing Community", type: "community_partner", url: "https://groups.example/existing" },
      "create-existing",
    );
    if (!existing.success) throw new Error(existing.error);

    const fuzzy = await agent.createPartnerDraft({
      operation_id: "create-fuzzy",
      name: "Existing Communit",
      type: "community_partner",
      url: "https://groups.example/other",
    });
    expect(fuzzy).toMatchObject({
      success: true,
      data: {
        warnings: expect.arrayContaining([
          expect.objectContaining({ kind: "similar_name" }),
          expect.objectContaining({ kind: "shared_host" }),
        ]),
      },
    });

    const duplicate = await agent.createPartnerDraft({
      operation_id: "create-duplicate",
      name: " existing   community ",
      type: "other",
    });
    expect(duplicate).toMatchObject({
      success: false,
      error: { code: "duplicate", field: "name", current: { id: existing.data.partner.id } },
    });

    const withLogo = await human.updatePartner(
      existing.data.partner.id,
      existing.data.partner.version,
      { logo: { name: "official.svg", type: "image/svg+xml", data: [1, 2, 3] } },
      "upload-logo",
    );
    if (!withLogo.success) throw new Error(withLogo.error);
    const published = await human.setPublication(
      withLogo.data.partner.id,
      withLogo.data.partner.version,
      true,
      "publish-existing",
    );
    if (!published.success) throw new Error(published.error);

    const denied = await agent.updatePartnerDraft({
      operation_id: "agent-published-edit",
      partner_id: published.data.partner.id,
      expected_updated_at: published.data.partner.updatedAt,
      patch: { name: "Forbidden Published Edit" },
    });
    expect(denied).toMatchObject({
      success: false,
      error: {
        code: "validation",
        message: "Only a human admin can edit a Published Partner.",
      },
    });
  });

  it("reports pending work and retries an exact failed operation without duplicate Partners", async () => {
    const pendingBase = createInMemoryPartnerAdministrationStore();
    let releaseCreate!: () => void;
    const createGate = new Promise<void>((resolve) => { releaseCreate = resolve; });
    let enteredCreate!: () => void;
    const createEntered = new Promise<void>((resolve) => { enteredCreate = resolve; });
    let blockFirst = true;
    const pendingStore = {
      ...pendingBase,
      async create(...args: Parameters<typeof pendingBase.create>) {
        if (blockFirst) {
          blockFirst = false;
          enteredCreate();
          await createGate;
        }
        return pendingBase.create(...args);
      },
    };
    const pendingActions = new AdminActions(createInMemoryAdminActionStore());
    const pendingAgent = new McpPartnerAdministration(new PartnerAdministration(
      pendingStore,
      { mode: "agent", userId: "admin-user", source: "mcp", mcpTokenId: "mcp-token" },
      pendingActions,
    ));
    const input = {
      operation_id: "pending-create",
      name: "Pending Partner",
      type: "other" as const,
    };

    const firstAttempt = pendingAgent.createPartnerDraft(input);
    await createEntered;
    const pending = await pendingAgent.createPartnerDraft(input);
    expect(pending).toMatchObject({
      success: false,
      error: { code: "operation_pending", retryable: true, action: { status: "pending" } },
    });
    releaseCreate();
    await expect(firstAttempt).resolves.toMatchObject({ success: true });

    const failedBase = createInMemoryPartnerAdministrationStore();
    let failFirst = true;
    const failedStore = {
      ...failedBase,
      async create(...args: Parameters<typeof failedBase.create>) {
        if (failFirst) {
          failFirst = false;
          throw new Error("Injected Partner persistence failure.");
        }
        return failedBase.create(...args);
      },
    };
    const failedActionStore = createInMemoryAdminActionStore();
    const failedActions = new AdminActions(failedActionStore);
    const failedAgent = new McpPartnerAdministration(new PartnerAdministration(
      failedStore,
      { mode: "agent", userId: "admin-user", source: "mcp", mcpTokenId: "mcp-token" },
      failedActions,
    ));
    const failedInput = {
      operation_id: "failed-create",
      name: "Retried Partner",
      type: "other" as const,
    };

    const failed = await failedAgent.createPartnerDraft(failedInput);
    const retried = await failedAgent.createPartnerDraft(failedInput);
    expect(failed).toMatchObject({
      success: false,
      error: { code: "operation_failed", retryable: true, action: { status: "failed" } },
    });
    expect(retried).toMatchObject({
      success: true,
      data: { action: { replayed: false } },
    });
    expect((await failedBase.list())).toHaveLength(1);
    expect(await failedActions.list({ targetCollection: "partners" })).toEqual([
      expect.objectContaining({ status: "applied", attemptCount: 2 }),
    ]);
  });
});
