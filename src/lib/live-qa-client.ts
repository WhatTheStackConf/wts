import type { LiveQaRequest } from "~/lib/live-qa-contract";

export class LiveQaClientError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

export async function liveQaRequest<T>(request: LiveQaRequest, expectedActorId: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch("/api/live-qa", {
      method: "POST", credentials: "same-origin", cache: "no-store",
      headers: { "Content-Type": "application/json", "X-WTS-QA-User": expectedActorId }, body: JSON.stringify(request),
      signal: AbortSignal.timeout(25_000),
    });
  } catch {
    throw new LiveQaClientError(0, "Connection lost. Retry to check whether your request was received.");
  }
  let data: unknown;
  try { data = await response.json(); }
  catch { throw new LiveQaClientError(0, "Could not read the Q&A response. Try again."); }
  if (!response.ok) {
    const error = data && typeof data === "object" && "error" in data ? data.error : undefined;
    throw new LiveQaClientError(response.status, typeof error === "string" ? error : "Q&A unavailable. Try again.");
  }
  return data as T;
}
