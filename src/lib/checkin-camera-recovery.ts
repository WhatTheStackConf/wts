import type { CheckinArrivalDecision, CheckinArrivalHistory } from "~/lib/checkin-arrival-contract";

const prefix = "wts:camera-held:";
/** Only an opaque operation reference is persisted, before sending. No QR,
 * attendee text, credentials, selected context, or response is browser storage. */
export function cameraHeldReference(storage: Pick<Storage, "getItem" | "setItem" | "removeItem">, scope: string) {
  const key = prefix + scope;
  return {
    read(): string | null {
      const value = storage.getItem(key);
      if (value !== null && !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value)) throw new Error("Held reference unreadable");
      return value;
    },
    hold(operationId: string) { storage.setItem(key, operationId); if (storage.getItem(key) !== operationId) throw new Error("Held reference not saved"); },
    clear(operationId: string) { if (storage.getItem(key) === operationId) storage.removeItem(key); },
  };
}

/** Public history is paginated. An absent entry is NOT evidence of no send.
 * Recheck live scope after every await before disclosing a result. */
export async function recoverCameraArrival(operationId: string, history: (cursor?: string) => Promise<CheckinArrivalHistory>, stillBound: () => boolean): Promise<CheckinArrivalDecision | undefined> {
  const seen = new Set<string>();
  let cursor: string | undefined;
  do {
    if (!stillBound()) return undefined;
    const page = await history(cursor);
    if (!stillBound()) return undefined;
    const entry = page.items.find((item) => item.operationId === operationId);
    if (entry) return entry.result;
    if (!page.nextCursor) return undefined;
    if (seen.has(page.nextCursor)) throw new Error("History cursor did not advance");
    seen.add(page.nextCursor); cursor = page.nextCursor;
  } while (true);
}
