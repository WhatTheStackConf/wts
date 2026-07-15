import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMcpTokenMaterial } from "~/lib/mcp-token-utils";

const adminService = vi.hoisted(() => ({
  fetchAllRecords: vi.fn(),
  updateRecord: vi.fn(),
}));

vi.mock("~/lib/pocketbase-admin-service", () => ({
  getAdminPB: () => adminService,
}));

import { authenticateMcpBearer, normalizeMcpScopes } from "~/lib/mcp-auth";

function authFixture(overrides: Record<string, unknown> = {}) {
  const material = createMcpTokenMaterial();
  return {
    material,
    record: {
      id: "mcp-token-record",
      name: "Programme client",
      token_id: material.tokenId,
      token_prefix: material.tokenPrefix,
      secret_hash: material.secretHash,
      scopes: ["programme:read", "cfp:read"],
      created_by: "admin-user",
      expires_at: "2027-01-01 00:00:00.000Z",
      ...overrides,
    },
  };
}

describe("MCP bearer authentication", () => {
  beforeEach(() => {
    adminService.fetchAllRecords.mockReset();
    adminService.updateRecord.mockReset();
    adminService.updateRecord.mockResolvedValue({});
  });

  it("accepts only the precise scopes and removes duplicates", () => {
    expect(
      normalizeMcpScopes([
        "program:read",
        "programme:read",
        "cfp:read",
        "programme:read",
        "partners:draft:write",
        "partners:read",
        "partners:read",
        "unknown:read",
      ]),
    ).toEqual([
      "programme:read",
      "cfp:read",
      "partners:read",
      "partners:draft:write",
    ]);
  });

  it("revalidates the owning User's current admin role on every request", async () => {
    const { material, record } = authFixture();
    let role = "admin";
    adminService.fetchAllRecords.mockImplementation((collection: string) => {
      if (collection === "mcp_tokens") return Promise.resolve([record]);
      if (collection === "users") return Promise.resolve([{ id: "admin-user", role }]);
      return Promise.resolve([]);
    });

    await expect(authenticateMcpBearer(`Bearer ${material.token}`)).resolves.toMatchObject({
      success: true,
    });

    role = "reviewer";
    await expect(authenticateMcpBearer(`Bearer ${material.token}`)).resolves.toEqual({
      success: false,
      status: 403,
      error: "MCP token owner is not a current admin",
    });

    expect(adminService.fetchAllRecords).toHaveBeenCalledWith("users", {
      filter: 'id = "admin-user"',
    });
    expect(
      adminService.fetchAllRecords.mock.calls.filter(([collection]) => collection === "users"),
    ).toHaveLength(2);
  });

  it("durably expands a persisted legacy grant before runtime scope normalization", async () => {
    const { material, record } = authFixture({ scopes: ["program:read"] });
    adminService.fetchAllRecords.mockImplementation((collection: string) => {
      if (collection === "mcp_tokens") return Promise.resolve([record]);
      if (collection === "users") return Promise.resolve([{ id: "admin-user", role: "admin" }]);
      return Promise.resolve([]);
    });

    await expect(authenticateMcpBearer(`Bearer ${material.token}`)).resolves.toMatchObject({
      success: true,
      token: { scopes: ["programme:read", "cfp:read"] },
    });
    expect(adminService.updateRecord).toHaveBeenCalledWith(
      "mcp_tokens",
      "mcp-token-record",
      expect.objectContaining({ scopes: ["programme:read", "cfp:read"] }),
    );
    expect(normalizeMcpScopes(["program:read"])).toEqual([]);
  });

  it.each([
    ["revoked", { revoked_at: "2026-01-01 00:00:00.000Z" }, "MCP token has been revoked"],
    ["expired", { expires_at: "2020-01-01 00:00:00.000Z" }, "MCP token has expired"],
    ["invalid expiry", { expires_at: "not-a-date" }, "MCP token expiry is invalid"],
  ])("returns 401 for %s credentials", async (_label, overrides, error) => {
    const { material, record } = authFixture(overrides);
    adminService.fetchAllRecords.mockResolvedValue([record]);

    await expect(authenticateMcpBearer(`Bearer ${material.token}`)).resolves.toEqual({
      success: false,
      status: 401,
      error,
    });
    expect(adminService.updateRecord).not.toHaveBeenCalled();
  });

  it("rejects malformed bearer headers without accepting trailing material", async () => {
    const { material } = authFixture();

    await expect(
      authenticateMcpBearer(`Bearer ${material.token} trailing`),
    ).resolves.toMatchObject({ success: false, status: 401 });
    expect(adminService.fetchAllRecords).not.toHaveBeenCalled();
  });

  it("preserves an existing token whose valid expiry is more than 90 days away", async () => {
    const { material, record } = authFixture({ expires_at: "2030-01-01 00:00:00.000Z" });
    adminService.fetchAllRecords.mockImplementation((collection: string) => {
      if (collection === "mcp_tokens") return Promise.resolve([record]);
      if (collection === "users") return Promise.resolve([{ id: "admin-user", role: "admin" }]);
      return Promise.resolve([]);
    });

    await expect(authenticateMcpBearer(`Bearer ${material.token}`)).resolves.toMatchObject({
      success: true,
      token: { expiresAt: "2030-01-01 00:00:00.000Z" },
    });
  });
});
