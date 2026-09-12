import { createServer, type Socket } from "node:net";
import { expect, it } from "vite-plus/test";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import type { MonitoringMail, MonitoringOutcome } from "~/lib/checkin-monitoring-contract";
import { createHash } from "node:crypto";
import { startCheckinPocketBase } from "~/lib/checkin-pocketbase-test-helper";
import { CheckinMonitoringService } from "~/lib/checkin-monitoring-service";
import { CheckinMonitoringWorker } from "~/lib/checkin-monitoring-worker";
import { CheckinAgentService } from "~/lib/checkin-agent-service";

it("persists a single unavailability incident and sends only to designated admins across competing ticks and restart", async () => {
  const f = await startCheckinPocketBase();
  try {
    const admin = await f.user("admin");
    const ignored = await f.user("admin");
    const service = new CheckinMonitoringService(f.pb, admin.actor);
    await service.configure({ operationId: crypto.randomUUID(), expectedVersion: 1, recipientUserIds: [admin.record.id], waitingMs: 30000, incidentMs: 60000, repeatMs: 900000 });
    let now = Date.now();
    const sent: unknown[] = [];
    const readReadiness = async () => (await new CheckinAgentService(f.pb, admin.actor).adminList()).stations;
    const worker = () => new CheckinMonitoringWorker(f.pb, { now: () => now, readReadiness, transport: async (mail) => { sent.push(mail); return "sent"; } });
    await worker().tick();
    expect((await service.dashboard()).incidents).toHaveLength(0);
    now += 59999; await worker().tick();
    expect(sent).toHaveLength(0);
    now++; await Promise.all([worker().tick(), worker().tick()]);
    expect(sent).toHaveLength(3);
    expect(JSON.stringify(sent)).toContain(admin.record.email);
    expect(JSON.stringify(sent)).not.toContain(ignored.record.email);
    const ids = (await service.dashboard()).incidents.map((i) => i.id);
    await f.restart(); await worker().tick();
    expect((await service.dashboard()).incidents.map((i) => i.id)).toEqual(ids);
    expect(sent).toHaveLength(3);
  } finally { await f.cleanup(); }
});

it("discards a readiness read begun before a newer unready observation without recovery or a new hidden period", async () => {
  const f = await fixture();
  try {
    await f.service.configure(f.command);
    let release!: () => void;
    let reading!: () => void;
    const started = new Promise<void>((resolve) => { reading = resolve; });
    const held = new Promise<void>((resolve) => { release = resolve; });
    const stale = new CheckinMonitoringWorker(f.pb, { now: f.clock, readReadiness: async () => {
      const ready = await f.readReadiness(); reading(); await held; return ready;
    } });
    const pending = stale.observe(); await started;
    f.readiness(false); await f.worker().observe();
    f.advance(60000); await f.worker().observe();
    const before = (await f.service.dashboard()).incidents;
    expect(before).toHaveLength(3);
    release(); expect(await pending).toEqual({ observed: false });
    expect((await f.service.dashboard()).incidents).toEqual(before);
    await f.worker().tick();
    expect(f.mail).toHaveLength(3);
    expect(f.mail.every((m) => m.kind === "open")).toBe(true);
    expect((await f.service.dashboard()).incidents.map((i) => i.id)).toEqual(before.map((i) => i.id));
  } finally { await f.cleanup(); }
});

