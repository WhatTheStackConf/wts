import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";

const binary = process.env.WTS_MC_TEST_POCKETBASE || fileURLToPath(new URL("../../pocketbase/pocketbase", import.meta.url));
const migration = readFileSync(new URL("../../pocketbase/pb_migrations/1790000017_add_speaker_mc.js", import.meta.url), "utf8");

function fixture(initialField?: { type: string; required?: boolean; hidden?: boolean }) {
  const root = mkdtempSync(join(tmpdir(), "wts-speaker-mc-"));
  const migrations = join(root, "pb_migrations");
  mkdirSync(migrations);
  const args = [`--dir=${join(root, "pb_data")}`, `--migrationsDir=${migrations}`, `--hooksDir=${join(root, "pb_hooks")}`];
  // Real speaker/session schema, with only its prerequisite CFP collection.
  for (const name of ["1735401500_create_cfp_applicants.js", "1776000000_create_speakers_and_sessions.js"]) {
    writeFileSync(join(migrations, name), readFileSync(new URL(`../../pocketbase/pb_migrations/${name}`, import.meta.url)));
  }
  writeFileSync(join(migrations, "1790000016_fixture.js"), `migrate((app) => {
    const speakers = app.findCollectionByNameOrId("speakers");
    ${initialField ? `speakers.fields.add(new Field(${JSON.stringify({ name: "is_mc", ...initialField })})); app.save(speakers);` : ""}
    const speaker = new Record(speakers); speaker.set("slug", "host"); speaker.set("origin", "invite"); speaker.set("published", true);
    ${initialField ? `speaker.set("is_mc", ${initialField.type === "text" ? '"legacy-value"' : "true"});` : ""}
    app.save(speaker);
    const sessions = app.findCollectionByNameOrId("sessions");
    for (let i = 0; i < 27; i++) {
      const session = new Record(sessions); session.set("slug", "talk-" + i); session.set("title", "Talk " + i);
      session.set("abstract", "Public abstract"); session.set("published", true); session.set("speakers", [speaker.id]); app.save(session);
    }
  });`);
  return {
    root, migrations,
    run: (...command: string[]) => spawnSync(binary, [...command, ...args], { encoding: "utf8", timeout: 30_000 }),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function succeeds(result: { status: number | null; stdout: string; stderr: string }) {
  expect(`${result.stdout}\n${result.stderr}`).not.toMatch(/Error:|Failed|ReferenceError|TypeError/);
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
}

describe("additive MC migration", () => {
  it.each([false, true])("retains records and 27 real Session relations, including schema-first=%s", (preexisting) => {
    expect(spawnSync(binary, ["--version"], { encoding: "utf8" }).stdout.trim()).toMatch(/ version 0\.(30\.4|34\.0)$/);
    const f = fixture(preexisting ? { type: "bool", required: false, hidden: false } : undefined);
    try {
      succeeds(f.run("migrate", "up"));
      writeFileSync(join(f.migrations, "1790000017_add_speaker_mc.js"), migration);
      succeeds(f.run("migrate", "up"));
      // Execute the up handler twice, not just the already-applied migration ledger.
      writeFileSync(join(f.migrations, "1790000018_repeat_mc.js"), migration);
      writeFileSync(join(f.migrations, "1790000019_assert_mc.js"), `migrate((app) => {
        const collection = app.findCollectionByNameOrId("speakers");
        const fields = JSON.parse(JSON.stringify(collection.fields));
        const fieldsMc = fields.filter((f) => f.name === "is_mc");
        if (fieldsMc.length !== 1 || collection.fields.getByName("is_mc").type() !== "bool" || fieldsMc[0].required || fieldsMc[0].hidden) throw new Error("Wrong MC field");
        const speaker = app.findFirstRecordByFilter("speakers", "slug = 'host'");
        if (speaker.getBool("is_mc") !== ${preexisting}) throw new Error("MC value was lost or default is not false");
        const sessions = app.findRecordsByFilter("sessions", "", "slug", 100, 0);
        if (sessions.length !== 27) throw new Error("Session count changed");
        for (const session of sessions) {
          if (!session.getBool("published") || session.getStringSlice("speakers").join() !== speaker.id || session.getString("abstract") !== "Public abstract") throw new Error("Session content changed");
        }
        speaker.set("is_mc", true); app.save(speaker);
        if (!app.findRecordById("speakers", speaker.id).getBool("is_mc")) throw new Error("MC write failed");
        speaker.set("is_mc", false); app.save(speaker);
        if (app.findRecordById("speakers", speaker.id).getBool("is_mc")) throw new Error("Cannot clear MC");
      });`);
      succeeds(f.run("migrate", "up"));
      succeeds(f.run("migrate", "up"));
    } finally { f.cleanup(); }
  });

  it.each([{ type: "text" }, { type: "bool", required: true }, { type: "bool", hidden: true }])("rejects incompatible existing field %j without replacing it", (field) => {
    const f = fixture(field);
    try {
      succeeds(f.run("migrate", "up"));
      writeFileSync(join(f.migrations, "1790000017_add_speaker_mc.js"), migration);
      const result = f.run("migrate", "up");
      // PB 0.34 CLI reports migration errors in output even with exit status 0.
      expect(`${result.stdout} ${result.stderr}`).toContain("speakers.is_mc must be an optional, public bool field");
    } finally { f.cleanup(); }
  });
});
