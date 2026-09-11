/// <reference path="../pb_data/types.d.ts" />
// Privileged coordinator seam. Original agent hash + exact station AND journal
// are authenticated before lifecycle state is read. No human actor bypass.
routerAdd("POST", "/api/wts/checkin-lifecycle-proxy", (e) => {
  const b = e.requestInfo().body;
  const p = b.payload;
  const complete = b.operation === "machine_purge_complete";
  const keys = complete ? ["stationId", "journalIdentity", "purgeToken", "method"] : ["stationId", "journalIdentity"];
  if (!["machine_policy", "machine_purge_complete"].includes(b.operation) || !/^[a-f0-9]{64}$/.test(b.credentialHash || "") || !p || Object.keys(p).length !== keys.length || keys.some(k => !Object.prototype.hasOwnProperty.call(p, k))) throw new BadRequestError("Invalid lifecycle request.");
  let result;
  e.app.runInTransaction((app) => {
    let agent;
    try { agent = app.findFirstRecordByFilter("checkin_agents", "credential_hash = {:hash}", { hash: b.credentialHash }); } catch { throw new ForbiddenError("Agent required."); }
    if (p.stationId !== agent.getString("station") || p.journalIdentity !== agent.getString("journal_identity")) throw new ForbiddenError("Foreign device.");
    const d = require(__hooks + "/checkin-lifecycle.js"); const s = d.state(app); const now = Date.now();
    if (!s.getString("closed_at")) {
      if (complete) throw new BadRequestError("Edition is not closed.");
      const latest = app.findRecordsByFilter("checkin_agents", "station = {:station}", "-revision", 1, 0, { station: p.stationId })[0];
      const restricted = s.getBool("restore_required") || agent.getBool("revoked") || now >= Date.parse(agent.getString("expires_at")) || latest.id !== agent.id;
      result = { edition: "WTS2026", mode: restricted ? "reporting_only" : "active", stationId: p.stationId, journalIdentity: p.journalIdentity }; return;
    }
    const device = app.findFirstRecordByFilter("checkin_lifecycle_devices", "station_id = {:station} && journal_identity = {:journal}", { station: p.stationId, journal: p.journalIdentity });
    if (complete) {
      if (now < Date.parse(s.getString("purge_deadline")) || p.purgeToken !== device.getString("purge_token") || p.method !== "retired_and_compacted") throw new BadRequestError("Invalid retirement acknowledgement.");
      if (!device.getString("completed_at")) { d.set(device, { completed_at: new Date(now).toISOString(), method: p.method }); d.audit(app, "device_retired", "", "", now, s.getInt("restore_generation")); }
    }
    device.set("last_seen_at", new Date(now).toISOString()); app.save(device);
    result = { edition: "WTS2026", mode: "purge_only", purgeDeadline: s.getString("purge_deadline"), purgeToken: device.getString("purge_token"), stationId: p.stationId, journalIdentity: p.journalIdentity, completed: !!device.getString("completed_at") };
  });
  return e.json(200, result);
}, $apis.requireSuperuserAuth());
