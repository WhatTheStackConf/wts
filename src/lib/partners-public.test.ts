import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildPublicPartnerGroups } from "~/lib/partners-public-data";
import type { PartnerRecord } from "~/lib/pocketbase-types";

function partner(overrides: Partial<PartnerRecord>): PartnerRecord {
  return {
    id: "partner-1",
    name: "Partner",
    published: true,
    type: "supporter",
    logo: "logo.png",
    ...overrides,
  } as PartnerRecord;
}

describe("public partner groups", () => {
  it("groups canonical Supporters and Community Partners without autodate fields", () => {
    const groups = buildPublicPartnerGroups([
      partner({ id: "game-of-codes", name: "Game of Codes", type: "supporter" }),
      partner({ id: "zurich-js", name: "ZurichJS", type: "community_partner" }),
      partner({ id: "a11y-collective", name: "A11y Collective", type: "community_partner" }),
    ]);

    expect(groups.find((group) => group.id === "supporters")?.partners.map((item) => item.name)).toEqual([
      "Game of Codes",
    ]);
    expect(groups.find((group) => group.id === "community-partners")?.partners.map((item) => item.name)).toEqual([
      "A11y Collective",
      "ZurichJS",
    ]);
  });

  it("projects only Published Partner fields and excludes Partner Notes", () => {
    const groups = buildPublicPartnerGroups([
      partner({
        id: "published-supporter",
        name: "Published Supporter",
        type: "supporter",
        notes: "Private Partner Note",
        url: "https://supporter.example",
      }),
      partner({
        id: "draft-supporter",
        name: "Draft Supporter",
        type: "supporter",
        published: false,
        notes: "Private draft Partner Note",
      }),
    ]);

    expect(groups.find((group) => group.id === "supporters")?.partners).toEqual([
      {
        name: "Published Supporter",
        logoUrl: "",
        url: "https://supporter.example",
        type: "supporter",
        tier: undefined,
      },
    ]);
    expect(JSON.stringify(groups)).not.toContain("Partner Note");
    expect(JSON.stringify(groups)).not.toContain("published-supporter");
  });

  it("places every canonical classification in exactly one public group", () => {
    const groups = buildPublicPartnerGroups([
      partner({ id: "organizer", name: "Organizer", type: "organizer" }),
      partner({ id: "sponsor", name: "Sponsor", type: "sponsor", tier: "gold" }),
      partner({ id: "supporter", name: "Supporter", type: "supporter" }),
      partner({ id: "community", name: "Community", type: "community_partner" }),
      partner({ id: "media", name: "Media", type: "media" }),
      partner({ id: "catering", name: "Catering", type: "catering" }),
      partner({ id: "other", name: "Other", type: "other" }),
    ]);

    expect(groups.some((group) => group.id === "sponsors")).toBe(false);
    expect(Object.fromEntries(groups.map((group) => [group.id, group.partners.map((item) => item.name)]))).toMatchObject({
      organizers: ["Organizer"],
      "gold-sponsors": ["Sponsor"],
      supporters: ["Supporter"],
      "community-partners": ["Community"],
      "media-partners": ["Media"],
      "bytes-and-beverages": ["Catering"],
      "other-partners": ["Other"],
    });
    expect(groups.flatMap((group) => group.partners)).toHaveLength(7);
  });
});

