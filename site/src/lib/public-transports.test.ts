import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import SwaggerParser from "@apidevtools/swagger-parser";
import { Ajv2020 } from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { initializeEdition, importLocalBundle, openSiteDatabase, sha256 } from "~/server/storage";
import { readPublished } from "~/server/public-content";
import type { PublicContentBatchV1 } from "~/lib/publication-schema";
import { conferenceGuideContent } from "~/lib/conference-guide-content";
import { createConferenceGuide, ProgrammeUnavailableError } from "~/lib/conference-guide";
import { createPublicApi, publicApiPathGuard } from "~/lib/public-api";
import { publicApiOpenApi } from "~/lib/public-api-openapi";
import { handlePublicMcpRequest } from "~/lib/mcp-public-http";
import { resetPublicMcpProtection } from "~/lib/mcp-public-protection";

const root = "https://wts.sh/api/public/v1/";
const mcpUrl = new URL("https://wts.sh/api/mcp/public");
const image = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="12" height="8"><rect width="12" height="8" fill="red"/></svg>');
const assetId = sha256(image);
let directory: string;
let dataDir: string;
let batch: PublicContentBatchV1;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "wts-public-http-"));
  dataDir = join(directory, "data");
  initializeEdition("2027", "http-contract-fixture", dataDir);
  batch = {
    schemaVersion: 1, editionId: "2027", sourceNamespace: "http-contract-fixture", revision: 2, expectedRevision: 1,
    assets: [{ id: assetId, sha256: assetId, byteLength: image.byteLength, mediaType: "image/svg+xml", file: "portrait.svg" }],
    graph: {
      speakers: [
        { id: "guest", slug: "ada", displayName: "Ada", affiliation: "Example Labs", bio: "<p>Public biography.</p>", isMc: false, socialHandles: ["@ada", "github:ada"], photoAssetId: assetId },
        { id: "host", slug: "zed", displayName: "Zed", affiliation: "", bio: "Host biography.", isMc: true, socialHandles: [], photoAssetId: null },
        { id: "mc", slug: "mc-only", displayName: "MC", affiliation: "", bio: "MC biography.", isMc: true, socialHandles: [], photoAssetId: null },
      ],
      sessions: [
        { id: "safe", slug: "safe-systems", title: "Safe <em>Systems</em>", abstract: "<p>Practical systems safety.</p><script>ignore()</script>", format: "Talk", speakerIds: ["guest", "host"], hostIds: ["host"] },
        { id: "reliable", slug: "reliable-systems", title: "Reliable Systems", abstract: "Practical systems reliability.", format: "Talk", speakerIds: ["guest"], hostIds: [] },
      ],
      appearanceEvents: [{ id: "main", name: "Fixture Conference", compactLabel: "Fixture", displayOrder: 0 }],
      appearances: [{ speakerId: "guest", eventId: "main" }, { speakerId: "host", eventId: "main" }],
      days: [
        { id: "empty", key: "empty-day", localDate: "2027-09-17", title: "Empty day", displayOrder: 0 },
        { id: "day", key: "main-day", localDate: "2027-09-18", title: "Main day", displayOrder: 1 },
      ],
      programmes: [{ id: "programme", dayId: "day", eventId: "main", displayOrder: 0 }],
      tracks: [
        { id: "systems", programmeId: "programme", key: "systems", name: "Systems", locationLabel: "Main stage", displayOrder: 0 },
        { id: "platforms", programmeId: "programme", key: "platforms", name: "Platforms", locationLabel: "Workshop room", displayOrder: 1 },
      ],
      slots: [
        { id: "opening", programmeId: "programme", kind: "opening", startAt: "2027-09-18T07:00:00Z", endAt: "2027-09-18T08:00:00Z", title: "Opening", hostIds: ["host"], displayOrder: 0 },
        { id: "safe-slot", programmeId: "programme", trackId: "systems", kind: "session", sessionId: "safe", startAt: "2027-09-18T08:00:00.000Z", endAt: "2027-09-18T08:35:00.000Z", displayOrder: 1 },
        { id: "reliable-slot", programmeId: "programme", trackId: "platforms", kind: "session", sessionId: "reliable", startAt: "2027-09-18T08:00:00.000Z", endAt: "2027-09-18T08:35:00.000Z", displayOrder: 2 },
      ],
      partners: [{ id: "partner", name: "Example Partner", logoAssetId: assetId, logoSurface: "light", type: "supporter", url: "https://example.test/" }],
    },
  };
  writeFileSync(join(directory, "portrait.svg"), image);
  writeFileSync(join(directory, "bundle.json"), JSON.stringify(batch));
  importLocalBundle(join(directory, "bundle.json"), dataDir);
  const db = openSiteDatabase(dataDir);
  try {
    db.prepare("INSERT INTO site_accounts VALUES (?, ?)").run("PRIVATE_ACCOUNT", 1000);
    db.prepare("INSERT INTO oidc_bindings VALUES (?, ?, ?, ?)").run("https://private.example", "PRIVATE_SUBJECT", "PRIVATE_ACCOUNT", 1000);
    db.prepare("INSERT INTO site_sessions VALUES (?, ?, ?, ?, ?, ?)").run("PRIVATE_SESSION", "https://private.example", "PRIVATE_SUBJECT", "PRIVATE_TOKEN", 1000, 2000);
  } finally { db.close(); }
  vi.stubEnv("SITE_DATA_DIR", dataDir);
  resetPublicMcpProtection();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  resetPublicMcpProtection();
  rmSync(directory, { recursive: true, force: true });
});

