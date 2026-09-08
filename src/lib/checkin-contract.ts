/** Browser-safe WTS 2026 station contract. No admission or printing is enabled. */
export const CHECKIN_EDITION = "WTS2026" as const;
export const CHECKIN_STATION_IDS = ["wts2026station1", "wts2026station2", "wts2026station3"] as const;
export type CheckinStationId = (typeof CHECKIN_STATION_IDS)[number];
export const CHECKIN_REASON_CODES = ["security", "device_replacement", "maintenance", "incident", "configuration", "operations_restored"] as const;
export type CheckinReasonCode = (typeof CHECKIN_REASON_CODES)[number];
/** Activity means a successful authenticated status/bind in the last five minutes,
 * not a claim that a phone is online, logged in now, or has a camera open. */
export const CHECKIN_ACTIVE_WINDOW_SECONDS = 300;
export const CHECKIN_NOTE_MAX_LENGTH = 240;
export interface CheckinActor { userId: string; role: string }
export interface CheckinSystemDTO { edition: typeof CHECKIN_EDITION; enabled: boolean; version: number; generation: number }
export interface CheckinStationDTO {
  id: CheckinStationId;
  edition: typeof CHECKIN_EDITION;
  label: string;
  location: string;
  /** Display-only asset reference, never USB paths/credentials/transport. */
  printerRef: string;
  enabled: boolean;
  version: number;
  generation: number;
  provisionCodeIssued: boolean;
  activeBindingCount: number;
  multiplePhonesWarning: boolean;
  ready: false;
  unreadyReasons: string[];
}
export interface CheckinBindingDTO {
  id: string;
  stationId: CheckinStationId | "";
  version: number;
  revoked: boolean;
  lastSeenAt: string;
  active: boolean;
}
export interface CheckinStatusDTO {
  system: CheckinSystemDTO;
  bindingState: "unbound" | "bound" | "invalid" | "revoked";
  binding: CheckinBindingDTO | null;
  station: CheckinStationDTO | null;
  operationsEnabled: false;
  activeWindowSeconds: number;
}
export interface CheckinConfirmation {
  stationId: CheckinStationId;
  stationVersion: number;
  systemGeneration: number;
  /** Zero before this browser has a binding; fences stale cross-tab rebinds. */
  bindingVersion: number;
}
export interface CheckinPreviewDTO {
  system: CheckinSystemDTO;
  station: CheckinStationDTO;
  confirmation: CheckinConfirmation;
  canBind: boolean;
}
/** Server-only return: route sets the HttpOnly persistent cookie and MUST NOT
 * serialize bindingToken in its JSON response. Existing identity stays unchanged. */
export interface CheckinBindResult { status: CheckinStatusDTO; bindingToken: string }
export interface CheckinAuditDTO {
  id: string;
  actorUserId: string;
  actorName: string;
  actorRole: "admin" | "checkin_operator";
  operation: string;
  stationId: CheckinStationId | "";
  bindingId: string;
  reason: CheckinReasonCode | "";
  note: string;
  outcome: "applied";
  createdAt: string;
}
export interface CheckinPage<T> { items: T[]; page: number; hasMore: boolean }
export interface CheckinAdminDTO {
  system: CheckinSystemDTO;
  stations: CheckinStationDTO[];
  bindings: CheckinPage<CheckinBindingDTO>;
  audit: CheckinPage<CheckinAuditDTO>;
  activeWindowSeconds: number;
}
interface CheckinControlBase {
  /** New random UUID for a new intent; reuse on transport retry. */
  operationId: string;
  expectedVersion: number;
  reason: CheckinReasonCode;
  note?: string;
}
export type CheckinAdminCommand = CheckinControlBase & (
  | { operation: "set_system_enabled"; enabled: boolean }
  | { operation: "set_station_enabled"; stationId: CheckinStationId; enabled: boolean }
  | { operation: "configure_station"; stationId: CheckinStationId; label: string; location: string; printerRef: string }
  | { operation: "rotate_provision_code"; stationId: CheckinStationId }
  | { operation: "revoke_binding"; bindingId: string }
);
export interface CheckinAdminResult {
  actionId: string;
  replayed: boolean;
  /** Issued once only; never in stored replay/audit/list DTOs. A lost response
   * requires a NEW rotation intent, not recovering plaintext from storage. */
  provisionCode?: string;
  system?: CheckinSystemDTO;
  station?: CheckinStationDTO;
  binding?: CheckinBindingDTO;
}
export type CheckinErrorCode = "forbidden" | "invalid_input" | "invalid_code" | "invalid_binding" | "revoked_binding" | "disabled" | "conflict" | "unavailable";
export interface CheckinServiceContract {
  status(bindingToken?: string | null): Promise<CheckinStatusDTO>;
  preview(code: string, bindingToken?: string): Promise<CheckinPreviewDTO>;
  bind(code: string, bindingToken: string | null | undefined, confirmation: CheckinConfirmation): Promise<CheckinBindResult>;
  adminList(query?: { bindingPage?: number; auditPage?: number }): Promise<CheckinAdminDTO>;
  adminControl(command: CheckinAdminCommand): Promise<CheckinAdminResult>;
}