describe("Partner vocabulary migration", () => {
  it("preserves valid Partners and repairs every legacy record shape", { timeout: 20_000 }, () => {
    const root = mkdtempSync(join(tmpdir(), "wts-partner-migration-"));
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
      copyMigration("1782000000_create_partners.js");
      copyMigration("1782000001_remove_bank_partner_tier.js");
      copyMigration("1787000000_normalize_partner_vocabulary.js");

      writeFileSync(join(migrationsDir, "1786500000_seed_legacy_partners.js"), `
migrate((app) => {
  app.db().newQuery(\`
    INSERT INTO partners (id, name, published, type, tier, logo, url, description) VALUES
      ('p00000000000001', 'Legacy Community', 1, 'supporter', 'gold', 'logo.svg', 'https://community.example/path', '<p>Community context</p>'),
      ('p00000000000002', 'Legacy Supporter', 1, 'company_supporter', '', 'logo.svg', 'https://supporter.example', 'Supporter context'),
      ('p00000000000003', 'Untiered Sponsor', 1, 'sponsor', '', 'logo.svg', 'https://untiered.example', ''),
      ('p00000000000004', 'Tiered Organizer', 1, 'organizer', 'silver', 'logo.svg', 'https://organizer.example', ''),
      ('p00000000000005', 'Gold Sponsor', 1, 'sponsor', 'gold', 'logo.svg', 'https://sponsor.example', ''),
      ('p00000000000006', 'Malformed Community', 1, 'supporter', '', 'logo.svg', 'not a url', ''),
      ('p00000000000007', 'HTTP Catering', 1, 'catering', '', 'logo.svg', 'http://catering.example', ''),
      ('p00000000000008', 'No URL Partner', 1, 'other', '', 'logo.svg', '', ''),
      ('p00000000000009', 'Malformed IPv6', 1, 'media', '', 'logo.svg', 'https://[::::]', ''),
      ('p00000000000010', 'Malformed Port', 1, 'media', '', 'logo.svg', 'https://partner.example:99999', '');
  \`).execute();
}, () => {});
`);

      writeFileSync(join(migrationsDir, "1787000001_assert_normalized_partners.js"), `
migrate((app) => {
  const assert = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  const partner = (id) => app.findRecordById('partners', id);
  const collection = app.findCollectionByNameOrId('partners');
  const type = collection.fields.getByName('type');

  assert(JSON.stringify(type.values) === JSON.stringify([
    'organizer', 'sponsor', 'supporter', 'community_partner', 'media', 'catering', 'other'
  ]), 'Partner classifications were not normalized');
  assert(collection.fields.getByName('notes'), 'notes field is missing');
  assert(!collection.fields.getByName('description'), 'description field still exists');
  assert(collection.listRule === null && collection.viewRule === null, 'Partner Notes remain publicly readable');

  assert(partner('p00000000000001').getString('type') === 'community_partner', 'legacy Community Partner was not converted');
  assert(partner('p00000000000001').getString('tier') === '', 'non-Sponsor tier was not cleared');
  assert(partner('p00000000000001').getString('notes') === '<p>Community context</p>', 'Partner Note markup was not preserved');
  assert(partner('p00000000000002').getString('type') === 'supporter', 'legacy Supporter was not converted');
  assert(partner('p00000000000002').getString('notes') === 'Supporter context', 'Partner Note text was not preserved');
  assert(partner('p00000000000003').getString('type') === 'supporter', 'untiered Sponsor was not converted');
  assert(partner('p00000000000004').getString('tier') === '', 'Organizer tier was not cleared');
  assert(partner('p00000000000005').getString('type') === 'sponsor' && partner('p00000000000005').getString('tier') === 'gold', 'valid Sponsor changed');

  for (const id of ['p00000000000001', 'p00000000000002', 'p00000000000003', 'p00000000000004', 'p00000000000005', 'p00000000000008']) {
    assert(partner(id).getBool('published'), 'valid Published Partner was demoted: ' + id);
  }
  assert(!partner('p00000000000006').getBool('published'), 'malformed URL remained Published');
  assert(partner('p00000000000006').getString('type') === 'community_partner', 'malformed legacy Community Partner was not converted');
  assert(partner('p00000000000006').getString('url') === 'not a url', 'malformed URL was rewritten');
  assert(!partner('p00000000000007').getBool('published'), 'HTTP URL remained Published');
  assert(partner('p00000000000007').getString('url') === 'http://catering.example', 'HTTP URL was rewritten');
  assert(!partner('p00000000000009').getBool('published'), 'malformed IPv6 URL remained Published');
  assert(partner('p00000000000009').getString('url') === 'https://[::::]', 'malformed IPv6 URL was rewritten');
  assert(!partner('p00000000000010').getBool('published'), 'out-of-range URL port remained Published');
  assert(partner('p00000000000010').getString('url') === 'https://partner.example:99999', 'out-of-range URL port was rewritten');
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