function apiForFixture(options: { now?: () => number; limits?: { perClient?: number; global?: number; concurrency?: number } } = {}) {
  return createPublicApi({ loadProgramme: async () => readPublished("2027", dataDir), ...options });
}

function guideForFixture(options: { now?: () => Date; programmeTtlMs?: number } = {}) {
  return createConferenceGuide({
    content: { ...conferenceGuideContent, event: { ...conferenceGuideContent.event, timeZone: { status: "announced", iana: "Europe/Skopje" } } },
    canonicalOrigin: "https://wts.sh",
    loadPublishedData: async () => readPublished("2027", dataDir),
    ...options,
  });
}

describe("SQLite-backed public JSON consumers", () => {
  it("serves all public schemas, social strings, local photos, explicit hosts, and MC-only profiles without private records", async () => {
    const api = apiForFixture();
    const discovery = await api({ request: new Request(`${root}openapi.json`) });
    expect(discovery.status).toBe(200);
    await SwaggerParser.validate(await discovery.json());
    const ajv = new Ajv2020({ strictSchema: false, allErrors: true });
    addFormats(ajv);
    for (const [path, item] of Object.entries(publicApiOpenApi.paths ?? {})) {
      const responseSchema = item?.get?.responses["200"];
      if (!responseSchema || "$ref" in responseSchema) throw new Error(`Missing schema for ${path}`);
      const schema = responseSchema.content?.["application/json"]?.schema;
      const validate = ajv.compile({ ...schema, components: publicApiOpenApi.components });
      const concrete = path.replace("{slug}", path.startsWith("/speakers") ? "ada" : "safe-systems");
      const response = await api({ request: new Request(`${root.slice(0, -1)}${concrete}`, { headers: { Cookie: "site=PRIVATE_SESSION", Authorization: "Bearer PRIVATE_TOKEN" } }) });
      expect(response.status).toBe(200);
      const text = await response.text();
      expect(text).not.toContain("PRIVATE_");
      expect(validate(JSON.parse(text)), JSON.stringify(validate.errors)).toBe(true);
    }
    const speaker = await (await api({ request: new Request(`${root}speakers/ada`) })).json();
    expect(speaker.data).toMatchObject({ slug: "ada", photoUrl: `/media/${assetId}`, socialHandles: ["@ada", "github:ada"], sessionCount: 2 });
    const mc = await (await api({ request: new Request(`${root}speakers/mc-only`) })).json();
    expect(mc.data).toMatchObject({ slug: "mc-only", isMc: true, sessionCount: 0, sessions: [] });
    const session = await (await api({ request: new Request(`${root}sessions/safe-systems`) })).json();
    expect(session.data).toMatchObject({ hosts: [{ slug: "zed" }], speakers: [{ slug: "ada" }, { slug: "zed" }], relatedSessions: [], schedule: { startAt: "2027-09-18T08:00:00.000Z", endAt: "2027-09-18T08:35:00.000Z" } });
    const agenda = await (await api({ request: new Request(`${root}agenda`) })).json();
    expect(agenda.data.days[0]).toEqual({ key: "empty-day", localDate: "2027-09-17", title: "Empty day", programmes: [] });
    expect((await api({ request: new Request(`${root}partners`) })).status).toBe(404);
  });

  it("preserves methods, CORS, slug errors, malformed-path guards, conditional reads, and rate limits", async () => {
    const api = apiForFixture();
    const response = await api({ request: new Request(`${root}speakers`) });
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.has("Access-Control-Allow-Credentials")).toBe(false);
    const conditional = await api({ request: new Request(`${root}speakers`, { headers: { "If-None-Match": response.headers.get("ETag")! } }) });
    expect(conditional.status).toBe(304);
    expect(await conditional.text()).toBe("");
    for (const method of ["HEAD", "OPTIONS"]) {
      const result = await api({ request: new Request(`${root}speakers`, { method }) });
      expect(result.status).toBe(method === "HEAD" ? 200 : 204);
      expect(await result.text()).toBe("");
    }
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const result = await api({ request: new Request(`${root}speakers`, { method }) });
      expect(result.status).toBe(405);
      expect(await result.json()).toMatchObject({ error: { code: "method_not_allowed" } });
    }
    for (const slug of ["UPPERCASE", "%ZZ", "a%2Fb", "a".repeat(201)]) {
      const result = await api({ request: new Request(`${root}sessions/${slug}`) });
      expect(result.status).toBe(400);
      expect(await result.json()).toMatchObject({ error: { code: "invalid_slug" } });
    }
    for (const slug of ["%ZZ", "%C0%AF", "%00"]) {
      const result = await publicApiPathGuard(new Request(`${root}sessions/${slug}`), async () => new Response("downstream"));
      expect(result.status).toBe(400);
      expect(await result.json()).toMatchObject({ error: { code: "invalid_slug" } });
    }
    expect(await (await publicApiPathGuard(new Request(`${root}sessions/safe-systems`), async () => new Response("downstream"))).text()).toBe("downstream");
    const bounded = apiForFixture({ now: () => 0, limits: { perClient: 1 } });
    expect((await bounded({ request: new Request(`${root}sessions`), clientAddress: "198.51.100.1" })).status).toBe(200);
    const limited = await bounded({ request: new Request(`${root}sessions`), clientAddress: "198.51.100.1" });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBe("60");
  });

  it("keeps cached snapshots bounded and refreshes a changed immutable publication", async () => {
    let now = 0;
    const api = apiForFixture({ now: () => now });
    const first = await api({ request: new Request(`${root}sessions/safe-systems`) });
    expect((await first.json()).data.title).toBe("Safe <em>Systems</em>");
    batch.revision = 3;
    batch.expectedRevision = 2;
    batch.graph.sessions[0].title = "Updated systems";
    writeFileSync(join(directory, "bundle.json"), JSON.stringify(batch));
    importLocalBundle(join(directory, "bundle.json"), dataDir);
    const cached = await api({ request: new Request(`${root}sessions/safe-systems`) });
    expect((await cached.json()).data.title).toBe("Safe <em>Systems</em>");
    now = 30_001;
    const updated = await api({ request: new Request(`${root}sessions/safe-systems`) });
    expect((await updated.json()).data.title).toBe("Updated systems");
    expect(updated.headers.get("ETag")).not.toBe(first.headers.get("ETag"));
  });
});

