import { expect, it, vi } from "vite-plus/test";
import { handleCheckinAgentRequest } from "~/lib/checkin-agent-http";

it("keeps human same-origin policy and separates bound status from admin controls", async () => {
  const status = vi.fn().mockResolvedValue({ station: null });
  const adminList = vi.fn();
  const deps = { authenticate: async () => ({ id: "operator", role: "checkin_operator" }), service: async () => ({ status, adminList, issue: vi.fn(), revoke: vi.fn() }) };
  const request = (body: object, origin = "https://wts.test") => new Request("https://wts.test/api/checkin-agents", { method: "POST", headers: { "content-type": "application/json", origin, cookie: `wts_checkin_client=${"a".repeat(64)}` }, body: JSON.stringify(body) });
  expect((await handleCheckinAgentRequest(request({ operation: "status" }, "https://foreign.test"), deps)).status).toBe(403);
  expect(status).not.toHaveBeenCalled();
  const result = await handleCheckinAgentRequest(request({ operation: "status" }), deps);
  expect(result.status).toBe(200); expect(result.headers.get("cache-control")).toContain("no-store");
  expect(status).toHaveBeenCalledWith("a".repeat(64));
  expect((await handleCheckinAgentRequest(request({ operation: "status", stationId: "wts2026station2" }), deps)).status).toBe(400);
  expect((await handleCheckinAgentRequest(request({ operation: "admin_list" }), deps)).status).toBe(403);
  expect(adminList).not.toHaveBeenCalled();
});
