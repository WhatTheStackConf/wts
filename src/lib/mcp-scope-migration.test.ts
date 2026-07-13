import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("MCP scope migration", () => {
  it("expands every legacy grant without changing token validity metadata", { timeout: 20_000 }, () => {
    const root = mkdtempSync(join(tmpdir(), "wts-mcp-scope-migration-"));
    const migrationsDir = join(root, "pb_migrations");
    const dataDir = join(root, "pb_data");
    mkdirSync(migrationsDir);
    mkdirSync(dataDir);

    const copyMigration = (name: string) => {
      writeFileSync(
        join(migrationsDir, name),
        readFileSync(new URL(`../../pocketbase/pb_migrations/${name}`, import.meta.url), "utf8"),
      );
    };

    try {
      copyMigration("1783000000_create_mcp_tokens.js");
      copyMigration("1787000005_migrate_mcp_token_scopes.js");

      writeFileSync(join(migrationsDir, "1787000004_seed_legacy_mcp_tokens.js"), `
migrate((app) => {
  app.db().newQuery(\`
    INSERT INTO mcp_tokens (
      id, name, token_id, token_prefix, secret_hash, scopes, created_by,
      expires_at, revoked_at, revoked_by, last_used_at
    ) VALUES
      (
        'mcplegacy000001', 'Legacy active', 'aaaaaaaaaaaaaaaaaaaaaaaa',
        'wts_mcp_aaaaaaaa', 'hash-a', '["program:read","future:read"]',
        'adminuser000001', '2030-01-01 00:00:00.000Z', '', '',
        '2026-07-01 00:00:00.000Z'
      ),
      (
        'mcplegacy000002', 'Legacy revoked', 'bbbbbbbbbbbbbbbbbbbbbbbb',
        'wts_mcp_bbbbbbbb', 'hash-b', '["programme:read","program:read"]',
        'adminuser000002', '2029-01-01 00:00:00.000Z',
        '2026-06-01 00:00:00.000Z', 'adminuser000002', ''
      ),
      (
        'mcpprecise00001', 'Already precise', 'cccccccccccccccccccccccc',
        'wts_mcp_cccccccc', 'hash-c', '["cfp:read"]',
        'adminuser000003', '2028-01-01 00:00:00.000Z', '', '', ''
      );
  \`).execute();
}, () => {});
`);

      writeFileSync(join(migrationsDir, "1787000006_assert_mcp_scopes.js"), `
migrate((app) => {
  const assert = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  const active = app.findRecordById('mcp_tokens', 'mcplegacy000001');
  const revoked = app.findRecordById('mcp_tokens', 'mcplegacy000002');
  const precise = app.findRecordById('mcp_tokens', 'mcpprecise00001');

  assert(
    JSON.stringify(active.get('scopes')) === JSON.stringify(['programme:read', 'cfp:read', 'future:read']),
    'active legacy scopes were not expanded'
  );
  assert(
    JSON.stringify(revoked.get('scopes')) === JSON.stringify(['programme:read', 'cfp:read']),
    'legacy scopes were not deduplicated'
  );
  assert(
    JSON.stringify(precise.get('scopes')) === JSON.stringify(['cfp:read']),
    'precise scopes changed'
  );
  assert(active.getString('created_by') === 'adminuser000001', 'token owner changed');
  assert(active.getString('token_id') === 'aaaaaaaaaaaaaaaaaaaaaaaa', 'bearer token ID changed');
  assert(active.getString('secret_hash') === 'hash-a', 'bearer secret hash changed');
  assert(active.getString('token_prefix') === 'wts_mcp_aaaaaaaa', 'safe token prefix changed');
  assert(active.getString('expires_at') === '2030-01-01 00:00:00.000Z', 'expiry changed');
  assert(active.getString('last_used_at') === '2026-07-01 00:00:00.000Z', 'last-used date changed');
  assert(revoked.getString('revoked_at') === '2026-06-01 00:00:00.000Z', 'revocation changed');
  assert(revoked.getString('revoked_by') === 'adminuser000002', 'revoker changed');
}, () => {});
`);

      const result = spawnSync(
        fileURLToPath(new URL("../../pocketbase/pocketbase", import.meta.url)),
        ["migrate", "up", `--dir=${dataDir}`, `--migrationsDir=${migrationsDir}`],
        { cwd: root, encoding: "utf8" },
      );

      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