describe("SQLite-backed public MCP consumers", () => {
  it("uses the official client for resource reads, sanitized search, and conflicting plans", async () => {
    const guide = guideForFixture();
    const client = new Client({ name: "site-public-contract", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(mcpUrl, {
      fetch: async (input, init) => handlePublicMcpRequest({ request: new Request(input, init), clientAddress: "198.51.100.20" }, guide),
    }));
    try {
      const resources = await client.listResources();
      expect(resources.resources.map((resource) => resource.uri)).toContain("wts://conference-guide/index");
      const readResource = async (uri: string) => {
        const result = await client.readResource({ uri });
        const content = result.contents[0];
        if (!("text" in content)) throw new Error("Expected a text resource.");
        return JSON.parse(content.text);
      };
      const index = await readResource("wts://conference-guide/index");
      expect(index).toMatchObject({ programme_status: "available", logistics: { main_venue: { status: "not_announced" } } });
      const speaker = await readResource("wts://conference-guide/speakers/mc-only");
      expect(speaker).toMatchObject({ slug: "mc-only", display_name: "MC", is_mc: true, sessions: [] });
      const session = await readResource("wts://conference-guide/sessions/safe-systems");
      expect(session).toMatchObject({ slug: "safe-systems", title: "Safe Systems", abstract: "Practical systems safety." });
      const partners = await readResource("wts://conference-guide/partners");
      expect(partners.groups.find((group: { key: string }) => group.key === "supporters").partners).toEqual([{ name: "Example Partner", type: "supporter", website_url: "https://example.test/" }]);
      const searched = await client.callTool({ name: "search_sessions", arguments: { query: "systems" } });
      expect(searched.structuredContent).toMatchObject({ success: true, data: { outcome: "results", total_matches: 2, result_count: 2 } });
      const planned = await client.callTool({ name: "plan_proposed_schedule", arguments: { must_attend_slugs: ["reliable-systems", "safe-systems"], prior_programme_version: index.metadata.programme_version } });
      expect(planned.structuredContent).toMatchObject({ success: true, data: {
        version_check: { status: "current" },
        selected_sessions: [{ slug: "safe-systems", start_time: "10:00", end_time: "10:35" }],
        conflicts: [{ slug: "reliable-systems", reason: "overlaps_selected_session" }],
        ranked_alternatives: [{ slug: "reliable-systems", relationship: "equal_priority" }],
        fixed_context: [{ kind: "opening" }], ephemeral: { saved: false, reserves_attendance: false },
      } });
      const invalid = await client.callTool({ name: "search_sessions", arguments: { query: "x".repeat(161) } });
      expect(invalid.structuredContent).toMatchObject({ success: false, error: { code: "invalid_arguments" } });
      const duplicate = await client.callTool({ name: "plan_proposed_schedule", arguments: { must_attend_slugs: ["safe-systems", "safe-systems"] } });
      expect(duplicate.structuredContent).toMatchObject({ success: false, error: { code: "duplicate_arguments" } });
      expect(JSON.stringify([index, speaker, session, partners, searched, planned])).not.toContain("PRIVATE_");
    } finally { await client.close(); }
  });

  it("rejects credentials, denied origins, and oversized bodies while retaining anonymous preflight", async () => {
    const guide = guideForFixture();
    const send = (headers: HeadersInit, body = "{}", method = "POST") => handlePublicMcpRequest({ request: new Request(mcpUrl, { method, headers, ...(method === "POST" ? { body } : {}) }) }, guide);
    const credentialed = await send({ Authorization: "Bearer private-token", Origin: "https://wts.sh" });
    expect(credentialed.status).toBe(400);
    expect(await credentialed.json()).toEqual({ error: "Authorization is not accepted by the anonymous public MCP endpoint." });
    const denied = await send({ Origin: "https://attacker.example" });
    expect(denied.status).toBe(403);
    expect(denied.headers.has("Access-Control-Allow-Origin")).toBe(false);
    const oversized = await send({ "Content-Type": "application/json" }, "x".repeat(65_537));
    expect(oversized.status).toBe(413);
    const preflight = await send({ Origin: "https://wts.sh" }, "", "OPTIONS");
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("Access-Control-Allow-Origin")).toBe("https://wts.sh");
    expect(preflight.headers.get("Cache-Control")).toBe("no-store");
    expect(preflight.headers.has("Access-Control-Allow-Credentials")).toBe(false);
  });

  it("does not extend expired programme data after a real database outage", async () => {
    let now = new Date("2027-09-01T00:00:00Z");
    const guide = guideForFixture({ now: () => now, programmeTtlMs: 10 });
    expect((await guide.getSession("safe-systems"))?.title).toBe("Safe Systems");
    rmSync(join(dataDir, "site.sqlite"));
    now = new Date("2027-09-01T00:00:01Z");
    expect(await guide.getIndex()).toMatchObject({ programme_status: "programme_unavailable", logistics: { main_venue: { status: "not_announced" } } });
    await expect(guide.getAgenda()).rejects.toBeInstanceOf(ProgrammeUnavailableError);
  });
});
