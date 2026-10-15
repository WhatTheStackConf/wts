import { describe, expect, it } from "vite-plus/test";
import { AdminActions, type AdminActionValue } from "~/lib/admin-action-ledger";
import { createInMemoryAdminActionStore } from "~/lib/admin-action-memory-store";

const request = {
  actorUserId: "user-admin",
  source: "admin_ui" as const,
  operationKind: "partner.update",
  targetCollection: "partners",
  operationId: "update-partner-1",
  normalizedInput: { name: "Example Partner" },
};

async function startWith(afterSummary: AdminActionValue) {
  const actions = new AdminActions(createInMemoryAdminActionStore());
  try {
    const started = await actions.start(request, { beforeSummary: null, afterSummary });
    return started.outcome;
  } catch (error) {
    return (error as Error).message;
  }
}

function nested(depth: number): AdminActionValue {
  return depth === 0 ? "leaf" : { child: nested(depth - 1) };
}

describe("Admin Action summary limits", () => {
  it.each<[string, AdminActionValue, string]>([
    ["a nested summary at the depth limit", nested(6), "started"],
    ["a summary nested past the depth limit", nested(7), "Admin Action after summary is too deeply nested."],
    ["fifty array values", Array.from({ length: 50 }, () => 1), "started"],
    ["fifty-one array values", Array.from({ length: 51 }, () => 1), "Admin Action after summary contains too many values."],
    ["fifty-one fields", Object.fromEntries(Array.from({ length: 51 }, (_, index) => [`field${index}`, 1])), "Admin Action after summary contains too many fields."],
    ["a note metadata field", { notePresent: true, noteLength: 4 }, "started"],
    ["a nested note field", { partner: { publicNote: "x" } }, 'Admin Action after summary contains the sensitive field "publicNote".'],
    ["a nested non-finite number", { values: [1, Number.POSITIVE_INFINITY] }, "Admin Action after summary contains a non-finite number."],
    ["an oversized nested value", { values: ["x".repeat(2_100)] }, "Admin Action after summary must be 2,048 bytes or smaller."],
    ["scalars and null", [true, null, "public", 3], "started"],
  ])("handles %s", async (_name, afterSummary, expected) => {
    await expect(startWith(afterSummary)).resolves.toBe(expected);
  });
});
