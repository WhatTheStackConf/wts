import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  createAppearanceEvent,
  deleteAppearanceEvent,
  updateAppearanceEvent,
} from "~/lib/appearance-events-admin";

describe("Appearance Event administration", () => {
  it("backfills the main event for every existing published Speaker", { timeout: 20_000 }, () => {
    const root = mkdtempSync(join(tmpdir(), "wts-appearance-event-migration-"));
    const migrationsDir = join(root, "pb_migrations");
    const dataDir = join(root, "pb_data");
    mkdirSync(migrationsDir);
    mkdirSync(dataDir);

    try {
      writeFileSync(join(migrationsDir, "1788000002_seed_speakers.js"), `
migrate((app) => {
  const speakers = new Collection({
    name: 'speakers',
    type: 'base',
    fields: [
      { name: 'display_name', type: 'text', required: true },
      { name: 'published', type: 'bool', required: false },
    ],
  });
  app.save(speakers);

  app.save(new Record(speakers, {
    id: 'pubspeaker00001',
    display_name: 'Published Speaker',
    published: true,
  }));
  app.save(new Record(speakers, {
    id: 'draftspeaker001',
    display_name: 'Draft Speaker',
    published: false,
  }));
}, () => {});
`);
      writeFileSync(
        join(migrationsDir, "1788000003_create_appearance_events.js"),
        readFileSync(
          new URL("../../pocketbase/pb_migrations/1788000003_create_appearance_events.js", import.meta.url),
          "utf8",
        ),
      );
      writeFileSync(join(migrationsDir, "1788000004_assert_appearance_backfill.js"), `
migrate((app) => {
  const mainEvent = app.findRecordById('appearance_events', 'wts2026appevent');
  const published = app.findRecordById('speakers', 'pubspeaker00001');
  const draft = app.findRecordById('speakers', 'draftspeaker001');
  if (!published.getStringSlice('appearance_events').includes(mainEvent.id)) {
    throw new Error('published Speaker did not receive the main Appearance Event');
  }
  if (draft.getStringSlice('appearance_events').length > 0) {
    throw new Error('draft Speaker unexpectedly received the main Appearance Event');
  }
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

  it("creates a normalized Appearance Event catalogue entry", async () => {
    const service = {
      fetchAllRecords: vi.fn(),
      createRecord: vi.fn().mockImplementation((_collection, body) =>
        Promise.resolve({ id: "event-1", ...body }),
      ),
      updateRecord: vi.fn(),
      deleteRecord: vi.fn(),
    };

    const event = await createAppearanceEvent(service, {
      name: "  WhatTheStack 2026  ",
      compactLabel: "  WTS 2026  ",
      published: true,
      displayOrder: 1,
      destinationUrl: "  https://wts.sh  ",
    });

    expect(service.createRecord).toHaveBeenCalledWith("appearance_events", {
      name: "WhatTheStack 2026",
      compact_label: "WTS 2026",
      published: true,
      display_order: 1,
      destination_url: "https://wts.sh",
    });
    expect(event).toMatchObject({
      id: "event-1",
      name: "WhatTheStack 2026",
      compact_label: "WTS 2026",
    });
  });

  it("refuses to delete an Appearance Event assigned to a Speaker", async () => {
    const service = {
      fetchAllRecords: vi.fn().mockResolvedValue([{ id: "speaker-1" }]),
      createRecord: vi.fn(),
      updateRecord: vi.fn(),
      deleteRecord: vi.fn(),
    };

    await expect(deleteAppearanceEvent(service, "event-1")).rejects.toThrow(
      "Remove its Speaker assignments or unpublish it instead.",
    );
    expect(service.fetchAllRecords).toHaveBeenCalledWith("speakers", {
      filter: 'appearance_events.id ?= "event-1"',
      fields: "id",
    });
    expect(service.deleteRecord).not.toHaveBeenCalled();
  });

  it("updates an Appearance Event and deletes it once unassigned", async () => {
    const service = {
      fetchAllRecords: vi.fn().mockResolvedValue([]),
      createRecord: vi.fn(),
      updateRecord: vi.fn().mockImplementation((_collection, id, body) =>
        Promise.resolve({ id, ...body }),
      ),
      deleteRecord: vi.fn().mockResolvedValue(true),
    };

    await updateAppearanceEvent(service, "event-1", {
      name: "Community Warmup",
      compactLabel: "",
      published: false,
      displayOrder: 2,
      destinationUrl: "",
    });
    await deleteAppearanceEvent(service, "event-1");

    expect(service.updateRecord).toHaveBeenCalledWith("appearance_events", "event-1", {
      name: "Community Warmup",
      compact_label: "",
      published: false,
      display_order: 2,
      destination_url: "",
    });
    expect(service.deleteRecord).toHaveBeenCalledWith("appearance_events", "event-1");
  });

  it("refuses to delete an Appearance Event used by an Event Programme", async () => {
    const service = {
      fetchAllRecords: vi.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: "programme-1" }]),
      createRecord: vi.fn(),
      updateRecord: vi.fn(),
      deleteRecord: vi.fn(),
    };

    await expect(deleteAppearanceEvent(service, "event-1")).rejects.toThrow(
      "Remove its Event Programmes or unpublish it instead.",
    );
    expect(service.fetchAllRecords).toHaveBeenLastCalledWith("event_programmes", {
      filter: 'appearance_event = "event-1"',
      fields: "id",
    });
    expect(service.deleteRecord).not.toHaveBeenCalled();
  });
});
