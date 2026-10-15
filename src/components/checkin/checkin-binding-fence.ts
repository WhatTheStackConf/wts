import type { CheckinBindingDTO, CheckinStationDTO, CheckinStatusDTO } from "~/lib/checkin-contract";
import type { CheckinEventCatalogue, CheckinEventContext } from "~/lib/checkin-event-contract";

export type ActiveStationStatus = CheckinStatusDTO & { binding: CheckinBindingDTO; station: CheckinStationDTO };

/** This phone's binding while it is bound and not revoked. */
export function activeBinding(status: CheckinStatusDTO | undefined) {
  return status?.bindingState === "bound" && status.binding && !status.binding.revoked ? status.binding : undefined;
}

export function stationActive(status: CheckinStatusDTO | undefined): status is ActiveStationStatus {
  return !!activeBinding(status) && !!status?.system.enabled && !!status.station?.enabled;
}

export function fenceMatches(fence: CheckinEventCatalogue["fence"], status: ActiveStationStatus) {
  return fence.bindingVersion === status.binding.version && fence.stationGeneration === status.station.generation && fence.systemGeneration === status.system.generation;
}

function sameFence(context: CheckinEventContext, fence: CheckinEventCatalogue["fence"]) {
  return context.bindingVersion === fence.bindingVersion && context.selectionVersion === fence.selectionVersion
    && context.stationGeneration === fence.stationGeneration && context.systemGeneration === fence.systemGeneration;
}

function sameStation(context: CheckinEventContext, status: CheckinStatusDTO | undefined) {
  return context.bindingId === status?.binding?.id && context.stationId === status?.station?.id;
}

/** The catalogue's intake context names its selected event, this station and the catalogue fence. */
export function contextMatches({ context, selected, fence }: CheckinEventCatalogue, status: CheckinStatusDTO | undefined) {
  return selected?.availability === "available" && !!context
    && context.eventId === selected.id && context.eventGeneration === selected.generation
    && sameStation(context, status) && sameFence(context, fence);
}
