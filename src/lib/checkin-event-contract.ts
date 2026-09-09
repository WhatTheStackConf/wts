import type { CheckinActor, CheckinReasonCode, CheckinStationId } from "~/lib/checkin-contract";

/** Browser-safe event configuration protocol. No list capability or credential. */
export interface CheckinAffiliationMapping { questionId: string; productIds: string[] }
export type CheckinCatalogueState = "complete" | "partial" | "unavailable";
export type CheckinEventAvailability = "available" | "unconfigured" | "disabled" | "upstream_unavailable" | "stale";
export interface CheckinEventDTO {
  id: string;
  title: string;
  generation: number;
  availability: CheckinEventAvailability;
}
/** Echo this fence for NEW intake only. Accepted work must persist its own
 * server-resolved snapshot, never reread the phone's mutable selection. */
export interface CheckinEventContext {
  protocolVersion: 1;
  edition: "WTS2026";
  eventId: string;
  eventGeneration: number;
  bindingId: string;
  bindingVersion: number;
  selectionVersion: number;
  stationId: CheckinStationId;
  stationGeneration: number;
  systemGeneration: number;
}
export interface CheckinEventCatalogue {
  state: CheckinCatalogueState;
  events: CheckinEventDTO[];
  selected: CheckinEventDTO | null;
  context: CheckinEventContext | null;
  fence: { bindingVersion: number; selectionVersion: number; stationGeneration: number; systemGeneration: number };
  operationsEnabled: false;
}
export interface CheckinEventSelection {
  eventId: string;
  eventGeneration: number;
  bindingVersion: number;
  selectionVersion: number;
  stationGeneration: number;
  systemGeneration: number;
}
export interface CheckinEventConfiguration {
  id: string;
  upstreamEventId: string;
  title: string;
  member: boolean;
  listId: string;
  affiliation: CheckinAffiliationMapping | null;
  enabled: boolean;
  generation: number;
}
export interface CheckinAdminEventEntry {
  upstreamEventId: string;
  title: string;
  upstreamAvailable: boolean;
  configuration: CheckinEventConfiguration | null;
}
export interface CheckinAdminEventCatalogue {
  state: CheckinCatalogueState;
  events: CheckinAdminEventEntry[];
  /** Configured source changed or absent: old references may not be retargeted. */
  sourceMismatch: boolean;
}
export interface CheckinEventOptions {
  state: CheckinCatalogueState;
  lists: { id: string; title: string }[];
  questions: { id: string; title: string; productIds: string[] }[];
  products: { id: string; title: string }[];
}
export interface CheckinConfigureEvent {
  operationId: string;
  expectedGeneration: number;
  upstreamEventId: string;
  member: boolean;
  enabled: boolean;
  listId: string;
  affiliation: CheckinAffiliationMapping | null;
  reason: CheckinReasonCode;
  note?: string;
}
export interface CheckinConfigureEventResult {
  actionId: string;
  replayed: boolean;
  configuration: CheckinEventConfiguration;
}
export interface CheckinEventServiceContract {
  adminCatalogue(): Promise<CheckinAdminEventCatalogue>;
  adminOptions(upstreamEventId: string): Promise<CheckinEventOptions>;
  configure(command: CheckinConfigureEvent): Promise<CheckinConfigureEventResult>;
  catalogue(bindingToken?: string): Promise<CheckinEventCatalogue>;
  select(bindingToken: string | undefined, selection: CheckinEventSelection): Promise<CheckinEventCatalogue>;
}
/** Server-only intake result; do not serialize via a browser route. */
export interface CheckinEventSnapshot {
  context: CheckinEventContext;
  sourceKey: string;
  upstreamEventId: string;
  upstreamListId: string;
  affiliation: CheckinAffiliationMapping | null;
  actor: CheckinActor;
}
