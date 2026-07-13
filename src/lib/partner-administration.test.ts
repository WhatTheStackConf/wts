import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import PocketBase from "pocketbase";
import { describe, expect, it } from "vitest";
import { PartnerAdministration } from "~/lib/partner-administration";
import { createInMemoryPartnerAdministrationStore } from "~/lib/partner-administration-memory-store";
import { createPocketBasePartnerAdministrationStore } from "~/lib/partner-administration-store";

async function availablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not reserve a local Partner test port."));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

async function waitForPocketBase(url: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(`${url}/api/health`);
      if (response.ok) return;
    } catch {
      // PocketBase is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Disposable PocketBase did not start.");
}

describe("Partner Administration", () => {
  it("creates an incomplete Partner draft without a logo and reports what blocks publication", async () => {
    const administration = new PartnerAdministration(
      createInMemoryPartnerAdministrationStore(),
      "human_admin",
    );

    const result = await administration.createDraft({
      name: " Skopje Tech ",
      type: "community_partner",
      notes: " Non-sensitive organizer context ",
    });

    expect(result).toMatchObject({
      success: true,
      data: {
        partner: {
          name: "Skopje Tech",
          type: "community_partner",
          tier: undefined,
          logo: "",
          notes: "Non-sensitive organizer context",
          noteAgentVisible: false,
          published: false,
        },
        warnings: [],
        publication: {
          ready: false,
          issues: [{ field: "logo", message: "Upload an official Partner logo before publishing." }],
        },
      },
    });
  });

  it("requires one valid Sponsor tier and removes tiers from every non-Sponsor", async () => {
    const administration = new PartnerAdministration(
      createInMemoryPartnerAdministrationStore(),
      "human_admin",
    );

    await expect(administration.createDraft({ name: "Untiered", type: "sponsor" })).resolves.toEqual({
      success: false,
      code: "validation",
      error: "Choose a Sponsor tier.",
    });
    await expect(
      administration.createDraft({ name: "Invalid tier", type: "sponsor", tier: "diamond" as never }),
    ).resolves.toEqual({
      success: false,
      code: "validation",
      error: "Choose a valid Sponsor tier.",
    });

    const sponsor = await administration.createDraft({
      name: "Gold Sponsor",
      type: "sponsor",
      tier: "gold",
    });
    const supporter = await administration.createDraft({
      name: "Community Supporter",
      type: "supporter",
      tier: "gold",
    });

    expect(sponsor).toMatchObject({ success: true, data: { partner: { tier: "gold" } } });
    expect(supporter).toMatchObject({ success: true, data: { partner: { tier: undefined } } });
    for (const classification of [
      "organizer",
      "community_partner",
      "media",
      "catering",
      "other",
    ] as const) {
      const result = await administration.createDraft({
        name: `Canonical ${classification}`,
        type: classification,
      });
      expect(result).toMatchObject({
        success: true,
        data: { partner: { type: classification, tier: undefined } },
      });
    }
    await expect(
      administration.createDraft({ name: "Legacy", type: "company_supporter" as never }),
    ).resolves.toEqual({
      success: false,
      code: "validation",
      error: "Choose a valid Partner classification.",
    });
  });

  it("accepts only optional absolute HTTPS Partner URLs", async () => {
    const administration = new PartnerAdministration(
      createInMemoryPartnerAdministrationStore(),
      "human_admin",
    );

    for (const url of [
      "http://partner.example",
      "/partners/example",
      "not a url",
      "https://%zz",
      "https://partner.example\\path",
      "https://partner.example/naïve",
    ]) {
      await expect(
        administration.createDraft({ name: `Invalid ${url}`, type: "other", url }),
      ).resolves.toEqual({
        success: false,
        code: "validation",
        error: "Partner URL must be an absolute HTTPS URL.",
      });
    }

    const result = await administration.createDraft({
      name: "Secure Partner",
      type: "other",
      url: " https://Partner.Example/path?campaign=wts#about ",
    });

    expect(result).toMatchObject({
      success: true,
      data: { partner: { url: "https://Partner.Example/path?campaign=wts#about" } },
    });
  });

  it("blocks exact normalized-name and canonical full-URL duplicates during concurrent creates", async () => {
    const administration = new PartnerAdministration(
      createInMemoryPartnerAdministrationStore(),
      "human_admin",
    );

    const nameResults = await Promise.all([
      administration.createDraft({ name: "Acme   Labs", type: "supporter" }),
      administration.createDraft({ name: " acme labs ", type: "media" }),
    ]);

    expect(nameResults.filter((result) => result.success)).toHaveLength(1);
    expect(nameResults.find((result) => !result.success)).toMatchObject({
      success: false,
      code: "duplicate",
      field: "name",
      current: { name: "Acme Labs" },
    });

    const firstUrl = await administration.createDraft({
      name: "Original URL",
      type: "other",
      url: "https://Partner.Example/about#conference",
    });
    const duplicateUrl = await administration.createDraft({
      name: "Duplicate URL",
      type: "other",
      url: "https://partner.example/about#sponsor",
    });

    expect(firstUrl.success).toBe(true);
    expect(duplicateUrl).toMatchObject({
      success: false,
      code: "duplicate",
      field: "url",
      current: { name: "Original URL" },
    });

    const dotSegment = await administration.createDraft({
      name: "Dot Segment URL",
      type: "other",
      url: "https://partner.example/a/../canonical",
    });
    const canonicalPath = await administration.createDraft({
      name: "Canonical Path URL",
      type: "other",
      url: "https://partner.example/canonical",
    });
    expect(dotSegment.success).toBe(true);
    expect(canonicalPath).toMatchObject({ success: false, code: "duplicate", field: "url" });

    const encodedPath = await administration.createDraft({
      name: "Encoded Path URL",
      type: "other",
      url: "https://encoded.example/part%6eer",
    });
    const decodedPath = await administration.createDraft({
      name: "Decoded Path URL",
      type: "other",
      url: "https://encoded.example/partner",
    });
    expect(encodedPath.success).toBe(true);
    expect(decodedPath).toMatchObject({ success: false, code: "duplicate", field: "url" });

    const defaultPortAndDot = await administration.createDraft({
      name: "Default Port and Dot URL",
      type: "other",
      url: "https://default.example:0443/sponsors/.",
    });
    const canonicalDefaultPortAndDot = await administration.createDraft({
      name: "Canonical Default Port and Dot URL",
      type: "other",
      url: "https://default.example/sponsors/",
    });
    expect(defaultPortAndDot.success).toBe(true);
    expect(canonicalDefaultPortAndDot).toMatchObject({
      success: false,
      code: "duplicate",
      field: "url",
    });
  });

  it("returns fuzzy-name and shared-host similarities as non-blocking warnings", async () => {
    const administration = new PartnerAdministration(
      createInMemoryPartnerAdministrationStore(),
      "human_admin",
    );
    await administration.createDraft({
      name: "Open Source Initiative",
      type: "community_partner",
      url: "https://github.com/opensource",
    });

    const result = await administration.createDraft({
      name: "Open Source Initiativ",
      type: "supporter",
      url: "https://github.com/whatthestackconf",
    });

    expect(result).toMatchObject({
      success: true,
      data: {
        partner: { name: "Open Source Initiativ" },
        warnings: [
          {
            kind: "similar_name",
            partner: { name: "Open Source Initiative" },
          },
          {
            kind: "shared_host",
            partner: { name: "Open Source Initiative" },
          },
        ],
      },
    });
  });

  it("updates only allowlisted fields and distinguishes omitted values from explicit clears", async () => {
    const administration = new PartnerAdministration(
      createInMemoryPartnerAdministrationStore(),
      "human_admin",
    );
    const created = await administration.createDraft({
      name: "Draft Partner",
      type: "supporter",
      url: "https://partner.example",
      notes: "Review this context",
      logo: { name: "logo.svg", type: "image/svg+xml", data: [1, 2, 3] },
    });
    if (!created.success) throw new Error(created.error);

    const updated = await administration.updatePartner(
      created.data.partner.id,
      created.data.partner.version,
      { url: null, notes: null, logo: null },
    );

    expect(updated).toMatchObject({
      success: true,
      data: {
        partner: {
          name: "Draft Partner",
          type: "supporter",
          url: undefined,
          notes: undefined,
          logo: "",
        },
      },
    });

    await expect(
      administration.updatePartner(
        created.data.partner.id,
        created.data.partner.version,
        { published: true } as never,
      ),
    ).resolves.toMatchObject({
      success: false,
      code: "validation",
      error: "Partner patch contains fields that cannot be changed.",
    });
  });

  it("rejects stale and concurrent patches with a safe current snapshot", async () => {
    const administration = new PartnerAdministration(
      createInMemoryPartnerAdministrationStore(),
      "human_admin",
    );
    const created = await administration.createDraft({
      name: "Concurrent Partner",
      type: "supporter",
    });
    if (!created.success) throw new Error(created.error);

    const results = await Promise.all([
      administration.updatePartner(
        created.data.partner.id,
        created.data.partner.version,
        { notes: "First edit" },
      ),
      administration.updatePartner(
        created.data.partner.id,
        created.data.partner.version,
        { notes: "Second edit" },
      ),
    ]);

    expect(results.filter((result) => result.success)).toHaveLength(1);
    const stale = results.find((result) => !result.success);
    expect(stale).toMatchObject({
      success: false,
      code: "stale",
      current: {
        id: created.data.partner.id,
        name: "Concurrent Partner",
        notes: "First edit",
      },
    });
    expect(JSON.stringify(stale)).not.toContain("normalizedName");
    expect(JSON.stringify(stale)).not.toContain("canonicalUrl");
  });

  it("requires human Partner Note approval again after every note edit", async () => {
    const administration = new PartnerAdministration(
      createInMemoryPartnerAdministrationStore(),
      "human_admin",
    );
    const created = await administration.createDraft({
      name: "Noted Partner",
      type: "other",
      notes: "Reviewed non-sensitive context",
    });
    if (!created.success) throw new Error(created.error);

    const approved = await administration.setNoteApproval(
      created.data.partner.id,
      created.data.partner.version,
      true,
    );
    expect(approved).toMatchObject({
      success: true,
      data: { partner: { noteAgentVisible: true } },
    });
    if (!approved.success) throw new Error(approved.error);

    const edited = await administration.updatePartner(
      approved.data.partner.id,
      approved.data.partner.version,
      { notes: "Changed non-sensitive context" },
    );
    expect(edited).toMatchObject({
      success: true,
      data: { partner: { notes: "Changed non-sensitive context", noteAgentVisible: false } },
    });
    if (!edited.success) throw new Error(edited.error);

    const reapproved = await administration.setNoteApproval(
      edited.data.partner.id,
      edited.data.partner.version,
      true,
    );
    expect(reapproved).toMatchObject({
      success: true,
      data: { partner: { noteAgentVisible: true } },
    });

    const empty = await administration.createDraft({ name: "No Note", type: "other" });
    if (!empty.success) throw new Error(empty.error);
    await expect(
      administration.setNoteApproval(
        empty.data.partner.id,
        empty.data.partner.version,
        true,
      ),
    ).resolves.toMatchObject({
      success: false,
      code: "validation",
      error: "Add a Partner Note before approving agent visibility.",
    });
  });

  it("publishes only ready drafts and keeps Published Partners valid while humans edit them", async () => {
    const administration = new PartnerAdministration(
      createInMemoryPartnerAdministrationStore(),
      "human_admin",
    );
    const incomplete = await administration.createDraft({ name: "Incomplete", type: "other" });
    if (!incomplete.success) throw new Error(incomplete.error);

    await expect(
      administration.setPublication(
        incomplete.data.partner.id,
        incomplete.data.partner.version,
        true,
      ),
    ).resolves.toMatchObject({
      success: false,
      code: "publication_not_ready",
      current: { published: false },
      publication: {
        ready: false,
        issues: [{ field: "logo" }],
      },
    });

    const ready = await administration.createDraft({
      name: "Ready Partner",
      type: "sponsor",
      tier: "silver",
      url: "https://ready.example",
      logo: { name: "official.svg", type: "image/svg+xml", data: [1, 2, 3] },
    });
    if (!ready.success) throw new Error(ready.error);
    expect(ready.data.publication).toEqual({ ready: true, issues: [] });

    const published = await administration.setPublication(
      ready.data.partner.id,
      ready.data.partner.version,
      true,
    );
    expect(published).toMatchObject({ success: true, data: { partner: { published: true } } });
    if (!published.success) throw new Error(published.error);

    const edited = await administration.updatePartner(
      published.data.partner.id,
      published.data.partner.version,
      { name: "Ready Partner Updated" },
    );
    expect(edited).toMatchObject({
      success: true,
      data: { partner: { name: "Ready Partner Updated", published: true } },
    });
    if (!edited.success) throw new Error(edited.error);

    await expect(
      administration.updatePartner(edited.data.partner.id, edited.data.partner.version, {
        logo: null,
      }),
    ).resolves.toMatchObject({
      success: false,
      code: "publication_not_ready",
      current: { logo: "official.svg", published: true },
      publication: { issues: [{ field: "logo" }] },
    });
  });

  it("accepts only human-uploaded Partner logo file types and always creates a draft", async () => {
    const administration = new PartnerAdministration(
      createInMemoryPartnerAdministrationStore(),
      "human_admin",
    );

    await expect(
      administration.createDraft({
        name: "Bad Logo",
        type: "other",
        logo: { name: "logo.txt", type: "text/plain", data: [1] },
      }),
    ).resolves.toEqual({
      success: false,
      code: "validation",
      error: "Logo must be SVG, PNG, JPEG, WebP, or AVIF.",
    });

    const forcedDraft = await administration.createDraft({
      name: "Draft Only",
      type: "other",
      logo: { name: "logo.png", type: "image/png", data: [1] },
      published: true,
    } as never);
    expect(forcedDraft).toMatchObject({
      success: true,
      data: { partner: { published: false } },
    });
  });

  it("reserves logo provenance, note approval, and publication for human admins", async () => {
    const store = createInMemoryPartnerAdministrationStore();
    const humanAdministration = new PartnerAdministration(store, "human_admin");
    const agentAdministration = new PartnerAdministration(store, "agent");
    const logo = { name: "official.svg", type: "image/svg+xml", data: [1, 2, 3] };

    await expect(
      agentAdministration.createDraft({ name: "Agent Logo", type: "other", logo }),
    ).resolves.toEqual({
      success: false,
      code: "validation",
      error: "Only a human admin can upload an official Partner logo.",
    });

    const created = await humanAdministration.createDraft({
      name: "Human-reviewed Partner",
      type: "other",
      notes: "Non-sensitive context",
    });
    if (!created.success) throw new Error(created.error);
    await expect(agentAdministration.listPartners()).resolves.toMatchObject([
      { partner: { notes: undefined, noteAgentVisible: false } },
    ]);
    await expect(
      agentAdministration.deletePartner(created.data.partner.id, created.data.partner.version),
    ).resolves.toMatchObject({ success: false, code: "validation" });

    await expect(
      agentAdministration.updatePartner(created.data.partner.id, created.data.partner.version, {
        logo,
      }),
    ).resolves.toMatchObject({
      success: false,
      code: "validation",
      error: "Only a human admin can upload or remove an official Partner logo.",
    });

    const withLogo = await humanAdministration.updatePartner(
      created.data.partner.id,
      created.data.partner.version,
      { logo },
    );
    expect(withLogo).toMatchObject({ success: true, data: { publication: { ready: true } } });
    if (!withLogo.success) throw new Error(withLogo.error);

    await expect(
      agentAdministration.setNoteApproval(
        withLogo.data.partner.id,
        withLogo.data.partner.version,
        true,
      ),
    ).resolves.toMatchObject({ success: false, code: "validation" });
    await expect(
      agentAdministration.setPublication(
        withLogo.data.partner.id,
        withLogo.data.partner.version,
        true,
      ),
    ).resolves.toMatchObject({ success: false, code: "validation" });
    const approved = await humanAdministration.setNoteApproval(
      withLogo.data.partner.id,
      withLogo.data.partner.version,
      true,
    );
    expect(approved).toMatchObject({ success: true });
    if (!approved.success) throw new Error(approved.error);
    await expect(agentAdministration.listPartners()).resolves.toMatchObject([
      { partner: { notes: "Non-sensitive context", noteAgentVisible: true } },
    ]);
    const published = await humanAdministration.setPublication(
      approved.data.partner.id,
      approved.data.partner.version,
      true,
    );
    expect(published).toMatchObject({ success: true, data: { partner: { published: true } } });
    if (!published.success) throw new Error(published.error);
    await expect(
      agentAdministration.updatePartner(
        published.data.partner.id,
        published.data.partner.version,
        { notes: "Agent edit" },
      ),
    ).resolves.toMatchObject({ success: false, code: "validation" });
    await expect(
      agentAdministration.deletePartner(
        published.data.partner.id,
        published.data.partner.version,
      ),
    ).resolves.toMatchObject({ success: false, code: "validation" });
  });

  it("enforces the same lifecycle through the production PocketBase store adapter", { timeout: 20_000 }, async () => {
    const root = mkdtempSync(join(tmpdir(), "wts-partner-store-"));
    const migrationsDir = join(root, "pb_migrations");
    const hooksDir = join(root, "pb_hooks");
    const dataDir = join(root, "pb_data");
    mkdirSync(migrationsDir);
    mkdirSync(hooksDir);
    mkdirSync(dataDir);
    writeFileSync(
      join(hooksDir, "partner_administration.pb.js"),
      readFileSync(new URL("../../pocketbase/pb_hooks/partner_administration.pb.js", import.meta.url), "utf8"),
    );
    const binary = fileURLToPath(new URL("../../pocketbase/pocketbase", import.meta.url));
    for (const migration of [
      "1782000000_create_partners.js",
      "1782000001_remove_bank_partner_tier.js",
      "1787000000_normalize_partner_vocabulary.js",
      "1787000002_partner_draft_lifecycle.js",
    ]) {
      writeFileSync(
        join(migrationsDir, migration),
        readFileSync(new URL(`../../pocketbase/pb_migrations/${migration}`, import.meta.url), "utf8"),
      );
    }

    const migrate = spawnSync(binary, [
      "migrate",
      "up",
      `--dir=${dataDir}`,
      `--migrationsDir=${migrationsDir}`,
      `--hooksDir=${hooksDir}`,
    ], { encoding: "utf8" });
    expect(migrate.status, `${migrate.stdout}\n${migrate.stderr}`).toBe(0);
    const email = "partner-store@example.com";
    const password = "partner-store-password";
    const superuser = spawnSync(binary, [
      "superuser",
      "create",
      email,
      password,
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
    ], { stdio: "ignore" });

    try {
      await waitForPocketBase(baseUrl);
      const pb = new PocketBase(baseUrl);
      pb.autoCancellation(false);
      await pb.collection("_superusers").authWithPassword(email, password);
      const productionStore = createPocketBasePartnerAdministrationStore(pb);
      const administration = new PartnerAdministration(productionStore, "human_admin");

      const created = await administration.createDraft({
        name: "Production Adapter",
        type: "supporter",
      });
      expect(created).toMatchObject({
        success: true,
        data: { partner: { logo: "", published: false } },
      });
      if (!created.success) throw new Error(created.error);

      const withLogo = await administration.updatePartner(
        created.data.partner.id,
        created.data.partner.version,
        {
          logo: {
            name: "official.png",
            type: "image/png",
            data: Array.from(Buffer.from(
              "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
              "base64",
            )),
          },
        },
      );
      expect(withLogo).toMatchObject({
        success: true,
        data: { partner: { logo: expect.stringContaining("official") }, publication: { ready: true } },
      });
      if (!withLogo.success) throw new Error(withLogo.error);
      expect(withLogo.data.partner.updatedAt).not.toContain("|");
      expect(withLogo.data.partner.version).toContain("|");

      const duplicateCreates = await Promise.all([
        administration.createDraft({ name: "Production   Collision", type: "other" }),
        administration.createDraft({ name: " production collision ", type: "media" }),
      ]);
      expect(duplicateCreates.filter((result) => result.success)).toHaveLength(1);
      expect(duplicateCreates.find((result) => !result.success)).toMatchObject({
        success: false,
        code: "duplicate",
        field: "name",
      });

      const duplicateUrls = await Promise.all([
        administration.createDraft({
          name: "Production URL One",
          type: "other",
          url: "https://url.example/a/../partner",
        }),
        administration.createDraft({
          name: "Production URL Two",
          type: "media",
          url: "https://url.example/partner",
        }),
      ]);
      expect(duplicateUrls.filter((result) => result.success)).toHaveLength(1);
      expect(duplicateUrls.find((result) => !result.success)).toMatchObject({
        success: false,
        code: "duplicate",
        field: "url",
      });

      const updates = await Promise.all([
        administration.updatePartner(
          withLogo.data.partner.id,
          withLogo.data.partner.version,
          { notes: "First production edit" },
        ),
        administration.updatePartner(
          withLogo.data.partner.id,
          withLogo.data.partner.version,
          { notes: "Second production edit" },
        ),
      ]);
      expect(updates.filter((result) => result.success)).toHaveLength(1);
      expect(updates.find((result) => !result.success)).toMatchObject({
        success: false,
        code: "stale",
      });

      const deletable = await administration.createDraft({
        name: "Production Delete",
        type: "other",
      });
      if (!deletable.success) throw new Error(deletable.error);
      await expect(
        administration.deletePartner(
          deletable.data.partner.id,
          deletable.data.partner.version,
        ),
      ).resolves.toEqual({ success: true, data: { id: deletable.data.partner.id } });
    } finally {
      server.kill("SIGTERM");
      await new Promise((resolve) => server.once("exit", resolve));
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("lists review readiness and version-checks deletion through the module", async () => {
    const administration = new PartnerAdministration(
      createInMemoryPartnerAdministrationStore(),
      "human_admin",
    );
    const created = await administration.createDraft({ name: "Review Draft", type: "other" });
    if (!created.success) throw new Error(created.error);
    const edited = await administration.updatePartner(
      created.data.partner.id,
      created.data.partner.version,
      { notes: "Keep this" },
    );
    if (!edited.success) throw new Error(edited.error);

    await expect(administration.listPartners()).resolves.toMatchObject([
      {
        partner: { id: created.data.partner.id, name: "Review Draft" },
        publication: { ready: false, issues: [{ field: "logo" }] },
      },
    ]);
    await expect(
      administration.deletePartner(created.data.partner.id, created.data.partner.version),
    ).resolves.toMatchObject({ success: false, code: "stale", current: { notes: "Keep this" } });
    await expect(
      administration.deletePartner(edited.data.partner.id, edited.data.partner.version),
    ).resolves.toEqual({ success: true, data: { id: edited.data.partner.id } });
    await expect(administration.listPartners()).resolves.toEqual([]);
  });
});
