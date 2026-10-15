import type { AgentReadinessDTO } from "~/lib/checkin-agent-contract";

type FailedRead = { state: "needs_affiliation_choice" | "dependency_unavailable" };

/** A failed preflight read waits for an explicit linked continuation; it is not a final decision. */
export function isFailedPreflightRead<T extends { state: string }>(outcome: T): outcome is Extract<T, FailedRead> {
  return outcome.state === "needs_affiliation_choice" || outcome.state === "dependency_unavailable";
}

/** The readiness read belongs to this binding and station and authorizes new intake. */
export function readinessAuthorizes(readiness: { scope: unknown; station: AgentReadinessDTO | null } | undefined, scope: string | undefined, stationId: string | undefined) {
  return readiness?.scope === scope && readiness?.station?.stationId === stationId && !!readiness?.station?.readyForAuthorization;
}
