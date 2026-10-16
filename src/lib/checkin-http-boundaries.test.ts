import { describe, expect, it, vi } from "vite-plus/test";
import { handleCheckinAgentRequest } from "~/lib/checkin-agent-http";
import { handleCheckinArrivalRequest } from "~/lib/checkin-arrival-http";
import { handleCheckinArrivalResumeRequest } from "~/lib/checkin-arrival-resume-http";
import { handleCheckinEventRequest } from "~/lib/checkin-event-http";
import { handleCheckinLabelRequest } from "~/lib/checkin-label-http";
import { handleCheckinRequest } from "~/lib/checkin-http";
import { CheckinError } from "~/lib/checkin-service";
import { LabelRenderError } from "~/lib/checkin-label-render-contract";

const origin = "https://wts.example.test";
const token = "a".repeat(64);
const operationId = "11111111-1111-4111-8111-111111111111";
type Handler = (request: Request, deps: never) => Promise<Response>;
interface Boundary {
  name: string; handle: Handler; role: string; valid: object; denied: string; type: string; large: string; invalid: string; limit: number;
  service: Record<string, ReturnType<typeof vi.fn>>; extra?: Record<string, unknown>;
}
function post(body: BodyInit | null, headers: Record<string, string> = {}) {
  return new Request(`${origin}/api/checkin`, { method: "POST", headers: { origin, "content-type": "application/json", cookie: `wts_checkin_client=${token}`, ...headers }, body });
}
function json(body: unknown, headers?: Record<string, string>) { return post(JSON.stringify(body), headers); }
function deps(boundary: Boundary, role = boundary.role) {
  return { authenticate: vi.fn().mockResolvedValue({ id: "human0000000001", role }), service: vi.fn().mockResolvedValue(boundary.service), ...boundary.extra };
}
async function call(boundary: Boundary, request: Request, dependencies: object = deps(boundary)) {
  const response = await boundary.handle(request, dependencies as never);
  return { status: response.status, body: await response.json() };
}

const boundaries: Boundary[] = [
  { name: "agent", handle: handleCheckinAgentRequest as Handler, role: "admin", valid: { operation: "admin_list" }, denied: "Agent access denied.", type: "Use JSON.", large: "Command too large.", invalid: "Invalid agent command.", limit: 8192,
    service: { status: vi.fn().mockResolvedValue({ station: null }), adminList: vi.fn().mockResolvedValue({ stations: [] }), issue: vi.fn(), revoke: vi.fn() } },
  { name: "arrival", handle: handleCheckinArrivalRequest as Handler, role: "admin", valid: { operation: "status", operationId }, denied: "Check-in access denied.", type: "Use a JSON arrival command.", large: "Arrival command too large.", invalid: "Invalid arrival command.", limit: 8192,
    service: { status: vi.fn().mockResolvedValue({ ok: "status" }), preflight: vi.fn(), history: vi.fn().mockResolvedValue({ ok: "history" }) } },
  { name: "resume", handle: handleCheckinArrivalResumeRequest as Handler, role: "admin", valid: { operation: "get", operationId }, denied: "Check-in access denied.", type: "Use a JSON arrival command.", large: "Arrival command too large.", invalid: "Invalid arrival command.", limit: 8192,
    service: { get: vi.fn().mockResolvedValue({ ok: "get" }), resume: vi.fn() } },
  { name: "event", handle: handleCheckinEventRequest as Handler, role: "admin", valid: { operation: "catalogue" }, denied: "Check-in access denied.", type: "Use a JSON event command.", large: "Event command too large.", invalid: "Invalid event command.", limit: 8192,
    service: { catalogue: vi.fn().mockResolvedValue({ ok: "catalogue" }), select: vi.fn(), adminCatalogue: vi.fn().mockResolvedValue({ ok: "admin" }), adminOptions: vi.fn().mockResolvedValue({ ok: "options" }), configure: vi.fn() } },
  { name: "label", handle: handleCheckinLabelRequest as Handler, role: "admin", valid: { operation: "list" }, denied: "Name Label access denied.", type: "Use a JSON Name Label command.", large: "Name Label command too large.", invalid: "Invalid Name Label command.", limit: 16384,
    service: { list: vi.fn().mockResolvedValue({ profiles: [] }), get: vi.fn(), configure: vi.fn(), approve: vi.fn() }, extra: { render: vi.fn() } },
  { name: "checkin", handle: handleCheckinRequest as Handler, role: "admin", valid: { operation: "status" }, denied: "Check-in access denied.", type: "Use a JSON check-in command.", large: "Check-in command too large.", invalid: "Invalid check-in command.", limit: 4096,
    service: { status: vi.fn().mockResolvedValue({ ok: "status" }) } },
];
const stationCookie: Record<string, string> = { arrival: "Invalid station client identity.", resume: "Invalid station client identity.", event: "Invalid station client identity.", checkin: "Invalid station client identity. Clear this site's data, then choose the station again from the Printer dropdown." };
const unavailable: Record<string, string> = {
  agent: "Agent service unavailable.",
  arrival: "Arrival service unavailable. The outcome remains unknown; do not start a new intake for this attendee.",
  resume: "Arrival service unavailable. Retry the same preflight; no admission or printing was attempted.",
  event: "Event catalogue unavailable. Refresh before retrying. No admission or printing was attempted.",
  label: "Name Label service unavailable. Retry explicitly. No admission or printing was attempted.",
  checkin: "Check-in unavailable. Refresh before retrying.",
};
const reconstructed = new Set(["arrival", "resume"]);