it("fences observation replay and orders workers by database sequence rather than client clocks", async () => {
  const f = await fixture();
  try {
    const request = <T,>(operation: string, data: object = {}) => f.pb.send<T>("/api/wts/checkin-monitoring", { method: "POST", body: { operation, nowMs: f.clock(), ...data }, requestKey: null });
    const a = await request<{ observationSequence: number }>("machine_observe_begin", { nowMs: f.clock() + 900000 });
    const b = await request<{ observationSequence: number }>("machine_observe_begin");
    const readiness = (await f.readReadiness()).map((s) => ({ stationId: s.stationId, readyForAuthorization: false }));
    expect(b.observationSequence).toBe(a.observationSequence + 1);
    expect(await request("machine_tick", { ...b, readiness })).toEqual({ observed: true });
    const before = await f.pb.collection("checkin_monitoring_incidents").getFullList();
    await f.restart();
    expect(await request("machine_tick", { ...b, readiness, nowMs: f.clock() + 60000 })).toEqual({ observed: true });
    expect(await f.pb.collection("checkin_monitoring_incidents").getFullList()).toEqual(before);
    await expect(request("machine_tick", { ...b, readiness: readiness.map((s) => ({ ...s, readyForAuthorization: true })) })).rejects.toThrow();
    expect(await request("machine_tick", { ...a, readiness, nowMs: f.clock() + 1800000 })).toEqual({ observed: false });
    await expect(request("machine_tick", { readiness })).rejects.toThrow();
  } finally { await f.cleanup(); }
});

it("paginates active workflows and prints without false recovery, and returns a real bounded dashboard continuation", async () => {
  const f = await fixture();
  try {
    // More than two input/result pages, plus inert history that must not be scanned.
    for (let n = 0; n < 105; n++) {
      const suffix = String(n).padStart(6, "0");
      f.workflow("workflowa" + suffix, "admission_uncertain");
      f.workflow("workflowb" + suffix, "accepted");
      f.sql("INSERT INTO checkin_print_attempts (id,workflow_id,station_id,purpose,state) VALUES (?,?,?,?,?)", "printtest" + suffix, "workflowb" + suffix, "wts2026station1", "initial", "uncertain");
    }
    for (let n = 0; n < 120; n++) f.workflow("historicw" + String(n).padStart(6, "0"), "rejected");
    await f.worker().observe();
    const page = (offset: number) => f.service.dashboard(undefined, offset);
    const first = await page(0), second = await page(100), third = await page(200), end = await page(210);
    expect(first.incidents).toHaveLength(100); expect(first.hasMore).toBe(true);
    expect(second.incidents).toHaveLength(100); expect(second.hasMore).toBe(true);
    expect(third.incidents).toHaveLength(10); expect(third.hasMore).toBe(false);
    expect(end.incidents).toHaveLength(0); expect(end.hasMore).toBe(false);
    expect(first.audit).toHaveLength(100);
    const all = [...first.incidents, ...second.incidents, ...third.incidents];
    expect(new Set(all.map((i) => i.id)).size).toBe(210);
    await f.worker().observe();
    expect([...(await page(0)).incidents, ...(await page(100)).incidents, ...(await page(200)).incidents]).toEqual(all);
    f.sql("UPDATE checkin_arrival_workflows SET state = 'rejected' WHERE state = 'admission_uncertain'");
    f.sql("UPDATE checkin_print_attempts SET state = 'completed' WHERE state = 'uncertain'");
    await f.worker().observe();
    const recovered = [...(await page(0)).incidents, ...(await page(100)).incidents, ...(await page(200)).incidents];
    expect(recovered).toHaveLength(210);
    expect(recovered.every((i) => i.recoveredMs > 0 && i.deliveryKind === "recovery")).toBe(true);
    const logs = f.logs().split("\n").filter((line) => /SELECT .* FROM `checkin_(arrival_workflows|print_attempts|monitoring_incidents|monitoring_deliveries|monitoring_audit)`/.test(line));
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.filter((line) => !/LIMIT (1|100|101)(?:\s|$)/.test(line))).toEqual([]);
    const db = new DatabaseSync(join(f.root, "pb_data", "data.db"));
    try {
      for (const table of ["checkin_arrival_workflows", "checkin_print_attempts"]) {
        const query = logs.find((line) => line.includes(`FROM \`${table}\``) && line.includes("LIMIT 100"))!;
        const plan = db.prepare("EXPLAIN QUERY PLAN " + query.slice(query.indexOf("SELECT"))).all();
        expect(JSON.stringify(plan)).toMatch(/idx_monitoring_(workflows|prints)_active/);
      }
    } finally { db.close(); }
  } finally { await f.cleanup(); }
  // Includes fixture migrations, hundreds of persisted rows and three complete
  // observation passes; allow hosted CI I/O without weakening query assertions.
}, 15_000);

