import type PocketBase from "pocketbase";
import type { CheckinActor } from "~/lib/checkin-contract";
import { CheckinLookupService } from "~/lib/checkin-lookup-service";
import { createCheckinLookupAdapter } from "~/lib/checkin-lookup-hievents";
import { createCheckinArrivalSource } from "~/lib/checkin-arrival-source";

/** Call only from the authenticated server route with its privileged PB client. */
export function createCheckinLookupService(pb: PocketBase, actor: CheckinActor): CheckinLookupService {
  return new CheckinLookupService(pb, actor, createCheckinLookupAdapter(), createCheckinArrivalSource());
}