describe.each(boundaries)("$name HTTP boundary", (boundary) => {
  it("denies foreign origins, failed authentication and missing actors", async () => {
    expect(await call(boundary, json(boundary.valid, { origin: "https://foreign.test" }))).toEqual({ status: 403, body: { error: boundary.denied } });
    const failing = { ...deps(boundary), authenticate: vi.fn().mockRejectedValue(new Error("private diagnostic")) };
    expect(await call(boundary, json(boundary.valid), failing)).toEqual({ status: 403, body: { error: boundary.denied } });
    const missing = { ...deps(boundary), authenticate: vi.fn().mockResolvedValue(undefined) };
    expect(await call(boundary, json(boundary.valid), missing)).toEqual({ status: 403, body: { error: boundary.denied } });
  });
  it("rejects non-JSON, oversized, empty, malformed and unknown commands before the service", async () => {
    const dependencies = deps(boundary);
    expect(await call(boundary, json(boundary.valid, { "content-type": "text/plain" }), dependencies)).toEqual({ status: 415, body: { error: boundary.type } });
    expect(await call(boundary, post(JSON.stringify({ ...boundary.valid, padding: "x".repeat(boundary.limit) })), dependencies)).toEqual({ status: 413, body: { error: boundary.large } });
    expect(await call(boundary, post(null), dependencies)).toEqual({ status: 400, body: { error: boundary.invalid } });
    expect(await call(boundary, post("{"), dependencies)).toEqual({ status: 400, body: { error: boundary.invalid } });
    expect(await call(boundary, json({ operation: "unknown" }), dependencies)).toEqual({ status: 400, body: { error: boundary.invalid } });
    expect(await call(boundary, json({ ...boundary.valid, extra: true }), dependencies)).toEqual({ status: 400, body: { error: boundary.invalid } });
    expect(dependencies.service).not.toHaveBeenCalled();
  });
  it("accepts a body exactly at the size limit", async () => {
    const text = JSON.stringify(boundary.valid);
    const padded = text + " ".repeat(boundary.limit - text.length);
    expect((await call(boundary, post(padded))).status).toBe(200);
  });
  it("maps domain errors and hides unknown failures", async () => {
    const domain = new CheckinError("conflict", 409);
    domain.message = "mutated message";
    const failing = { ...deps(boundary), service: vi.fn().mockRejectedValue(domain) };
    const message = reconstructed.has(boundary.name) ? new CheckinError("conflict", 409).message : "mutated message";
    expect(await call(boundary, json(boundary.valid), failing)).toEqual({ status: 409, body: { code: "conflict", error: message } });
    const broken = { ...deps(boundary), service: vi.fn().mockRejectedValue(new Error("Bearer secret")) };
    expect(await call(boundary, json(boundary.valid), broken)).toEqual({ status: 503, body: { error: unavailable[boundary.name] } });
  });
  it("validates the station client cookie", async () => {
    const duplicate = `wts_checkin_client=${token}; wts_checkin_client=${"b".repeat(64)}`;
    const malformed = "wts_checkin_client=bad";
    if (!stationCookie[boundary.name]) {
      expect((await call(boundary, json(boundary.valid, { cookie: duplicate }))).status).toBe(200);
      expect((await call(boundary, json(boundary.valid, { cookie: malformed }))).status).toBe(200);
      return;
    }
    const dependencies = deps(boundary);
    expect(await call(boundary, json(boundary.valid, { cookie: duplicate }), dependencies)).toEqual({ status: 403, body: { error: stationCookie[boundary.name] } });
    expect(await call(boundary, json(boundary.valid, { cookie: malformed }), dependencies)).toEqual({ status: 403, body: { error: stationCookie[boundary.name] } });
    expect(dependencies.service).not.toHaveBeenCalled();
  });
});

