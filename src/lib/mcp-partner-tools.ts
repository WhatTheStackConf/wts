import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { containsAdminActionSecretMaterial } from "~/lib/admin-action-ledger";
import {
  hasMcpScope,
  type AuthenticatedMcpToken,
  type McpScope,
} from "~/lib/mcp-auth";
import {
  createMcpPartnerAdministration,
  mcpPartnerInfrastructureError,
  type McpPartnerAdministrationService,
  type McpPartnerToolResult,
} from "~/lib/mcp-partner-administration";
import { PARTNER_TIERS, PARTNER_TYPES } from "~/lib/partner-administration";

export const PARTNER_MCP_TOOL_SCOPES = {
  list_partners: ["partners:read"],
  get_partner: ["partners:read"],
  create_partner_draft: ["partners:draft:write"],
  update_partner_draft: ["partners:draft:write"],
} as const satisfies Record<string, readonly McpScope[]>;

type PartnerMcpTool = keyof typeof PARTNER_MCP_TOOL_SCOPES;

const partnerTypeSchema = z.enum(PARTNER_TYPES);
const partnerTierSchema = z.enum(PARTNER_TIERS);
const operationIdSchema = z.string()
  .min(1)
  .max(128)
  .refine((value) => value.trim() === value)
  .refine((value) => !containsAdminActionSecretMaterial(value));
const partnerIdSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/);
const partnerToolOutputSchema = z.object({
  success: z.boolean(),
  data: z.record(z.string(), z.unknown()).optional(),
  error: z.object({
    code: z.string(),
    message: z.string(),
    next_step: z.string(),
    retryable: z.boolean(),
  }).passthrough().optional(),
}).strict();
const partnerPatchSchema = z.object({
  name: z.string().max(200).optional(),
  type: partnerTypeSchema.optional(),
  tier: partnerTierSchema.nullable().optional(),
  url: z.string().max(2_000).nullable().optional(),
  notes: z.string().max(10_000).nullable().optional(),
}).strict().refine((patch) => Object.keys(patch).length > 0, "Partner patch is empty.");
const partnerToolInputSchemas = {
  list_partners: z.object({
    state: z.enum(["draft", "published"]).optional(),
    type: partnerTypeSchema.optional(),
  }).strict(),
  get_partner: z.object({ partner_id: partnerIdSchema }).strict(),
  create_partner_draft: z.object({
    operation_id: operationIdSchema,
    name: z.string().min(1).max(200),
    type: partnerTypeSchema,
    tier: partnerTierSchema.optional(),
    url: z.string().max(2_000).optional(),
    notes: z.string().max(10_000).optional(),
  }).strict(),
  update_partner_draft: z.object({
    operation_id: operationIdSchema,
    partner_id: partnerIdSchema,
    expected_updated_at: z.string().min(1).max(64),
    patch: partnerPatchSchema,
  }).strict(),
} as const satisfies Record<PartnerMcpTool, z.ZodType>;

function structuredToolResult(value: McpPartnerToolResult<Record<string, unknown>>) {
  return {
    structuredContent: value,
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
    isError: !value.success,
  };
}

export function invalidPartnerArgumentsToolResult() {
  return structuredToolResult({
    success: false,
    error: {
      code: "invalid_arguments",
      message: "Partner tool arguments are invalid or include fields this tool does not accept.",
      next_step: "Review the tool input schema, remove forbidden fields, and retry with corrected input.",
      retryable: false,
    },
  });
}

export function hasValidPartnerMcpToolInput(tool: PartnerMcpTool, input: unknown): boolean {
  return partnerToolInputSchemas[tool].safeParse(input).success;
}

async function callPartnerTool(
  auth: AuthenticatedMcpToken,
  call: () => Promise<McpPartnerToolResult<Record<string, unknown>>>,
) {
  try {
    return structuredToolResult(await call());
  } catch (error) {
    const value = error as { name?: string; status?: number };
    console.error(JSON.stringify({
      event: "mcp_partner_administration_failed",
      tokenId: auth.id,
      status: Number.isFinite(value?.status) ? value.status : undefined,
      errorType: value?.name || (error instanceof Error ? error.name : "UnknownError"),
    }));
    return structuredToolResult(mcpPartnerInfrastructureError());
  }
}

function hasRequiredScopes(auth: AuthenticatedMcpToken, tool: PartnerMcpTool) {
  return PARTNER_MCP_TOOL_SCOPES[tool].every((scope) => hasMcpScope(auth, scope));
}

function assertToolCallScope(auth: AuthenticatedMcpToken, tool: PartnerMcpTool) {
  if (!hasRequiredScopes(auth, tool)) {
    throw new Error(`MCP token is missing scope for ${tool}`);
  }
}

export function registerPartnerMcpTools(
  server: McpServer,
  auth: AuthenticatedMcpToken,
  partners: McpPartnerAdministrationService = createMcpPartnerAdministration(auth),
) {
  if (hasRequiredScopes(auth, "list_partners")) {
    server.registerTool(
      "list_partners",
      {
        title: "List Partners",
        description:
          "Return safe draft and Published Partner summaries plus duplicate-check guidance. Partner Note text is never included.",
        inputSchema: partnerToolInputSchemas.list_partners,
        outputSchema: partnerToolOutputSchema,
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
      },
      async (args) => {
        assertToolCallScope(auth, "list_partners");
        return callPartnerTool(auth, () => partners.listPartners(args));
      },
    );
  }

  if (hasRequiredScopes(auth, "get_partner")) {
    server.registerTool(
      "get_partner",
      {
        title: "Get Partner",
        description:
          "Return one private Partner detail. Partner Note text is included only after human approval of its current version.",
        inputSchema: partnerToolInputSchemas.get_partner,
        outputSchema: partnerToolOutputSchema,
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
      },
      async (args) => {
        assertToolCallScope(auth, "get_partner");
        return callPartnerTool(auth, () => partners.getPartner(args.partner_id));
      },
    );
  }

  if (hasRequiredScopes(auth, "create_partner_draft")) {
    server.registerTool(
      "create_partner_draft",
      {
        title: "Create Partner Draft",
        description:
          "Create one audited Partner draft from allowlisted metadata. Logos, publication, deletion, and Partner Note approval remain human-only.",
        inputSchema: partnerToolInputSchemas.create_partner_draft,
        outputSchema: partnerToolOutputSchema,
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      },
      async (args) => {
        assertToolCallScope(auth, "create_partner_draft");
        return callPartnerTool(auth, () => partners.createPartnerDraft(args));
      },
    );
  }

  if (hasRequiredScopes(auth, "update_partner_draft")) {
    server.registerTool(
      "update_partner_draft",
      {
        title: "Update Partner Draft",
        description:
          "Patch allowlisted fields on a current Partner draft using its exact updated_at value. Published Partners and human-only fields are rejected.",
        inputSchema: partnerToolInputSchemas.update_partner_draft,
        outputSchema: partnerToolOutputSchema,
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      },
      async (args) => {
        assertToolCallScope(auth, "update_partner_draft");
        return callPartnerTool(auth, () => partners.updatePartnerDraft(args));
      },
    );
  }
}