/** A loopback-only SMTP sink, not an alternate worker transport. */
async function smtpSink() {
  const messages: string[] = [], recipients: string[] = [];
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket); socket.on("close", () => sockets.delete(socket));
    socket.setEncoding("utf8"); socket.write("220 localhost test-only SMTP\r\n");
    let buffer = "", data = false, message: string[] = [];
    socket.on("data", (chunk) => {
      buffer += chunk;
      while (buffer.includes("\r\n")) {
        const boundary = buffer.indexOf("\r\n"), line = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
        if (data) {
          if (line === ".") { messages.push(message.join("\r\n")); message = []; data = false; socket.write("250 accepted\r\n"); }
          else message.push(line.replace(/^\.\./, "."));
        } else if (/^(EHLO|HELO) /i.test(line)) socket.write("250 localhost\r\n");
        else if (/^RCPT TO:/i.test(line)) { recipients.push(line); socket.write("250 ok\r\n"); }
        else if (line === "DATA") { data = true; socket.write("354 end with dot\r\n"); }
        else if (line === "QUIT") socket.end("221 bye\r\n");
        else socket.write("250 ok\r\n");
      }
    });
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing loopback SMTP port");
  return { port: address.port, messages, recipients, close: async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve, reject) => server.close((e) => e ? reject(e) : resolve()));
  } };
}

it("uses the default PocketBase mailer against loopback SMTP once, shares the envelope format, and revalidates recipients", async () => {
  const sink = await smtpSink(); const f = await fixture();
  try {
    expect(new URL(f.baseUrl).hostname).toBe("127.0.0.1");
    await f.pb.settings.update({ meta: { senderName: "Monitoring test", senderAddress: "monitor@example.test" }, smtp: { enabled: true, host: "127.0.0.1", port: sink.port, username: "", password: "", tls: false, authMethod: "PLAIN" } });
    expect((await f.pb.settings.getAll()).smtp).toMatchObject({ enabled: true, host: "127.0.0.1", port: sink.port });
    await f.service.configure(f.command); f.workflow("testworkflow001", "admission_uncertain");
    const worker = new CheckinMonitoringWorker(f.pb, { now: f.clock, readReadiness: f.readReadiness });
    await worker.observe();
    expect(await worker.deliver()).toMatchObject({ claimed: 1, sent: 1 });
    const [delivery] = await f.pb.collection("checkin_monitoring_deliveries").getFullList();
    expect(delivery).toMatchObject({ state: "sent", send_started: true });
    const replay = () => f.pb.send("/api/wts/checkin-monitoring", { method: "POST", body: { operation: "machine_send", deliveryId: delivery.id, claimToken: delivery.claim_token, nowMs: f.clock() }, requestKey: null });
    await Promise.all([replay(), replay()]); await f.restart(); await worker.tick();
    expect(sink.messages).toHaveLength(1);
    expect(sink.recipients).toEqual([`RCPT TO:<${f.admin.record.email}>`]);
    const decoded = sink.messages[0].replace(/=\r\n/g, "").replace(/=([0-9a-f]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16))).replace(/\r\n[ \t]+/g, " ");
    expect(decoded).toContain("Subject: WTS check-in: open / admission_uncertain");
    expect(decoded.replace(/\r\n/g, "\n")).toContain(["WTS2026", `Incident: ${delivery.incident_id}`, "Category: admission_uncertain", "Notification: open", "Station: wts2026station1", "Workflow: testworkflow001", "Inspect the check-in monitoring dashboard. This message changes no operational authority."].join("\n"));
    expect(decoded).not.toMatch(/PRIVATE|AFFILIATION|attendee@|SECRET/);
    f.workflow("testworkflow002", "admission_uncertain"); await worker.observe();
    const { job } = await f.pb.send<{ job: MonitoringMail }>("/api/wts/checkin-monitoring", { method: "POST", body: { operation: "machine_claim", nowMs: f.clock() } });
    expect(job.subject).toBe("WTS check-in: open / admission_uncertain");
    expect(job.text.replace(job.incidentId, delivery.incident_id).replace("testworkflow002", "testworkflow001")).toBe(["WTS2026", `Incident: ${delivery.incident_id}`, "Category: admission_uncertain", "Notification: open", "Station: wts2026station1", "Workflow: testworkflow001", "Inspect the check-in monitoring dashboard. This message changes no operational authority."].join("\n"));
    await f.service.configure({ ...f.command, operationId: crypto.randomUUID(), expectedVersion: 2, recipientUserIds: [] });
    expect(await f.pb.send("/api/wts/checkin-monitoring", { method: "POST", body: { operation: "machine_send", deliveryId: job.deliveryId, claimToken: job.claimToken } })).toEqual({ outcome: "failed" });
    expect(sink.messages).toHaveLength(1);
  } finally { await f.cleanup(); await sink.close(); }
});

