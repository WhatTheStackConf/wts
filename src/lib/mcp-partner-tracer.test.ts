import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it } from "vitest";
import { AdminActions } from "~/lib/admin-action-ledger";
import { createInMemoryAdminActionStore } from "~/lib/admin-action-memory-store";
import { McpPartnerAdministration } from "~/lib/mcp-partner-administration";
import { registerPartnerMcpTools } from "~/lib/mcp-partner-tools";
import { PartnerAdministration } from "~/lib/partner-administration";
import { createInMemoryPartnerAdministrationStore } from "~/lib/partner-administration-memory-store";
import { buildPublicPartnerGroups } from "~/lib/partners-public-data";
import type { PartnerRecord } from "~/lib/pocketbase-types";

function structured<T>(result: unknown): T {
  return (result as { structuredContent: T }).structuredContent;
}

function tracerServer(partners: McpPartnerAdministration): McpServer {
  const server = new McpServer({ name: "partner-tracer", version: "1.0.0" });
  registerPartnerMcpTools(server, {
    id: "partner-token",
    name: "Partner tracer",
    tokenId: "partner-tracer-token-id",
    createdBy: "admin-user",
    scopes: ["partners:read", "partners:draft:write"],
  }, partners);
  return server;
}

describe("Partner MCP tracer", () => {
  it("carries an agent draft and retry through human publication, public visibility, and history", async () => {
    const partnerStore = createInMemoryPartnerAdministrationStore();
    const actionStore = createInMemoryAdminActionStore();
    const actions = new AdminActions(actionStore);
    const agentAdministration = new McpPartnerAdministration(new PartnerAdministration(
      partnerStore,
      {
        mode: "agent",
        userId: "admin-user",
        source: "mcp",
        mcpTokenId: "partner-token",
      },
      actions,
    ));
    const humanAdministration = new PartnerAdministration(
      partnerStore,
      { mode: "human_admin", userId: "admin-user", source: "admin_ui" },
      actions,
    );
    const server = tracerServer(agentAdministration);
    const client = new Client({ name: "partner-tracer", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      const createArguments = {
        operation_id: "tracer-create-partner",
        name: "Tracer Supporter",
        type: "supporter",
        url: "https://tracer.example/",
        notes: "Human-reviewed organization context",
      };
      const createdCall = await client.callTool({
        name: "create_partner_draft",
        arguments: createArguments,
      });
      const replayedCall = await client.callTool({
        name: "create_partner_draft",
        arguments: createArguments,
      });
      const created = structured<{
        success: true;
        data: {
          partner: {
            id: string;
            name: string;
            state: "draft";
            expected_updated_at: string;
          };
          action: { id: string; replayed: boolean };
        };
      }>(createdCall);
      const replayed = structured<typeof created>(replayedCall);

      expect(created).toMatchObject({
        success: true,
        data: {
          partner: { name: "Tracer Supporter", state: "draft" },
          action: { replayed: false },
        },
      });
      expect(replayed).toMatchObject({
        success: true,
        data: {
          partner: { id: created.data.partner.id, state: "draft" },
          action: { id: created.data.action.id, replayed: true },
        },
      });
      expect(JSON.stringify(createdCall)).not.toContain("Human-reviewed organization context");

      const listedBefore = await client.callTool({ name: "list_partners", arguments: {} });
      const detailBefore = await client.callTool({
        name: "get_partner",
        arguments: { partner_id: created.data.partner.id },
      });
      expect(structured(listedBefore)).toMatchObject({
        success: true,
        data: { partners: [{ id: created.data.partner.id, state: "draft" }] },
      });
      expect(JSON.stringify(listedBefore)).not.toContain("Human-reviewed organization context");
      expect(JSON.stringify(detailBefore)).not.toContain("Human-reviewed organization context");

      const humanDraft = await humanAdministration.getPartner(created.data.partner.id);
      if (!humanDraft) throw new Error("Expected the MCP-created Partner draft in human administration.");
      const completed = await humanAdministration.updatePartner(
        humanDraft.partner.id,
        humanDraft.partner.version,
        { logo: { name: "official.svg", type: "image/svg+xml", data: [1, 2, 3] } },
        "tracer-human-logo",
      );
      if (!completed.success) throw new Error(completed.error);
      const approved = await humanAdministration.setNoteApproval(
        completed.data.partner.id,
        completed.data.partner.version,
        true,
        "tracer-human-note-approval",
      );
      if (!approved.success) throw new Error(approved.error);

      const detailApproved = await client.callTool({
        name: "get_partner",
        arguments: { partner_id: created.data.partner.id },
      });
      const listedApproved = await client.callTool({ name: "list_partners", arguments: {} });
      expect(structured(detailApproved)).toMatchObject({
        success: true,
        data: {
          partner: {
            note_agent_visible: true,
            partner_note: "Human-reviewed organization context",
          },
        },
      });
      expect(JSON.stringify(listedApproved)).not.toContain("Human-reviewed organization context");

      const published = await humanAdministration.setPublication(
        approved.data.partner.id,
        approved.data.partner.version,
        true,
        "tracer-human-publish",
      );
      if (!published.success) throw new Error(published.error);

      const deniedPublishedEdit = await client.callTool({
        name: "update_partner_draft",
        arguments: {
          operation_id: "tracer-denied-published-edit",
          partner_id: published.data.partner.id,
          expected_updated_at: published.data.partner.updatedAt,
          patch: { name: "Forbidden Agent Publication Edit" },
        },
      });
      expect(structured(deniedPublishedEdit)).toMatchObject({
        success: false,
        error: { code: "validation", message: "Only a human admin can edit a Published Partner." },
      });

      const publicGroups = buildPublicPartnerGroups([{
        id: published.data.partner.id,
        name: published.data.partner.name,
        published: published.data.partner.published,
        type: published.data.partner.type,
        tier: published.data.partner.tier,
        logo: published.data.partner.logo,
        url: published.data.partner.url,
        notes: "Human-reviewed organization context",
        note_agent_visible: true,
        created: published.data.partner.createdAt,
        updated: published.data.partner.updatedAt,
      } as PartnerRecord]);
      expect(publicGroups.find((group) => group.id === "supporters")?.partners).toEqual([
        expect.objectContaining({ name: "Tracer Supporter", type: "supporter" }),
      ]);
      expect(JSON.stringify(publicGroups)).not.toContain("Human-reviewed organization context");
      expect(JSON.stringify(publicGroups)).not.toContain(published.data.partner.id);

      const history = await humanAdministration.listHistory(created.data.partner.id, 100);
      expect(history.map((action) => [action.operationKind, action.source, action.status])).toEqual(
        expect.arrayContaining([
          ["partner.create", "mcp", "applied"],
          ["partner.patch", "admin_ui", "applied"],
          ["partner.note_approval", "admin_ui", "applied"],
          ["partner.publish", "admin_ui", "applied"],
        ]),
      );
      expect(history.filter((action) => action.operationKind === "partner.create")).toHaveLength(1);
      expect(JSON.stringify(history)).not.toContain("Human-reviewed organization context");

      const createActions = (await actions.list({ targetCollection: "partners", limit: 100 }))
        .filter((action) => action.operationKind === "partner.create");
      expect(createActions).toEqual([
        expect.objectContaining({
          actorUserId: "admin-user",
          mcpTokenId: "partner-token",
          source: "mcp",
          status: "applied",
          attemptCount: 1,
        }),
      ]);
    } finally {
      await client.close();
      await server.close();
    }
  });
});
