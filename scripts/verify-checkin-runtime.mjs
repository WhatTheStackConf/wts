import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { verifyRuntimeManifest } from "./package-checkin-runtime.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = await verifyRuntimeManifest(root);
const runtime = relative => import(pathToFileURL(join(root, ".output/checkin-runtime", relative)).href);
// Importing CLI does not invoke main. This validates native dependencies without opening USB.
await runtime("runtime/checkin/cli.js");
const { AgentJournal } = await runtime("runtime/checkin/journal.js");
const { renderNameLabel, SYNTHETIC_LABEL_CONFIG: config } = await runtime("src/lib/checkin-label-renderer.js");
const rendered = await renderNameLabel({
  text: { name: "Ѓорѓи Željko", affiliation: "Runtime verification" },
  profile: { id: "verify-profile", stationId: "wts2026station1", version: 1, approval: "unapproved", config }, mode: "preview",
  expected: { profileId: "verify-profile", profileVersion: 1, printerRef: config.printerRef, stockRef: config.stockRef, rendererVersion: config.rendererVersion, fontVersion: config.fontVersion },
});
assert.deepEqual([rendered.width, rendered.height], [600, 360]);
const temporary = await mkdtemp(join(tmpdir(), "wts-runtime-verify-"));
try {
  const path = join(temporary, "journal.sqlite");
  const identity = { stationId: "wts2026station1", agentIdentity: "runtime-verify", printerIdentity: "no-physical-printer", journalIdentity: "disposable-verify", profileId: "" };
  AgentJournal.provision(path, identity);
  const journal = new AgentJournal(path, identity);
  const first = journal.heartbeat(); journal.close();
  const reopened = new AgentJournal(path, identity);
  try { assert.deepEqual(reopened.snapshot(), first); } finally { reopened.close(); }
} finally { await rm(temporary, { recursive: true, force: true }); }
console.log(JSON.stringify({ status: "runtime_verified", artifactDigest: manifest.artifactDigest, node: process.version, platform: process.platform, architecture: process.arch, syntheticRaster: true, journalReopen: true, physicalDeviceOpened: false, networkContacted: false }));
