import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import PocketBase from "pocketbase";
import { describe, expect, it } from "vitest";

async function availablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not reserve a PocketBase test port."));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

async function waitForPocketBase(url: string): Promise<void> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(250) });
      if (response.ok) return;
    } catch {
      // Disposable PocketBase is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Disposable PocketBase did not start.");
}

async function stop(server: ChildProcess): Promise<void> {
  server.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => server.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 1_000)),
  ]);
}

describe("reviewer PocketBase isolation", () => {
  it("enforces role, review, and weight-vote ownership on a disposable database", { timeout: 60_000 }, async () => {
    const root = mkdtempSync(join(tmpdir(), "wts-reviewer-security-"));
    const migrationsDir = join(root, "pb_migrations");
    const hooksDir = join(root, "pb_hooks");
    const dataDir = join(root, "pb_data");
    mkdirSync(migrationsDir);
    mkdirSync(hooksDir);
    mkdirSync(dataDir);

    const migrationNames = [
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
      "1787000007_harden_reviewer_ownership.js",
    ];
    for (const migration of migrationNames) {
      writeFileSync(
        join(migrationsDir, migration),
        readFileSync(new URL(`../../pocketbase/pb_migrations/${migration}`, import.meta.url), "utf8"),
      );
    }
    writeFileSync(
      join(hooksDir, "users_role_guard.pb.js"),
      readFileSync(new URL("../../pocketbase/pb_hooks/users_role_guard.pb.js", import.meta.url), "utf8"),
    );

    const binary = fileURLToPath(new URL("../../pocketbase/pocketbase", import.meta.url));
    const migrateArgs = [
      `--dir=${dataDir}`,
      `--migrationsDir=${migrationsDir}`,
      `--hooksDir=${hooksDir}`,
    ];
    const migrate = spawnSync(binary, ["migrate", "up", ...migrateArgs], { encoding: "utf8" });
    expect(migrate.status, `${migrate.stdout}\n${migrate.stderr}`).toBe(0);

    const superuserEmail = "reviewer-security-superuser@example.test";
    const temporaryPassword = "Test-only-not-a-secret-2026!";
    const superuser = spawnSync(binary, [
      "superuser",
      "create",
      superuserEmail,
      temporaryPassword,
      ...migrateArgs,
      "--automigrate=false",
    ], { encoding: "utf8" });
    expect(superuser.status, `${superuser.stdout}\n${superuser.stderr}`).toBe(0);

    const port = await availablePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const startServer = () => spawn(binary, [
      "serve",
      `--http=127.0.0.1:${port}`,
      ...migrateArgs,
      "--automigrate=false",
      "--hooksWatch=false",
      "--dev",
    ], { stdio: ["ignore", "pipe", "pipe"] });
    let server = startServer();
    let serverLogs = "";
    server.stdout?.on("data", (chunk) => { serverLogs += String(chunk); });
    server.stderr?.on("data", (chunk) => { serverLogs += String(chunk); });

    try {
      await waitForPocketBase(baseUrl).catch((error) => {
        throw new Error(`${error instanceof Error ? error.message : String(error)}\n${serverLogs}`);
      });
      const rootClient = new PocketBase(baseUrl);
      rootClient.autoCancellation(false);
      await rootClient.collection("_superusers").authWithPassword(superuserEmail, temporaryPassword);

      const publicClient = new PocketBase(baseUrl);
      await expect(publicClient.collection("users").create({
        email: "forged-admin@example.test",
        password: temporaryPassword,
        passwordConfirm: temporaryPassword,
        name: "Forged Admin",
        role: "admin",
      })).rejects.toMatchObject({ status: expect.any(Number) });
      const registered = await publicClient.collection("users").create({
        email: "ordinary-registration@example.test",
        password: temporaryPassword,
        passwordConfirm: temporaryPassword,
        name: "Ordinary Registration",
      });
      expect(registered.role).toBe("user");

      const ordinary = await rootClient.collection("users").create({
        email: "ordinary-user@example.test",
        password: temporaryPassword,
        passwordConfirm: temporaryPassword,
        name: "Ordinary User",
        role: "user",
        verified: true,
      });
      const reviewerA = await rootClient.collection("users").create({
        email: "reviewer-a@example.test",
        password: temporaryPassword,
        passwordConfirm: temporaryPassword,
        name: "Reviewer A",
        role: "reviewer",
        verified: true,
      });
      const reviewerB = await rootClient.collection("users").create({
        email: "reviewer-b@example.test",
        password: temporaryPassword,
        passwordConfirm: temporaryPassword,
        name: "Reviewer B",
        role: "reviewer",
        verified: true,
      });
      const admin = await rootClient.collection("users").create({
        email: "admin-user@example.test",
        password: temporaryPassword,
        passwordConfirm: temporaryPassword,
        name: "Admin User",
        role: "admin",
        verified: true,
      });
      const applicant = await rootClient.collection("cfp_applicants").create({
        affiliation: "Test Organization",
        bio: "Test bio",
        user: ordinary.id,
      });
      const submission = await rootClient.collection("cfp_submissions").create({
        session_title: "Disposable security test",
        abstract: "Abstract",
        key_takeaways: "Takeaways",
        applicant: applicant.id,
      });

      const ordinaryClient = new PocketBase(baseUrl);
      await ordinaryClient.collection("users").authWithPassword("ordinary-user@example.test", temporaryPassword);
      await expect(ordinaryClient.collection("users").update(ordinary.id, { role: "admin" }))
        .rejects.toMatchObject({ status: expect.any(Number) });
      const renamed = await ordinaryClient.collection("users").update(ordinary.id, { name: "Renamed User" });
      expect(renamed).toMatchObject({ name: "Renamed User", role: "user" });
      const avatar = new FormData();
      const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
      avatar.set("avatar", new File([png], "avatar.png", { type: "image/png" }));
      const withAvatar = await ordinaryClient.collection("users").update(ordinary.id, avatar);
      expect(withAvatar.avatar).toMatch(/\.png$/);
      expect(withAvatar.role).toBe("user");

      const reviewerAClient = new PocketBase(baseUrl);
      const reviewerBClient = new PocketBase(baseUrl);
      const adminClient = new PocketBase(baseUrl);
      await reviewerAClient.collection("users").authWithPassword("reviewer-a@example.test", temporaryPassword);
      await reviewerBClient.collection("users").authWithPassword("reviewer-b@example.test", temporaryPassword);
      await adminClient.collection("users").authWithPassword("admin-user@example.test", temporaryPassword);

      const reviewPayload = {
        submission: submission.id,
        score_relevance: 3,
        score_originality: 3,
        score_depth: 3,
        score_clarity: 3,
        score_takeaways: 3,
        score_engagement: 3,
        notes: "Private review",
        is_llm_suspected: false,
      };
      await expect(reviewerAClient.collection("cfp_reviews").create({
        ...reviewPayload,
        reviewer: reviewerB.id,
      })).rejects.toMatchObject({ status: expect.any(Number) });
      const ownReview = await reviewerAClient.collection("cfp_reviews").create({
        ...reviewPayload,
        reviewer: reviewerA.id,
      });
      await expect(reviewerAClient.collection("cfp_reviews").create({
        ...reviewPayload,
        reviewer: reviewerA.id,
      })).rejects.toMatchObject({ status: expect.any(Number) });
      await expect(reviewerAClient.collection("cfp_reviews").update(ownReview.id, { reviewer: reviewerB.id }))
        .rejects.toMatchObject({ status: expect.any(Number) });
      await rootClient.collection("cfp_submissions").update(submission.id, { status: "accepted" });
      await expect(reviewerAClient.collection("cfp_reviews").getOne(ownReview.id))
        .rejects.toMatchObject({ status: expect.any(Number) });
      await expect(reviewerAClient.collection("cfp_reviews").update(ownReview.id, { notes: "Too late" }))
        .rejects.toMatchObject({ status: expect.any(Number) });

      const votePayload = {
        relevance: 1,
        originality: 2,
        depth: 3,
        clarity: 4,
        takeaways: 5,
        engagement: 6,
      };
      await expect(reviewerAClient.collection("cfp_weight_votes").create({
        ...votePayload,
        user: reviewerB.id,
      })).rejects.toMatchObject({ status: expect.any(Number) });
      const voteA = await reviewerAClient.collection("cfp_weight_votes").create({
        ...votePayload,
        user: reviewerA.id,
      });
      const voteB = await reviewerBClient.collection("cfp_weight_votes").create({
        ...votePayload,
        user: reviewerB.id,
      });
      expect(await reviewerAClient.collection("cfp_weight_votes").getFullList())
        .toEqual([expect.objectContaining({ id: voteA.id, user: reviewerA.id })]);
      await expect(reviewerAClient.collection("cfp_weight_votes").getOne(voteB.id))
        .rejects.toMatchObject({ status: expect.any(Number) });
      await expect(reviewerAClient.collection("cfp_weight_votes").update(voteA.id, { user: reviewerB.id }))
        .rejects.toMatchObject({ status: expect.any(Number) });
      expect(await adminClient.collection("cfp_weight_votes").getFullList()).toHaveLength(2);
      await expect(adminClient.collection("cfp_weight_votes").create({ ...votePayload, user: admin.id }))
        .rejects.toMatchObject({ status: expect.any(Number) });
      await expect(adminClient.collection("cfp_weight_votes").update(voteA.id, { relevance: 6 }))
        .rejects.toMatchObject({ status: expect.any(Number) });
      await expect(adminClient.collection("cfp_weight_votes").delete(voteA.id))
        .rejects.toMatchObject({ status: expect.any(Number) });

      await stop(server);
      const down = spawnSync(binary, ["migrate", "down", "1", ...migrateArgs], { encoding: "utf8" });
      expect(down.status, `${down.stdout}\n${down.stderr}`).toBe(0);
      const up = spawnSync(binary, ["migrate", "up", ...migrateArgs], { encoding: "utf8" });
      expect(up.status, `${up.stdout}\n${up.stderr}`).toBe(0);
      server = startServer();
      await waitForPocketBase(baseUrl);
      const verifyClient = new PocketBase(baseUrl);
      await verifyClient.collection("_superusers").authWithPassword(superuserEmail, temporaryPassword);
      expect(await verifyClient.collection("cfp_weight_votes").getFullList()).toHaveLength(2);
    } finally {
      if (server.exitCode === null) await stop(server);
      rmSync(root, { recursive: true, force: true });
    }
  });
});
