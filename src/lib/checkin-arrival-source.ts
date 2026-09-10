import type { CheckinEventSnapshot } from "~/lib/checkin-event-contract";
export { createCheckinArrivalSource } from "~/lib/checkin-arrival-hievents";
export { isCheckinArrivalQrIdentity } from "~/lib/checkin-arrival-validation";

/** Server-only identity/label projection, never serialize publicId to browser DTOs. */
export interface ArrivalAttendee {
  upstreamAttendeeId: string;
  publicId: string;
  productId: string;
  name: string;
  alreadyCheckedIn: boolean;
}
export type ArrivalResolution =
  | { state: "eligible"; attendee: ArrivalAttendee }
  | { state: "rejected"; reason: "not_in_list" | "cancelled" | "awaiting_payment" | "unknown_eligibility" | "invalid_identity" }
  | { state: "unavailable" };
export type ArrivalAffiliation = { state: "present"; text: string } | { state: "missing" } | { state: "unavailable" };
export type ArrivalAdmission =
  | { state: "newly_checked_in"; fingerprint: string }
  | { state: "existing_unattributed"; fingerprint: string }
  | { state: "rejected"; reason: "already_checked_in" | "not_in_list" | "cancelled" | "awaiting_payment" | "unknown_eligibility" }
  | { state: "uncertain" };
export interface CheckinArrivalSource {
  sourceKey: string;
  resolve(snapshot: CheckinEventSnapshot, qrIdentity: string): Promise<ArrivalResolution>;
  affiliation(snapshot: CheckinEventSnapshot, attendee: ArrivalAttendee): Promise<ArrivalAffiliation>;
  /** Reconstruct the upstream public identity after a coordinator restart. */
  admissionAttendee?(snapshot: CheckinEventSnapshot, upstreamAttendeeId: string): Promise<ArrivalAttendee | null>;
  /** Effectful operation owned by the supervised coordinator, not a web request. */
  admit?(snapshot: CheckinEventSnapshot, attendee: ArrivalAttendee): Promise<ArrivalAdmission>;
}