async function fixture() {
  const f = await startCheckinPocketBase();
  const admin = await f.user("admin"); const operator = await f.user("checkin_operator");
  const service = new CheckinMonitoringService(f.pb, admin.actor);
  const own = new CheckinMonitoringService(f.pb, operator.actor);
  const command = { operationId: crypto.randomUUID(), expectedVersion: 1, recipientUserIds: [admin.record.id], waitingMs: 30000, incidentMs: 60000, repeatMs: 900000 };
  let now = Date.now(); const origin = now;
  let ready = true; let outcome: MonitoringOutcome | "throw" = "sent";
  const mail: MonitoringMail[] = [];
  const source = new CheckinAgentService(f.pb, admin.actor);
  const readReadiness = async () => (await source.adminList()).stations.map((s) => ({ ...s, readyForAuthorization: ready }));
  const worker = () => new CheckinMonitoringWorker(f.pb, { now: () => now, readReadiness, transport: async (m) => { mail.push(m); if (outcome === "throw") throw new Error("private-provider-diagnostic attendee@example.test SECRET"); return outcome; } });
  function sql(query: string, ...values: (string | number)[]) { const db = new DatabaseSync(join(f.root, "pb_data", "data.db")); try { db.exec("PRAGMA busy_timeout = 5000"); db.prepare(query).run(...values); } finally { db.close(); } }
  function workflow(id = "testworkflow001", state = "not_submitted", station = "wts2026station1") {
    // Controlled durable input fixture; monitoring itself must create its records
    // through the real authenticated transaction seam, never fixture inserts.
    sql("INSERT INTO checkin_arrival_workflows (id,edition,upstream_event_id,upstream_attendee_id,station_id,state,created,name,affiliation) VALUES (?,?,?,?,?,?,?,?,?)", id, "WTS2026", "101", id, station, state, new Date(origin).toISOString(), "PRIVATE ATTENDEE", "PRIVATE AFFILIATION");
  }
  const token = "c".repeat(64);
  await f.pb.collection("checkin_bindings").create({ identity_hash: createHash("sha256").update(`wts2026:binding:${token}`).digest("hex"), station: "wts2026station1", version: 1, revoked: false, last_seen_at: new Date(now).toISOString() });
  return { ...f, admin, operator, service, own, command, worker, mail, sql, workflow, token, readReadiness, clock: () => now, advance: (ms: number) => { now += ms; }, readiness: (r: boolean) => { ready = r; }, outcome: (o: typeof outcome) => { outcome = o; } };
}

