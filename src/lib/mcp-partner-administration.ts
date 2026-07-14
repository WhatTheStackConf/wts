import { AdminActions } from "~/lib/admin-action-ledger";
import { createPocketBaseAdminActionStore } from "~/lib/admin-action-store";
import type { AuthenticatedMcpToken } from "~/lib/mcp-auth";
import {
  PartnerAdministration,
  type PartnerAdminListItem,
  type PartnerAdminSnapshot,
  type PartnerAppliedAdminAction,
  type PartnerAdministrationResult,
  type PartnerDraftInput,
  type PartnerPatch,
  type PartnerPublicationReadiness,
  type PartnerUnresolvedAdminAction,
  type PartnerWarning,
} from "~/lib/partner-administration";
import { createPocketBasePartnerAdministrationStore } from "~/lib/partner-administration-store";

export interface McpPartnerSummary {
  id: string;
  name: string;
  state: "draft" | "published";
  type: PartnerAdminSnapshot["type"];
  tier?: PartnerAdminSnapshot["tier"];
  url?: string;
  logo_present: boolean;
  updated_at: string;
  expected_updated_at: string;
  publication?: PartnerPublicationReadiness;
}

export interface McpPartnerDetail extends McpPartnerSummary {
  created_at: string;
  note_agent_visible: boolean;
  partner_note?: string;
}

export interface McpPartnerAction {
  id: string;
  operation_id: string;
  operation_kind: string;
  status: "pending" | "applied" | "failed";
  replayed?: boolean;
}

export interface McpPartnerToolError {
  code: string;
  message: string;
  next_step: string;
  retryable: boolean;
  field?: "name" | "url";
  current?: McpPartnerSummary;
  publication?: PartnerPublicationReadiness;
  action?: McpPartnerAction;
}

export type McpPartnerToolResult<T extends Record<string, unknown>> =
  | { success: true; data: T }
  | { success: false; error: McpPartnerToolError };

export interface McpPartnerListInput {
  state?: "draft" | "published";
  type?: PartnerAdminSnapshot["type"];
}

export interface McpPartnerCreateInput extends Omit<PartnerDraftInput, "logo"> {
  operation_id: string;
}

export interface McpPartnerUpdateInput {
  partner_id: string;
  operation_id: string;
  expected_updated_at: string;
  patch: Omit<PartnerPatch, "logo">;
}

export interface McpPartnerAdministrationService {
  listPartners(
    input?: McpPartnerListInput,
  ): Promise<McpPartnerToolResult<{ partners: McpPartnerSummary[]; duplicate_check: Record<string, string> }>>;
  getPartner(partnerId: string): Promise<McpPartnerToolResult<{ partner: McpPartnerDetail }>>;
  createPartnerDraft(
    input: McpPartnerCreateInput,
  ): Promise<McpPartnerToolResult<McpPartnerMutationData>>;
  updatePartnerDraft(
    input: McpPartnerUpdateInput,
  ): Promise<McpPartnerToolResult<McpPartnerMutationData>>;
}

interface McpPartnerMutationData extends Record<string, unknown> {
  partner: McpPartnerSummary;
  warnings: PartnerWarning[];
  publication: PartnerPublicationReadiness;
  action: McpPartnerAction;
}

function partnerSummary(
  partner: PartnerAdminSnapshot,
  publication?: PartnerPublicationReadiness,
): McpPartnerSummary {
  return {
    id: partner.id,
    name: partner.name,
    state: partner.published ? "published" : "draft",
    type: partner.type,
    tier: partner.tier,
    url: partner.url,
    logo_present: Boolean(partner.logo),
    updated_at: partner.updatedAt,
    expected_updated_at: partner.updatedAt,
    publication,
  };
}

function partnerDetail(item: PartnerAdminListItem): McpPartnerDetail {
  const detail: McpPartnerDetail = {
    ...partnerSummary(item.partner, item.publication),
    created_at: item.partner.createdAt,
    note_agent_visible: item.partner.noteAgentVisible,
  };
  if (item.partner.noteAgentVisible && item.partner.notes) {
    detail.partner_note = item.partner.notes;
  }
  return detail;
}

function actionSnapshot(
  action: PartnerAppliedAdminAction | PartnerUnresolvedAdminAction,
): McpPartnerAction {
  const snapshot: McpPartnerAction = {
    id: action.id,
    operation_id: action.operationId,
    operation_kind: action.operationKind,
    status: action.status,
  };
  if ("replayed" in action) snapshot.replayed = action.replayed;
  return snapshot;
}

