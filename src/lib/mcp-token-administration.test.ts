import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import PocketBase from "pocketbase";
import { describe, expect, it } from "vitest";
import { AdminActions } from "~/lib/admin-action-ledger";
import { createInMemoryAdminActionStore } from "~/lib/admin-action-memory-store";
import { McpTokenAdministration } from "~/lib/mcp-token-administration";
import { createInMemoryMcpTokenAdministrationStore } from "~/lib/mcp-token-administration-memory-store";
import { createPocketBaseAdminActionStore } from "~/lib/admin-action-store";
import { createPocketBaseMcpTokenAdministrationStore } from "~/lib/mcp-token-administration-store";

async function availablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not reserve a local MCP governance test port."));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

async function waitForPocketBase(url: string): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(250) });
      if (response.ok) return;
    } catch {
      // PocketBase is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Disposable PocketBase did not start.");
}

describe("MCP token administration", () => {
  it("issues and displays explicit least-privilege Partner scopes", async () => {
    const actionStore = createInMemoryAdminActionStore();
    const store = createInMemoryMcpTokenAdministrationStore({
      users: [{ id: "admin", name: "Ada Admin", role: "admin" }],
    });
    const administration = new McpTokenAdministration(
      store,
      { userId: "admin", name: "Ada Admin" },
      new AdminActions(actionStore),
      { now: () => new Date("2026-07-13T12:00:00.000Z") },
    );

    const created = await administration.createToken({
      name: "Partner drafting client",
      scopes: ["partners:read", "partners:draft:write"],
      expires_at: "2026-08-01",
    }, "create-partner-client");

    expect(created).toMatchObject({
      success: true,
      data: {
        token: { scopes: ["partners:read", "partners:draft:write"] },
      },
    });
    expect(await administration.listTokens()).toEqual([
      expect.objectContaining({ scopes: ["partners:read", "partners:draft:write"] }),
    ]);
    const actions = await new AdminActions(actionStore).list({ targetCollection: "mcp_tokens" });
    expect(actions).toEqual([
      expect.objectContaining({
        afterSummary: expect.objectContaining({
          scopes: ["partners:read", "partners:draft:write"],
        }),
      }),
    ]);
  });

  it("lets every current admin inspect safe metadata for every owner's token", async () => {
    const store = createInMemoryMcpTokenAdministrationStore({
      users: [
        { id: "admin-a", name: "Ada Admin", role: "admin" },
        { id: "admin-b", name: "Boris Admin", role: "admin" },
        { id: "former-admin", name: "Former Admin", role: "user" },
      ],
      tokens: [
        {
          id: "token-a",
          name: "Programme client",
          tokenPrefix: "wts_mcp_aaaaaaaa",
          scopes: ["programme:read"],
          ownerUserId: "admin-a",
          expiresAt: "2026-08-01T23:59:59.999Z",
          lastUsedAt: "2026-07-12T10:00:00.000Z",
          createdAt: "2026-07-01T10:00:00.000Z",
          updatedAt: "2026-07-12T10:00:00.000Z",
        },
        {
          id: "token-b",
          name: "CFP client",
          tokenPrefix: "wts_mcp_bbbbbbbb",
          scopes: ["cfp:read"],
          ownerUserId: "admin-b",
          expiresAt: "2026-07-01T23:59:59.999Z",
          createdAt: "2026-06-01T10:00:00.000Z",
          updatedAt: "2026-06-01T10:00:00.000Z",
        },
        {
          id: "token-former",
          name: `wts_mcp_${"d".repeat(24)}_${"s".repeat(32)}`,
          tokenPrefix: `wts_mcp_${"d".repeat(24)}_${"s".repeat(32)}`,
          scopes: ["programme:read", "cfp:read"],
          ownerUserId: "former-admin",
          expiresAt: "2026-08-01T23:59:59.999Z",
          createdAt: "2026-07-01T10:00:00.000Z",
          updatedAt: "2026-07-01T10:00:00.000Z",
        },
      ],
    });
    const administration = new McpTokenAdministration(
      store,
      { userId: "admin-b", name: "Boris Admin" },
      new AdminActions(createInMemoryAdminActionStore()),
      { now: () => new Date("2026-07-13T12:00:00.000Z") },
    );

    const tokens = await administration.listTokens();
    const otherAdminTokens = await new McpTokenAdministration(
      store,
      { userId: "admin-a", name: "Ada Admin" },
      new AdminActions(createInMemoryAdminActionStore()),
      { now: () => new Date("2026-07-13T12:00:00.000Z") },
    ).listTokens();

    expect(tokens).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "token-former",
        name: "Redacted token name",
        tokenPrefix: "Redacted token prefix",
        owner: { id: "former-admin", name: "Former Admin" },
        status: "owner_disabled",
      }),
      expect.objectContaining({
        id: "token-b",
        owner: { id: "admin-b", name: "Boris Admin" },
        status: "expired",
      }),
      expect.objectContaining({
        id: "token-a",
        owner: { id: "admin-a", name: "Ada Admin" },
        status: "active",
        tokenPrefix: "wts_mcp_aaaaaaaa",
        lastUsedAt: "2026-07-12T10:00:00.000Z",
      }),
    ]));
    expect(JSON.stringify(tokens)).not.toMatch(/secret|hash|wts_mcp_[a-f0-9]{24}_/i);
    expect(otherAdminTokens).toEqual(tokens);
  });

  it("lets a current admin revoke another owner's active token with a bounded reason", async () => {
    const actionStore = createInMemoryAdminActionStore();
    const administration = new McpTokenAdministration(
      createInMemoryMcpTokenAdministrationStore({
        users: [
          { id: "owner", name: "Token Owner", role: "admin" },
          { id: "revoker", name: "Incident Admin", role: "admin" },
        ],
        tokens: [{
          id: "token-a",
          name: "Programme client",
          tokenPrefix: "wts_mcp_aaaaaaaa",
          scopes: ["programme:read"],
          ownerUserId: "owner",
          expiresAt: "2026-08-01T23:59:59.999Z",
          createdAt: "2026-07-01T10:00:00.000Z",
          updatedAt: "2026-07-01T10:00:00.000Z",
        }],
      }),
      { userId: "revoker", name: "Incident Admin" },
      new AdminActions(actionStore),
      { now: () => new Date("2026-07-13T12:00:00.000Z") },
    );

    const emptyReason = await administration.revokeToken("token-a", "   ", "empty-reason");
    const longReason = await administration.revokeToken("token-a", "x".repeat(501), "long-reason");
    const secretReason = await administration.revokeToken(
      "token-a",
      `Leaked wts_mcp_${"a".repeat(24)}_${"s".repeat(32)}`,
      "secret-reason",
    );
    const hashReason = await administration.revokeToken(
      "token-a",
      `Suspected hash ${"a".repeat(64)}`,
      "hash-reason",
    );
    const revoked = await administration.revokeToken(
      "token-a",
      "Client laptop was lost.",
      "revoke-token-a",
    );
    const replayed = await administration.revokeToken(
      "token-a",
      "Client laptop was lost.",
      "revoke-token-a",
    );
    const changed = await administration.revokeToken(
      "token-a",
      "A different reason.",
      "revoke-token-a",
    );

    expect(emptyReason).toMatchObject({ success: false, code: "validation" });
    expect(longReason).toMatchObject({ success: false, code: "validation" });
    expect(secretReason).toMatchObject({ success: false, code: "validation" });
    expect(hashReason).toMatchObject({ success: false, code: "validation" });
    expect(revoked).toMatchObject({
      success: true,
      data: {
        token: {
          id: "token-a",
          owner: { id: "owner", name: "Token Owner" },
          status: "revoked",
          revokedBy: { id: "revoker", name: "Incident Admin" },
          revocationReason: "Client laptop was lost.",
        },
      },
      action: { status: "applied", replayed: false },
    });
    expect(replayed).toMatchObject({
      success: true,
      data: { token: { id: "token-a", revocationReason: "Client laptop was lost." } },
      action: { status: "applied", replayed: true },
    });
    expect(changed).toMatchObject({ success: false, code: "operation_mismatch" });

    const actions = await new AdminActions(actionStore).list({ targetCollection: "mcp_tokens" });
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      actorUserId: "revoker",
      operationKind: "mcp_token.revoke",
      targetId: "token-a",
      status: "applied",
      afterSummary: {
        ownerUserId: "owner",
        tokenPrefix: "wts_mcp_aaaaaaaa",
        scopes: ["programme:read"],
        expiresAt: "2026-08-01T23:59:59.999Z",
        revokedByUserId: "revoker",
        revocationReason: "Client laptop was lost.",
      },
    });
  });

  it("permanently revokes expired and owner-disabled tokens", async () => {
    const actionStore = createInMemoryAdminActionStore();
    const administration = new McpTokenAdministration(
      createInMemoryMcpTokenAdministrationStore({
        users: [
          { id: "former-admin", name: "Former Admin", role: "user" },
          { id: "revoker", name: "Incident Admin", role: "admin" },
        ],
        tokens: [
          {
            id: "owner-disabled-token",
            name: "Former admin client",
            tokenPrefix: "wts_mcp_disabled",
            scopes: ["programme:read"],
            ownerUserId: "former-admin",
            expiresAt: "2026-08-01T23:59:59.999Z",
            createdAt: "2026-07-01T10:00:00.000Z",
            updatedAt: "2026-07-01T10:00:00.000Z",
          },
          {
            id: "expired-token",
            name: "Expired client",
            tokenPrefix: "wts_mcp_expired",
            scopes: ["cfp:read"],
            ownerUserId: "revoker",
            expiresAt: "2026-07-01T23:59:59.999Z",
            createdAt: "2026-06-01T10:00:00.000Z",
            updatedAt: "2026-06-01T10:00:00.000Z",
          },
        ],
      }),
      { userId: "revoker", name: "Incident Admin" },
      new AdminActions(actionStore),
      { now: () => new Date("2026-07-13T12:00:00.000Z") },
    );

    await expect(
      administration.revokeToken(
        "owner-disabled-token",
        "Owner access was removed during incident response.",
        "revoke-owner-disabled-token",
      ),
    ).resolves.toMatchObject({ success: true, data: { token: { status: "revoked" } } });
    await expect(
      administration.revokeToken(
        "expired-token",
        "Permanently retiring the expired credential.",
        "revoke-expired-token",
      ),
    ).resolves.toMatchObject({ success: true, data: { token: { status: "revoked" } } });

    const actions = await new AdminActions(actionStore).list({ targetCollection: "mcp_tokens" });
    expect(actions).toEqual(expect.arrayContaining([
      expect.objectContaining({ beforeSummary: expect.objectContaining({ status: "owner_disabled" }) }),
      expect.objectContaining({ beforeSummary: expect.objectContaining({ status: "expired" }) }),
    ]));
  });

  it("creates one unrecoverable credential and safely replays only metadata", async () => {
    const actionStore = createInMemoryAdminActionStore();
    const store = createInMemoryMcpTokenAdministrationStore({
      users: [{ id: "admin", name: "Ada Admin", role: "admin" }],
    });
    const administration = new McpTokenAdministration(
      store,
      { userId: "admin", name: "Ada Admin" },
      new AdminActions(actionStore),
      { now: () => new Date("2026-07-13T12:00:00.000Z") },
    );
    const input = {
      name: "Review assistant",
      scopes: ["cfp:read"] as const,
      expires_at: "2026-08-01",
    };

    const created = await administration.createToken(input, "create-review-assistant");
    const replayed = await administration.createToken(input, "create-review-assistant");
    const changed = await administration.createToken(
      { ...input, scopes: ["programme:read"] },
      "create-review-assistant",
    );
    const secretOperation = await administration.createToken(input, `wts_mcp_${"a".repeat(24)}_${"s".repeat(32)}`);

    expect(created).toMatchObject({
      success: true,
      data: {
        credentialAvailable: true,
        credential: expect.stringMatching(/^wts_mcp_[a-f0-9]{24}_[A-Za-z0-9_-]+$/),
        token: {
          name: "Review assistant",
          owner: { id: "admin", name: "Ada Admin" },
          tokenPrefix: expect.stringMatching(/^wts_mcp_[a-f0-9]{8}$/),
          scopes: ["cfp:read"],
          status: "active",
        },
      },
      action: { status: "applied", replayed: false },
    });
    expect(replayed).toMatchObject({
      success: true,
      data: {
        credentialAvailable: false,
        token: { id: created.success ? created.data.token.id : "" },
      },
      action: { status: "applied", replayed: true },
    });
    if (replayed.success) expect(replayed.data).not.toHaveProperty("credential");
    expect(changed).toMatchObject({ success: false, code: "operation_mismatch" });
    expect(secretOperation).toMatchObject({ success: false, code: "validation" });
    expect(await store.list()).toHaveLength(1);

    const actions = await new AdminActions(actionStore).list({ targetCollection: "mcp_tokens" });
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      actorUserId: "admin",
      operationKind: "mcp_token.create",
      status: "applied",
      afterSummary: {
        ownerUserId: "admin",
        scopes: ["cfp:read"],
        expiresAt: "2026-08-01T23:59:59.999Z",
        tokenPrefix: expect.stringMatching(/^wts_mcp_[a-f0-9]{8}$/),
        createdByUserId: "admin",
      },
    });
    const serializedAction = JSON.stringify(actions[0]);
    expect(serializedAction).not.toContain(created.success ? created.data.credential : "wts_mcp_");
    expect(serializedAction).not.toMatch(/secret|hash|wts_mcp_[a-f0-9]{24}_/i);
  });

  it("retries an exact failed token action without duplicating credentials", async () => {
    const baseStore = createInMemoryMcpTokenAdministrationStore({
      users: [{ id: "admin", name: "Ada Admin", role: "admin" }],
    });
    let failFirstCreate = true;
    const store = {
      ...baseStore,
      async create(...args: Parameters<typeof baseStore.create>) {
        if (failFirstCreate) {
          failFirstCreate = false;
          throw new Error("Injected persistence failure.");
        }
        return baseStore.create(...args);
      },
    };
    const actionStore = createInMemoryAdminActionStore();
    const administration = new McpTokenAdministration(
      store,
      { userId: "admin", name: "Ada Admin" },
      new AdminActions(actionStore),
      { now: () => new Date("2026-07-13T12:00:00.000Z") },
    );
    const input = {
      name: "Retry client",
      scopes: ["programme:read"] as const,
      expires_at: "2026-08-01",
    };

    const failed = await administration.createToken(input, "retry-create");
    const retried = await administration.createToken(input, "retry-create");
    const replayed = await administration.createToken(input, "retry-create");

    expect(failed).toMatchObject({
      success: false,
      code: "operation_failed",
      action: { status: "failed" },
    });
    expect(retried).toMatchObject({
      success: true,
      data: { credentialAvailable: true },
      action: { replayed: false },
    });
    expect(replayed).toMatchObject({
      success: true,
      data: { credentialAvailable: false },
      action: { replayed: true },
    });
    expect(await store.list()).toHaveLength(1);
    const actions = await new AdminActions(actionStore).list({ targetCollection: "mcp_tokens" });
    expect(actions).toEqual([
      expect.objectContaining({ status: "applied", attemptCount: 2 }),
    ]);
  });

  it("returns the one-time credential when persistence commits before its response is lost", async () => {
    const baseStore = createInMemoryMcpTokenAdministrationStore({
      users: [{ id: "admin", name: "Ada Admin", role: "admin" }],
    });
    let loseFirstResponse = true;
    const store = {
      ...baseStore,
      async create(...args: Parameters<typeof baseStore.create>) {
        const record = await baseStore.create(...args);
        if (loseFirstResponse) {
          loseFirstResponse = false;
          throw new Error("Injected response loss after commit.");
        }
        return record;
      },
    };
    const administration = new McpTokenAdministration(
      store,
      { userId: "admin", name: "Ada Admin" },
      new AdminActions(createInMemoryAdminActionStore()),
      { now: () => new Date("2026-07-13T12:00:00.000Z") },
    );
    const input = {
      name: "Response-loss client",
      scopes: ["programme:read"] as const,
      expires_at: "2026-08-01",
    };

    const committed = await administration.createToken(input, "response-loss-create");
    const replayed = await administration.createToken(input, "response-loss-create");

    expect(committed).toMatchObject({
      success: true,
      data: {
        credentialAvailable: true,
        credential: expect.stringMatching(/^wts_mcp_/),
      },
      action: { replayed: false },
    });
    expect(replayed).toMatchObject({
      success: true,
      data: { credentialAvailable: false },
      action: { replayed: true },
    });
    expect(await store.list()).toHaveLength(1);
  });

  it("never returns stale attempt material after another lease owner applies creation", async () => {
    const baseStore = createInMemoryMcpTokenAdministrationStore({
      users: [{ id: "admin", name: "Ada Admin", role: "admin" }],
    });
    let releaseFirst!: () => void;
    const firstBlocked = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let firstEntered!: () => void;
    const firstStarted = new Promise<void>((resolve) => { firstEntered = resolve; });
    let createCalls = 0;
    const store = {
      ...baseStore,
      async create(...args: Parameters<typeof baseStore.create>) {
        createCalls += 1;
        if (createCalls === 1) {
          firstEntered();
          await firstBlocked;
          throw new Error("Stale attempt lost its lease.");
        }
        return baseStore.create(...args);
      },
    };
    let now = new Date("2026-07-13T12:00:00.000Z");
    const administration = new McpTokenAdministration(
      store,
      { userId: "admin", name: "Ada Admin" },
      new AdminActions(createInMemoryAdminActionStore(), { now: () => now, leaseMilliseconds: 100 }),
      { now: () => now },
    );
    const input = {
      name: "Lease race client",
      scopes: ["programme:read"] as const,
      expires_at: "2026-08-01",
    };

    const staleAttempt = administration.createToken(input, "lease-race-create");
    await firstStarted;
    now = new Date("2026-07-13T12:00:01.000Z");
    const winningAttempt = await administration.createToken(input, "lease-race-create");
    releaseFirst();
    const staleResult = await staleAttempt;

    expect(winningAttempt).toMatchObject({
      success: true,
      data: { credentialAvailable: true },
      action: { replayed: false },
    });
    expect(staleResult).toMatchObject({
      success: true,
      data: {
        credentialAvailable: false,
        token: { id: winningAttempt.success ? winningAttempt.data.token.id : "" },
      },
      action: { replayed: true },
    });
    if (staleResult.success) expect(staleResult.data).not.toHaveProperty("credential");
    expect(await store.list()).toHaveLength(1);
  });

  it("filters recent MCP activity by token, owner, status, operation, and target", async () => {
    const actionStore = createInMemoryAdminActionStore();
    const adminActions = new AdminActions(actionStore, {
      now: () => new Date("2026-07-13T12:00:00.000Z"),
    });
    const store = createInMemoryMcpTokenAdministrationStore({
      users: [
        { id: "owner-a", name: "Owner A", role: "admin" },
        { id: "owner-b", name: "Owner B", role: "admin" },
      ],
      tokens: [
        {
          id: "token-a",
          name: "Agent A",
          tokenPrefix: "wts_mcp_aaaaaaaa",
          scopes: ["programme:read"],
          ownerUserId: "owner-a",
          expiresAt: "2026-08-01T23:59:59.999Z",
          createdAt: "2026-07-01T10:00:00.000Z",
          updatedAt: "2026-07-01T10:00:00.000Z",
        },
        {
          id: "token-b",
          name: "Agent B",
          tokenPrefix: "wts_mcp_bbbbbbbb",
          scopes: ["cfp:read"],
          ownerUserId: "owner-b",
          expiresAt: "2026-08-01T23:59:59.999Z",
          createdAt: "2026-07-01T10:00:00.000Z",
          updatedAt: "2026-07-01T10:00:00.000Z",
        },
      ],
    });
    await adminActions.start({
      actorUserId: "owner-a",
      mcpTokenId: "token-a",
      source: "mcp",
      operationKind: "fixture.update",
      targetCollection: "fixture_targets",
      targetId: "target-a",
      operationId: "pending-fixture-update",
      normalizedInput: { id: "target-a" },
    });
    const failed = await adminActions.start({
      actorUserId: "owner-b",
      mcpTokenId: "token-b",
      source: "mcp",
      operationKind: "fixture.create",
      targetCollection: "fixture_targets",
      operationId: "failed-fixture-create",
      normalizedInput: { name: "Example" },
    });
    if (failed.outcome !== "started") throw new Error("Expected a started Admin Action.");
    await adminActions.fail(failed.handle, {
      code: "fixture_write_failed",
      message: "Fixture persistence failed safely.",
    });
    const administration = new McpTokenAdministration(
      store,
      { userId: "owner-b", name: "Owner B" },
      adminActions,
      { now: () => new Date("2026-07-13T12:00:00.000Z") },
    );
    for (let index = 0; index < 201; index += 1) {
      const unrelated = await adminActions.start({
        actorUserId: "owner-b",
        source: "admin_ui",
        operationKind: "unrelated.update",
        targetCollection: "unrelated_targets",
        targetId: `unrelated-${index}`,
        operationId: `unrelated-${index}`,
        normalizedInput: { index },
      });
      if (unrelated.outcome !== "started") throw new Error("Expected an unrelated Admin Action.");
      await adminActions.complete(unrelated.handle, {
        targetId: `unrelated-${index}`,
        beforeSummary: null,
        afterSummary: { index },
        replayResult: { index },
      });
    }

    expect(await administration.listActivity({ tokenId: "token-a" })).toEqual([
      expect.objectContaining({
        token: expect.objectContaining({ id: "token-a" }),
        owner: { id: "owner-a", name: "Owner A" },
        status: "pending",
      }),
    ]);
    expect(await administration.listActivity({ ownerUserId: "owner-b" })).toEqual([
      expect.objectContaining({ status: "failed", owner: { id: "owner-b", name: "Owner B" } }),
    ]);
    expect(await administration.listActivity({ statuses: ["failed"] })).toHaveLength(1);
    expect(await administration.listActivity({ operationKind: "fixture.update" })).toHaveLength(1);
    expect(await administration.listActivity({ targetCollection: "fixture_targets" })).toHaveLength(2);
    expect(await administration.listActivity({ targetId: "target-a" })).toHaveLength(1);
  });

  it("enforces team governance and audited mutations through PocketBase", { timeout: 40_000 }, async () => {
    const root = mkdtempSync(join(tmpdir(), "wts-mcp-governance-"));
    const migrationsDir = join(root, "pb_migrations");
    const hooksDir = join(root, "pb_hooks");
    const dataDir = join(root, "pb_data");
    mkdirSync(migrationsDir);
    mkdirSync(hooksDir);
    mkdirSync(dataDir);
    for (const hook of ["admin_action_ledger.pb.js", "mcp_token_administration.pb.js"]) {
      writeFileSync(
        join(hooksDir, hook),
        readFileSync(new URL(`../../pocketbase/pb_hooks/${hook}`, import.meta.url), "utf8"),
      );
    }
    for (const migration of [
      "1768850001_fix_user_role.js",
      "1783000000_create_mcp_tokens.js",
      "1787000004_create_admin_actions.js",
      "1787000005_migrate_mcp_token_scopes.js",
      "1787000006_govern_mcp_tokens.js",
    ]) {
      writeFileSync(
        join(migrationsDir, migration),
        readFileSync(new URL(`../../pocketbase/pb_migrations/${migration}`, import.meta.url), "utf8"),
      );
    }
    const binary = fileURLToPath(new URL("../../pocketbase/pocketbase", import.meta.url));
    const migrate = spawnSync(binary, [
      "migrate",
      "up",
      `--dir=${dataDir}`,
      `--migrationsDir=${migrationsDir}`,
      `--hooksDir=${hooksDir}`,
    ], { encoding: "utf8" });
    expect(migrate.status, `${migrate.stdout}\n${migrate.stderr}`).toBe(0);
    const superuserEmail = "mcp-governance@example.com";
    const superuserPassword = "mcp-governance-password";
    const superuser = spawnSync(binary, [
      "superuser",
      "create",
      superuserEmail,
      superuserPassword,
      `--dir=${dataDir}`,
      `--migrationsDir=${migrationsDir}`,
      `--hooksDir=${hooksDir}`,
      "--automigrate=false",
    ], { encoding: "utf8" });
    expect(superuser.status, `${superuser.stdout}\n${superuser.stderr}`).toBe(0);
    const port = await availablePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const server = spawn(binary, [
      "serve",
      `--http=127.0.0.1:${port}`,
      `--dir=${dataDir}`,
      `--migrationsDir=${migrationsDir}`,
      `--hooksDir=${hooksDir}`,
      "--automigrate=false",
      "--hooksWatch=false",
      "--dev",
    ], { stdio: ["ignore", "pipe", "pipe"] });
    let serverLogs = "";
    server.stdout.on("data", (chunk) => { serverLogs += String(chunk); });
    server.stderr.on("data", (chunk) => { serverLogs += String(chunk); });

    try {
      await waitForPocketBase(baseUrl).catch((error) => {
        throw new Error(`${error instanceof Error ? error.message : String(error)}\n${serverLogs}`);
      });
      const pb = new PocketBase(baseUrl);
      pb.autoCancellation(false);
      await pb.collection("_superusers").authWithPassword(superuserEmail, superuserPassword);
      const owner = await pb.collection("users").create({
        email: "token-owner@example.com",
        password: "token-owner-password",
        passwordConfirm: "token-owner-password",
        name: "Token Owner",
        role: "admin",
        verified: true,
      });
      const revoker = await pb.collection("users").create({
        email: "token-revoker@example.com",
        password: "token-revoker-password",
        passwordConfirm: "token-revoker-password",
        name: "Token Revoker",
        role: "admin",
        verified: true,
      });
      const tokenStore = createPocketBaseMcpTokenAdministrationStore(pb);
      const actions = new AdminActions(createPocketBaseAdminActionStore(pb));
      const ownerAdministration = new McpTokenAdministration(
        tokenStore,
        { userId: owner.id, name: owner.name },
        actions,
      );
      const created = await ownerAdministration.createToken({
        name: "Production MCP client",
        scopes: ["programme:read", "cfp:read"],
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      }, "production-create-token");
      expect(created, serverLogs).toMatchObject({
        success: true,
        data: { credentialAvailable: true, token: { owner: { id: owner.id } } },
      });
      if (!created.success) throw new Error(created.error);
      const replayed = await ownerAdministration.createToken({
        name: "Production MCP client",
        scopes: ["programme:read", "cfp:read"],
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      }, "production-create-token");
      expect(replayed).toMatchObject({ success: true, data: { credentialAvailable: false } });

      const revokerAdministration = new McpTokenAdministration(
        tokenStore,
        { userId: revoker.id, name: revoker.name },
        actions,
      );
      expect(await revokerAdministration.listTokens()).toEqual([
        expect.objectContaining({ id: created.data.token.id, owner: { id: owner.id, name: "Token Owner" } }),
      ]);
      await pb.collection("users").update(owner.id, { role: "user" });
      expect(await revokerAdministration.listTokens()).toEqual([
        expect.objectContaining({ id: created.data.token.id, status: "owner_disabled" }),
      ]);
      const revoked = await revokerAdministration.revokeToken(
        created.data.token.id,
        "Production cross-owner revocation test.",
        "production-revoke-token",
      );
      expect(revoked, serverLogs).toMatchObject({
        success: true,
        data: {
          token: {
            owner: { id: owner.id, name: "Token Owner" },
            revokedBy: { id: revoker.id, name: "Token Revoker" },
            revocationReason: "Production cross-owner revocation test.",
          },
        },
      });

      const ordinaryClient = new PocketBase(baseUrl);
      await ordinaryClient.collection("users").authWithPassword(
        "token-owner@example.com",
        "token-owner-password",
      );
      for (const request of [
        () => ordinaryClient.collection("mcp_tokens").getList(1, 10),
        () => ordinaryClient.collection("mcp_tokens").getOne(created.data.token.id),
        () => ordinaryClient.collection("mcp_tokens").create({ name: "Bypass" }),
        () => ordinaryClient.collection("mcp_tokens").update(created.data.token.id, { revoked_at: "" }),
        () => ordinaryClient.collection("mcp_tokens").delete(created.data.token.id),
      ]) {
        await expect(request()).rejects.toMatchObject({ status: expect.any(Number) });
      }
      const actionRecords = await pb.collection("admin_actions").getFullList({ sort: "created" });
      expect(actionRecords).toHaveLength(2);
      expect(JSON.stringify(actionRecords)).not.toContain(created.data.credential);
      expect(JSON.stringify(actionRecords)).not.toMatch(/secret_hash|bearer_token/i);
    } finally {
      server.kill("SIGTERM");
      await Promise.race([
        new Promise((resolve) => server.once("exit", resolve)),
        new Promise((resolve) => setTimeout(resolve, 1_000)),
      ]);
      rmSync(root, { recursive: true, force: true });
    }
  });

});
