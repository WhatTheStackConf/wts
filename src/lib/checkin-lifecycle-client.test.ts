import { expect, it, vi } from "vite-plus/test";
import { createCheckinLifecycleClient } from "./checkin-lifecycle-client";
import type { LifecycleStatus } from "./checkin-lifecycle-contract";
const open: LifecycleStatus = { edition: "WTS2026", closedAt: null, purgeDeadline: null, centralDeletedAt: null, centralCompactedAt: null, totals: null, restoreRequired: false, restoreGeneration: 0, reconciledAt: null, approvedAt: null, devices: [] };
const closed = { ...open, closedAt: "2026-09-19T18:00:00.000Z", purgeDeadline: "2026-10-19T18:00:00.000Z" };
it("freezes the close UUID through malformed HTTP 200, failed refresh and explicit retry", async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ ...closed, edition: "WTS2027" })).mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(Response.json(closed));
  const client = createCheckinLifecycleClient(fetcher);
  await expect(client.close("WTS2026")).rejects.toMatchObject({ ambiguous: true });
  const frozen = client.pendingClose();
  expect(frozen?.operationId).toMatch(/^[a-f0-9-]{36}$/);
  await expect(client.status()).rejects.toThrow();
  expect(client.pendingClose()).toEqual(frozen);
  expect(await client.close("WTS2026")).toEqual(closed);
  expect(fetcher.mock.calls[0]?.[1]?.body).toBe(fetcher.mock.calls[2]?.[1]?.body);
  expect(client.pendingClose()).toBeUndefined();
  expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ credentials: "same-origin", cache: "no-store", referrerPolicy: "no-referrer" });
});
it("never confirms an open or incoherent close result", async () => {
  for (const value of [open, { ...closed, purgeDeadline: null }, { ...closed, purgeDeadline: "2026-10-20T18:00:00.000Z" }, { ...closed, attendeeEmail: "private@example.test" }]) {
    const client = createCheckinLifecycleClient(vi.fn<typeof fetch>().mockResolvedValue(Response.json(value)));
    await expect(client.close("WTS2026")).rejects.toMatchObject({ ambiguous: true });
    expect(client.pendingClose()).toBeDefined();
  }
});
it("coalesces double taps without generating a second close command", async () => {
  let resolve!: (response: Response) => void;
  const fetcher = vi.fn<typeof fetch>().mockImplementation(() => new Promise((done) => { resolve = done; }));
  const client = createCheckinLifecycleClient(fetcher);
  const first = client.close("WTS2026"); const second = client.close("WTS2026");
  expect(fetcher).toHaveBeenCalledTimes(1);
  resolve(Response.json(closed));
  expect(await first).toEqual(await second);
});
it("retains commands on transport and session failures without displaying raw server errors", async () => {
  for (const status of [403, 409, 503]) {
    const client = createCheckinLifecycleClient(vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: "PII private@example.test token=secret" }, { status })));
    await expect(client.close("WTS2026")).rejects.not.toThrow(/private@example|token=secret/);
    expect(client.pendingClose()).toBeDefined();
  }
});
it("checks restore generation and explicit confirmation before transport", async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ...open, restoreGeneration: 4, reconciledAt: "2026-09-19T18:00:00.000Z", approvedAt: "2026-09-19T18:01:00.000Z" }));
  const client = createCheckinLifecycleClient(fetcher);
  await expect(client.close("wrong edition")).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
  await expect(client.approveRestore({ generation: 3, confirmEdition: "WTS2026" })).rejects.toMatchObject({ ambiguous: true });
});
