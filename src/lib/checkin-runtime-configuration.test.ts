import { afterEach, expect, it, vi } from "vite-plus/test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as privateConfiguration from "../../runtime/checkin/private-configuration";
import { loadCoordinatorAdmission, loadCoordinatorProcessors } from "../../runtime/checkin/coordinator-configuration";
import { main } from "../../runtime/checkin/cli";
import { verifyCheckinSchema } from "../../runtime/checkin/schema-readiness";
import { startCheckinPocketBase } from "~/lib/checkin-pocketbase-test-helper";

const roots: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function privateConfig(value: unknown, mode = 0o600) {
  const root = mkdtempSync(join(tmpdir(), "wts-runtime-config-")); roots.push(root);
  const path = join(root, "credentials.json");
  writeFileSync(path, JSON.stringify(value), { mode });
  return path;
}
const apiKey = `${Buffer.from(JSON.stringify({ alg: "HS256" })).toString("base64url")}.${Buffer.from(JSON.stringify({ account_id: 7 })).toString("base64url")}.synthetic`;

it("loads a private server-only admission credential without sending any request", () => {
  const file = privateConfig({ apiUrl: "https://fixture.example.test/api", apiKey, accountId: "7" });
  expect(loadCoordinatorAdmission(file)?.isConfigured).toBe(true);
});
it("rejects misspelled coordinator keys before authentication or ownership", async () => {
  const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network forbidden in this test"));
  const credentials = privateConfig({ email: "fixture@example.test", password: "synthetic-only" });
  const file = privateConfig({ pocketbaseUrl: "http://127.0.0.1:1", superuserCredentialFile: credentials, admissionCredentialsFile: "/synthetic/misspelled-path" });
  await expect(main(["coordinator", file])).rejects.toThrow("invalid_config");
  expect(fetch).not.toHaveBeenCalled();
});
it.each([
  { apiUrl: "http://fixture.example.test/api", apiKey, accountId: "7" },
  { apiUrl: "https://fixture.example.test/api", apiKey, accountId: "8" },
  { apiUrl: "https://fixture.example.test/api", apiKey, accountId: "7", extra: "forbidden" },
  { apiUrl: "https://fixture.example.test/api", accountId: "7" },
])("rejects explicit invalid admission configuration rather than silently disabling the worker", value => {
  expect(() => loadCoordinatorAdmission(privateConfig(value))).toThrow("invalid_config");
});
it("rejects world-readable credential material and redacts failures", () => {
  const file = privateConfig({ apiUrl: "https://fixture.example.test/api", apiKey, accountId: "7" }, 0o644);
  expect(() => loadCoordinatorAdmission(file)).toThrow(/^invalid_config$/);
});
it.each(["profile_snapshot", "fulfillment_completed_at"])("verifies required print field %s before the coordinator can acquire ownership", { timeout: 30000 }, async fieldName => {
  const fixture = await startCheckinPocketBase();
  try {
    await expect(verifyCheckinSchema(fixture.pb)).resolves.toBeUndefined();
    const collection = await fixture.pb.collections.getOne("checkin_print_attempts");
    await fixture.pb.collections.update(collection.id, { fields: collection.fields.filter(field => field.name !== fieldName) });
    await expect(verifyCheckinSchema(fixture.pb)).rejects.toThrow("schema_incompatible");
    expect(await fixture.pb.collection("checkin_agent_attempts").getFullList()).toEqual([]);
  } finally { await fixture.cleanup(); }
});

it("reads the private upstream credential once for both production processors", () => {
  const file = privateConfig({ apiUrl: "https://fixture.example.test/api", apiKey, accountId: "7" });
  const read = vi.spyOn(privateConfiguration, "readPrivateObject");
  const processors = loadCoordinatorProcessors(file);
  expect(read).toHaveBeenCalledTimes(1);
  expect(read).toHaveBeenCalledWith(file);
  expect(processors.admission?.isConfigured).toBe(true);
  expect(processors.reset?.reset.length).toBe(2);
});