function nextStep(code: string): string {
  if (code === "operation_pending") {
    return "Wait briefly, then retry the exact call with the same operation_id.";
  }
  if (code === "operation_failed") {
    return "Retry the exact call with the same operation_id.";
  }
  if (code === "operation_mismatch") {
    return "Use a new operation_id for changed input.";
  }
  if (code === "stale") {
    return "Review current, then retry with its expected_updated_at and a new operation_id.";
  }
  if (code === "duplicate") {
    return "Use the existing Partner or choose a distinct organization identity.";
  }
  if (code === "not_found") {
    return "Check partner_id with list_partners, then retry.";
  }
  return "Correct the input and retry. Publication, deletion, logos, and note approval require a human admin.";
}

function errorResult(
  result: Exclude<PartnerAdministrationResult<unknown>, { success: true }>,
): McpPartnerToolResult<never> {
  const error: McpPartnerToolError = {
    code: result.code,
    message: result.error,
    next_step: nextStep(result.code),
    retryable: result.code === "operation_pending" || result.code === "operation_failed",
  };
  if ("field" in result) error.field = result.field;
  if ("publication" in result) error.publication = result.publication;
  if ("current" in result) {
    error.current = partnerSummary(
      result.current,
      "publication" in result ? result.publication : undefined,
    );
  }
  if ("action" in result) error.action = actionSnapshot(result.action);
  return { success: false, error };
}

export class McpPartnerAdministration implements McpPartnerAdministrationService {
  constructor(private readonly administration: PartnerAdministration) {}

  async listPartners(
    input: McpPartnerListInput = {},
  ): Promise<McpPartnerToolResult<{
    partners: McpPartnerSummary[];
    duplicate_check: Record<string, string>;
  }>> {
    const items = await this.administration.listPartners();
    const partners = items
      .map((item) => partnerSummary(item.partner, item.publication))
      .filter((partner) => !input.state || partner.state === input.state)
      .filter((partner) => !input.type || partner.type === input.type);
    return {
      success: true,
      data: {
        partners,
        duplicate_check: {
          exact_name: "Exact normalized Partner names are blocked.",
          exact_url: "Exact canonical full Partner URLs are blocked.",
          fuzzy: "Similar names and shared URL hosts are returned as non-blocking warnings on writes.",
        },
      },
    };
  }

  async getPartner(
    partnerId: string,
  ): Promise<McpPartnerToolResult<{ partner: McpPartnerDetail }>> {
    const item = await this.administration.getPartner(partnerId);
    if (!item) {
      return {
        success: false,
        error: {
          code: "not_found",
          message: "Partner was not found.",
          next_step: nextStep("not_found"),
          retryable: false,
        },
      };
    }
    return { success: true, data: { partner: partnerDetail(item) } };
  }

  async createPartnerDraft(
    input: McpPartnerCreateInput,
  ): Promise<McpPartnerToolResult<McpPartnerMutationData>> {
    const { operation_id, ...draft } = input;
    return this.mutationResult(await this.administration.createDraft(draft, operation_id));
  }

  async updatePartnerDraft(
    input: McpPartnerUpdateInput,
  ): Promise<McpPartnerToolResult<McpPartnerMutationData>> {
    return this.mutationResult(await this.administration.updatePartnerDraft(
      input.partner_id,
      input.expected_updated_at,
      input.patch,
      input.operation_id,
    ));
  }

  private mutationResult(
    result: PartnerAdministrationResult<{
      partner: PartnerAdminSnapshot;
      warnings: PartnerWarning[];
      publication: PartnerPublicationReadiness;
    }>,
  ): McpPartnerToolResult<McpPartnerMutationData> {
    if (!result.success) return errorResult(result);
    return {
      success: true,
      data: {
        partner: partnerSummary(result.data.partner, result.data.publication),
        warnings: result.data.warnings,
        publication: result.data.publication,
        action: actionSnapshot(result.action),
      },
    };
  }
}

export function createMcpPartnerAdministration(
  auth: AuthenticatedMcpToken,
): McpPartnerAdministrationService {
  return new McpPartnerAdministration(
    new PartnerAdministration(
      createPocketBasePartnerAdministrationStore(),
      {
        mode: "agent",
        userId: auth.createdBy,
        source: "mcp",
        mcpTokenId: auth.id,
      },
      new AdminActions(createPocketBaseAdminActionStore()),
    ),
  );
}

export function mcpPartnerInfrastructureError(): McpPartnerToolResult<never> {
  return {
    success: false,
    error: {
      code: "infrastructure",
      message: "Partner administration is temporarily unavailable.",
      next_step: "Retry later with the same operation_id if this was a write.",
      retryable: true,
    },
  };
}
