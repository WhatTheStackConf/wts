import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("reviewer hardening migration", () => {
  it("defaults new OAuth accounts to the user role", () => {
    const source = readFileSync(
      new URL("../../pocketbase/pb_hooks/users_role_guard.pb.js", import.meta.url),
      "utf8",
    );
    expect(source).toContain("onRecordAuthWithOAuth2Request");
    expect(source).toMatch(/e\.isNewRecord[\s\S]+e\.createData\.role = "user"/);
  });

  it("repairs legacy users and keeps the newest duplicate review", { timeout: 20_000 }, () => {
    const root = mkdtempSync(join(tmpdir(), "wts-reviewer-migration-"));
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
      for (const migration of [
        "1735401500_create_cfp_applicants.js",
        "1735401600_create_cfp_submissions.js",
        "1768850000_roles_and_reviews.js",
        "1768850001_fix_user_role.js",
        "1768850002_create_cfp_weight_votes.js",
        "1768850003_restrict_admin_writes.js",
        "1776000002_add_cfp_submissions_status.js",
        "1777000000_harden_auth_and_reviewer_rules.js",
        "1777000001_fix_users_role_update_rule.js",
        "1781000000_fix_registration_role_escalation.js",
      ]) copyMigration(migration);

      writeFileSync(join(migrationsDir, "1787000006_seed_duplicate_reviews.js"), `
migrate((app) => {
  const legacyUser = new Record(app.findCollectionByNameOrId('users'));
  legacyUser.set('email', 'legacy-user@example.test');
  legacyUser.set('verified', true);
  legacyUser.set('role', 'user');
  legacyUser.setPassword('temporary-password');
  app.save(legacyUser);

  app.db().newQuery(\`
    INSERT INTO cfp_reviews (id, submission, reviewer, created, updated)
    VALUES
      ('reviewdupold001', 'submission00001', 'reviewer0000001',
       '2026-07-01 00:00:00.000Z', '2026-07-01 00:00:00.000Z'),
      ('reviewdupnew001', 'submission00001', 'reviewer0000001',
       '2026-07-02 00:00:00.000Z', '2026-07-02 00:00:00.000Z');
  \`).execute();
}, () => {});
`);
      copyMigration("1787000007_harden_reviewer_ownership.js");
      const migrate = () => spawnSync(
        fileURLToPath(new URL("../../pocketbase/pocketbase", import.meta.url)),
        ["migrate", "up", `--dir=${dataDir}`, `--migrationsDir=${migrationsDir}`],
        { cwd: root, encoding: "utf8" },
      );
      const initial = migrate();
      expect(initial.status, `${initial.stdout}\n${initial.stderr}`).toBe(0);

      writeFileSync(join(migrationsDir, "1787000008_seed_empty_user_role.js"), `
migrate((app) => {
  app.db().newQuery(
    "UPDATE users SET role = '' WHERE email = 'legacy-user@example.test'"
  ).execute();
  const seededUser = new DynamicModel({ role: 'user' });
  app.db().newQuery(
    "SELECT role FROM users WHERE email = 'legacy-user@example.test'"
  ).one(seededUser);
  if (seededUser.role !== '') throw new Error('empty user role fixture was not created');
}, () => {});
`);
      copyMigration("1787000009_backfill_empty_user_roles.js");
      writeFileSync(join(migrationsDir, "1787000010_assert_hardening_migrations.js"), `
migrate((app) => {
  const legacyUser = new DynamicModel({ role: '' });
  app.db().newQuery(
    "SELECT role FROM users WHERE email = 'legacy-user@example.test'"
  ).one(legacyUser);
  if (legacyUser.role !== 'user') {
    throw new Error('legacy user role was not repaired');
  }

  const records = app.findAllRecords('cfp_reviews');
  if (records.length !== 1 || records[0].getString('id') !== 'reviewdupnew001') {
    throw new Error('legacy review duplicates were not resolved deterministically');
  }
}, () => {});
`);

      const result = migrate();
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