describe("HTTP boundary dispatch", () => {
  it("passes agent cookies only when exactly one is present and keeps admin controls for admins", async () => {
    const [agent] = boundaries;
    agent.service.status.mockClear();
    await call(agent, json({ operation: "status" }, { cookie: `other=1; wts_checkin_client=${"c".repeat(10)}` }));
    await call(agent, json({ operation: "status" }, { cookie: `wts_checkin_client=1; wts_checkin_client=2` }));
    await call(agent, json({ operation: "status" }, { cookie: "" }));
    expect(agent.service.status.mock.calls).toEqual([["c".repeat(10)], [null], [null]]);
    expect(await call(agent, json({ operation: "admin_list" }), deps(agent, "checkin_operator"))).toEqual({ status: 403, body: { error: "Admin required." } });
    expect(await call(agent, json({ operation: "status" }), deps(agent, "user"))).toEqual({ status: 403, body: { error: "Agent access denied." } });
    expect(await call(agent, json({ operation: "admin_list" }))).toEqual({ status: 200, body: { stations: [] } });
  });
  it("routes arrival status/history and reserves all-station history for admins", async () => {
    const arrival = boundaries[1];
    expect(await call(arrival, json({ operation: "history", query: { scope: "all" } }), deps(arrival, "checkin_operator"))).toEqual({ status: 403, body: { error: "All-station arrival work requires an admin." } });
    expect(await call(arrival, json({ operation: "history", query: { scope: "all" } }))).toEqual({ status: 200, body: { ok: "history" } });
    expect(await call(arrival, json({ operation: "status", operationId }, { cookie: "" }))).toEqual({ status: 200, body: { ok: "status" } });
    expect(arrival.service.status).toHaveBeenLastCalledWith(undefined, operationId);
    expect(await call(arrival, json({ operation: "status", operationId }), { ...deps(arrival), authenticate: vi.fn().mockResolvedValue({ id: "", role: "admin" }) })).toEqual({ status: 403, body: { error: "Check-in access denied." } });
  });
  it("routes event operations and denies operator configuration even for malformed commands", async () => {
    const event = boundaries[3];
    expect(await call(event, json({ operation: "configure", command: "broken" }), deps(event, "checkin_operator"))).toEqual({ status: 403, body: { error: "Event configuration requires an admin." } });
    expect(await call(event, json({ operation: "admin_options", upstreamEventId: "101" }))).toEqual({ status: 200, body: { ok: "options" } });
    expect(event.service.adminOptions).toHaveBeenLastCalledWith("101");
    expect(await call(event, json({ operation: "admin_catalogue" }))).toEqual({ status: 200, body: { ok: "admin" } });
    expect(await call(event, json({ operation: "catalogue" }), deps(event, "checkin_operator"))).toEqual({ status: 200, body: { ok: "catalogue" } });
    expect(event.service.catalogue).toHaveBeenLastCalledWith(token);
    expect(await call(event, post("null"), deps(event, "checkin_operator"))).toEqual({ status: 400, body: { error: "Invalid event command." } });
  });
  it("maps label renderer failures and limits labels to admins", async () => {
    const label = boundaries[4];
    expect(await call(label, json({ operation: "list" }), deps(label, "checkin_operator"))).toEqual({ status: 403, body: { error: "Name Label configuration requires an admin." } });
    for (const [code, status] of [["font_unavailable", 503], ["raster_failed", 503], ["invalid_input", 400]] as const) {
      const failing = { ...deps(label), service: vi.fn().mockRejectedValue(new LabelRenderError(code, "Render message.")) };
      expect(await call(label, json({ operation: "list" }), failing)).toEqual({ status, body: { code, error: "Render message." } });
    }
  });
  it("routes resume get with the validated cookie", async () => {
    const resume = boundaries[2];
    expect(await call(resume, json({ operation: "get", operationId }))).toEqual({ status: 200, body: { ok: "get" } });
    expect(resume.service.get).toHaveBeenLastCalledWith(token, operationId);
  });
});