it("warns at 30s, emails at 60s, repeats no sooner than 15min, and recovers once without changing authority", async () => {
  const f = await fixture();
  try {
    await f.service.configure(f.command); f.workflow();
    await f.worker().tick(); f.advance(29999); await f.worker().tick();
    expect((await f.own.dashboard(f.token)).incidents).toEqual([]);
    f.advance(1); await f.worker().tick();
    expect((await f.own.dashboard(f.token)).incidents[0]).toMatchObject({ category: "work_stalled", openedMs: 0, delivery: "none" });
    f.advance(29999); await f.worker().tick(); expect(f.mail).toHaveLength(0);
    f.advance(1); await Promise.all([f.worker().tick(), f.worker().tick()]);
    expect(f.mail).toHaveLength(1);
    const incident = (await f.service.dashboard()).incidents[0];
    await f.own.acknowledge(incident.id, f.token);
    expect((await f.pb.collection("checkin_arrival_workflows").getOne("testworkflow001")).state).toBe("not_submitted");
    f.advance(899999); await f.worker().tick(); expect(f.mail).toHaveLength(1);
    f.advance(1); await Promise.all([f.worker().tick(), f.worker().tick()]); expect(f.mail).toHaveLength(2);
    f.sql("UPDATE checkin_arrival_workflows SET state = 'rejected' WHERE id = ?", "testworkflow001");
    await Promise.all([f.worker().tick(), f.worker().tick()]); expect(f.mail.map((m) => m.kind)).toEqual(["open", "repeat", "recovery"]);
    await f.restart(); f.advance(3600000); await f.worker().tick(); expect(f.mail).toHaveLength(3);
    expect((await f.service.dashboard()).incidents[0]).toMatchObject({ id: incident.id, delivery: "sent", deliveryKind: "recovery", nextAction: "none" });
  } finally { await f.cleanup(); }
});

it("creates immediate durable uncertainty, isolates operator scope, and never stores diagnostics or copies attendee data into alerts", async () => {
  const f = await fixture();
  try {
    await f.service.configure(f.command);
    f.workflow("testworkflow001", "admission_uncertain");
    f.workflow("testworkflow002", "accepted", "wts2026station2");
    f.sql("INSERT INTO checkin_print_attempts (id,workflow_id,station_id,purpose,state,name,affiliation) VALUES (?,?,?,?,?,?,?)", "testprint000001", "testworkflow002", "wts2026station2", "initial", "uncertain", "PRIVATE ATTENDEE", "PRIVATE AFFILIATION");
    await f.worker().tick();
    expect(f.mail).toHaveLength(2);
    expect((await f.own.dashboard(f.token)).incidents.map((i) => i.category)).toEqual(["admission_uncertain"]);
    expect((await f.own.dashboard()).incidents).toEqual([]);
    const dashboard = await f.service.dashboard();
    const foreign = dashboard.incidents.find((i) => i.stationId === "wts2026station2")!;
    await expect(f.own.acknowledge(foreign.id, f.token)).rejects.toThrow();
    await expect(f.own.configure(f.command)).rejects.toThrow();
    expect((await f.own.dashboard(f.token)).adminChoices).toBeUndefined();
    const operatorJson = JSON.stringify(await f.own.dashboard(f.token));
    expect(operatorJson).not.toContain(f.admin.record.email);
    for (const collection of ["checkin_monitoring_incidents", "checkin_monitoring_deliveries", "checkin_monitoring_audit"]) {
      const persisted = JSON.stringify(await f.pb.collection(collection).getFullList());
      expect(persisted).not.toMatch(/PRIVATE|attendee@|SECRET|private-provider|@example/);
      await expect(f.operator.client.collection(collection).getFullList()).rejects.toThrow();
    }
    expect(JSON.stringify(f.mail)).not.toMatch(/PRIVATE|attendee@|SECRET/);
    await expect(f.operator.client.send("/api/wts/checkin-monitoring", { method: "POST", body: { operation: "machine_claim" } })).rejects.toThrow();
    expect(await f.pb.collection("checkin_arrival_attempts").getFullList()).toEqual([]);
  } finally { await f.cleanup(); }
});

