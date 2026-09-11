import { afterEach, expect, it, vi } from "vite-plus/test";
import { monitoringDashboard, configureMonitoring, acknowledgeMonitoring } from "~/lib/checkin-monitoring-client";
afterEach(() => vi.unstubAllGlobals());
it("distinguishes definite initial conflicts from ambiguous HTTP and network failures", async () => {
  const command = { operationId: crypto.randomUUID(), expectedVersion: 1, recipientUserIds: [], waitingMs: 30000, incidentMs: 60000, repeatMs: 900000 };
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  for (const status of [400, 401, 403, 409, 408, 503]) {
    fetcher.mockResolvedValue(new Response("private diagnostics", { status }));
    await expect(configureMonitoring(command)).rejects.toMatchObject({ status, ambiguous: status === 408 || status >= 500 });
  }
  fetcher.mockRejectedValue(new TypeError("connection lost"));
  await expect(configureMonitoring(command)).rejects.toMatchObject({ ambiguous: true });
});
it("validates bounded station scope and never displays provider diagnostics or privileged fields", async () => {
  const data = { scope: "unbound", lastTickMs: 0, recipientsConfigured: false, hasMore: false, incidents: [] };
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(data)));
  vi.stubGlobal("fetch", fetcher);
  expect(await monitoringDashboard("operator")).toEqual(data);
  expect(fetcher.mock.calls[0][0]).toBe("/api/checkin-monitoring");
  expect(fetcher.mock.calls[0][1]).toMatchObject({ credentials: "same-origin", cache: "no-store", referrerPolicy: "no-referrer" });
  for (const value of [{ ...data, adminChoices: [{ id: "a".repeat(15), email: "private@example.test" }] }, { ...data, scope: "all" }, { ...data, rawDiagnostic: "SECRET" }]) {
    fetcher.mockResolvedValue(new Response(JSON.stringify(value)));
    await expect(monitoringDashboard("operator")).rejects.toThrow("unreadable");
  }
  fetcher.mockResolvedValue(new Response("SECRET private@example.test", { status: 503 }));
  await expect(monitoringDashboard("operator")).rejects.toThrow("Monitoring service unavailable");
});
it("rejects mismatched acknowledgement and configuration responses instead of declaring success", async () => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  fetcher.mockResolvedValue(new Response(JSON.stringify({ incidentId: "b".repeat(15), acknowledgedMs: 42 })));
  await expect(acknowledgeMonitoring("a".repeat(15))).rejects.toThrow("unreadable");
  const command = { operationId: crypto.randomUUID(), expectedVersion: 1, recipientUserIds: [], waitingMs: 30000, incidentMs: 60000, repeatMs: 900000 };
  fetcher.mockResolvedValue(new Response(JSON.stringify({ version: 2, recipientUserIds: [], waitingMs: 30000, incidentMs: 60000, repeatMs: 1800000 })));
  await expect(configureMonitoring(command)).rejects.toThrow("unreadable");
});
