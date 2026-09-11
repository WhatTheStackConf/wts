import { expect, it } from "vite-plus/test";
import { setup, ready, context } from "./checkin-recovery-test-helper";
import { CheckinRecoveryService } from "./checkin-recovery-service";
import { handleCheckinRecoveryRequest } from "./checkin-recovery-http";
import { recoveryPreviewSchema } from "./checkin-recovery-client-contract";
import sharp from "sharp";
it("real PocketBase recovery HTTP authorizes once, previews real Cyrillic PNG, scopes and redacts", async () => {
  const t = await setup(); const runtime = await ready(t); await runtime.coordinator.listen();
  try {
    await runtime.heartbeat();
    const reserved = await t.service.preflight(t.token, { ...t.command(), context: await context(t) });
    if (reserved.state !== "reserved") throw new Error("Expected reservation");
    await runtime.coordinator.processAdmissions({ attendee: async () => ({ upstreamAttendeeId: "501", publicId: "A-ABC1234", productId: "401", alreadyCheckedIn: false }), admit: async () => ({ state: "uncertain" }) });
    const source = { reconcile: async () => ({ state: "existing" as const, checkinId: "901", fingerprint: "d".repeat(64) }) };
    const http = (body: unknown, admin = false, token = t.token) => handleCheckinRecoveryRequest(new Request("https://wts.test/api/checkin-recovery", { method: "POST", headers: { origin: "https://wts.test", "content-type": "application/json", cookie: `wts_checkin_client=${token}` }, body: JSON.stringify(body) }), { authenticate: async () => ({ id: admin ? t.admin.actor.userId : t.operator.actor.userId, role: admin ? "admin" : "checkin_operator" }), service: async actor => new CheckinRecoveryService(t.pb, { userId: actor.id, role: actor.role }, source) });
    const workflowId = reserved.workflow.id;
    const evidence = await http({ operation: "reconcile", workflowId }, true); expect(evidence.status).toBe(200); const read = await evidence.json();
    const command = { operation: "authorize_initial", workflowId, operationId: crypto.randomUUID(), expectedVersion: 0, reason: "incident", note: "", readId: read.id };
    expect((await http({ operation: "command", command })).status).toBe(403);
    const first = await http({ operation: "command", command }, true); expect(first.status).toBe(200);
    const replay = await http({ operation: "command", command }, true); expect(await replay.json()).toEqual({ ...await first.json(), replayed: true });
    expect(await t.pb.collection("checkin_print_attempts").getFullList()).toHaveLength(1);
    const rendered = await http({ operation: "preview", workflowId, name: "Ѓорѓи Ќќ", affiliation: "" }); expect(rendered.status).toBe(200);
    const png = recoveryPreviewSchema.parse(await rendered.json()); const metadata = await sharp(Buffer.from(png.pngBase64, "base64")).metadata(); expect(metadata.format).toBe("png"); expect(metadata.width).toBe(png.width); expect(png.rows[1].text).toBe("");
    const own = await http({ operation: "get", workflowId }); const projection = await own.json(); expect(projection.reads).toEqual([]); expect(projection.admissionAttempts).toEqual([]); expect(JSON.stringify(projection)).not.toContain("A-ABC1234");
    expect((await http({ operation: "get", workflowId }, false, "e".repeat(64))).status).toBe(403);
  } finally { await runtime.coordinator.close(); await t.cleanup(); }
}, 60000);