it("keeps missing recipients visible with no admin fallback, and exposes failed or unknown delivery without retry storms", async () => {
  const f = await fixture();
  try {
    f.workflow("testworkflow001", "admission_uncertain");
    await f.worker().tick();
    expect(f.mail).toEqual([]);
    expect(await f.service.dashboard()).toMatchObject({ recipientsConfigured: false, incidents: [{ delivery: "pending", nextAction: "configure_recipients" }] });
    await f.service.configure(f.command); f.outcome("failed"); await f.worker().tick();
    expect((await f.service.dashboard()).incidents[0]).toMatchObject({ delivery: "failed", nextAction: "wait_for_repeat", nextDeliveryMs: f.clock() + 900000 });
    await f.restart(); await f.worker().tick(); expect(f.mail).toHaveLength(1);
    f.advance(900000); f.outcome("throw"); await f.worker().tick();
    expect((await f.service.dashboard()).incidents[0]).toMatchObject({ delivery: "unknown", nextAction: "investigate_delivery_no_retry" });
    f.advance(9000000); await f.restart(); await f.worker().tick(); expect(f.mail).toHaveLength(2);
    f.sql("UPDATE checkin_arrival_workflows SET state = 'rejected' WHERE id = ?", "testworkflow001");
    f.outcome("sent"); await f.worker().tick(); expect(f.mail).toHaveLength(3);
    expect(f.mail[2].kind).toBe("recovery");
  } finally { await f.cleanup(); }
});

it("persists the send boundary before transport, and never reclaims unknown work after a crash", async () => {
  const f = await fixture();
  try {
    await f.service.configure(f.command); f.workflow("testworkflow001", "admission_uncertain");
    await f.worker().observe();
    const claim = () => f.pb.send<{ job: MonitoringMail | null }>("/api/wts/checkin-monitoring", { method: "POST", body: { operation: "machine_claim", nowMs: f.clock() }, requestKey: null });
    const claims = await Promise.all([claim(), claim(), claim()]);
    expect(claims.filter((v) => v.job)).toHaveLength(1);
    expect((await f.service.dashboard()).incidents[0]).toMatchObject({ delivery: "possibly_sent", nextAction: "investigate_delivery_no_retry" });
    await f.restart(); f.advance(9000000); await f.worker().tick(); expect(f.mail).toEqual([]);
    const job = claims.find((v) => v.job)!.job!;
    const result = (outcome: string) => f.pb.send("/api/wts/checkin-monitoring", { method: "POST", body: { operation: "machine_result", deliveryId: job.deliveryId, claimToken: job.claimToken, outcome, nowMs: f.clock() }, requestKey: null });
    await result("sent"); await result("sent"); await expect(result("failed")).rejects.toThrow();
    expect((await f.service.dashboard()).incidents[0].delivery).toBe("sent");
    const audit = await f.pb.collection("checkin_monitoring_audit").getFullList({ filter: `category = 'delivery_sent'` });
    expect(audit).toHaveLength(1);
  } finally { await f.cleanup(); }
});

it("fences exact configuration retries, validates admin recipients, and does not lower the repeat floor", async () => {
  const f = await fixture();
  try {
    const first = await f.service.configure(f.command);
    expect(await f.service.configure(f.command)).toEqual(first);
    await expect(f.service.configure({ ...f.command, recipientUserIds: [] })).rejects.toThrow();
    await expect(f.service.configure({ ...f.command, operationId: crypto.randomUUID() })).rejects.toThrow();
    await expect(f.service.configure({ ...f.command, operationId: crypto.randomUUID(), expectedVersion: 2, repeatMs: 899999 })).rejects.toThrow();
    await expect(f.service.configure({ ...f.command, operationId: crypto.randomUUID(), expectedVersion: 2, recipientUserIds: [f.operator.record.id] })).rejects.toThrow();
    await f.service.configure({ ...f.command, operationId: crypto.randomUUID(), expectedVersion: 2, waitingMs: 1000, incidentMs: 2000, repeatMs: 1800000 });
    f.workflow(); await f.worker().tick(); f.advance(1000); await f.worker().tick();
    expect((await f.service.dashboard()).incidents[0].openedMs).toBe(0);
    f.advance(1000); await f.worker().tick(); expect(f.mail).toHaveLength(1);
    f.advance(900000); await f.worker().tick(); expect(f.mail).toHaveLength(1);
    f.advance(-900000); await f.worker().tick(); expect(f.mail).toHaveLength(1);
    await f.pb.collection("users").update(f.admin.record.id, { role: "user" });
    await expect(f.service.dashboard()).rejects.toThrow();
  } finally { await f.cleanup(); }
});
