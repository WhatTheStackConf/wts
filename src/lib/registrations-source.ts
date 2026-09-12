/** Read-through only: no persistent PII mirror, admission or station service. */
import { z } from "zod";
import { checkinDiscoveryConfiguration, checkinServerConfig, paginated, type CheckinDiscoveryConfig } from "./checkin-hievents";
import { createCheckinUpstreamReader } from "./checkin-upstream-read";
import { registrationProgrammes, registrationRosterSchema, type RegistrationRoster } from "./registrations-contract";
const id = z.union([z.number().int().positive().safe(), z.string().regex(/^[1-9][0-9]*$/)]).transform(String);
const identity = z.object({ id, event_id: id, product_id: id });
const attendee = identity.extend({ first_name: z.string().max(500), last_name: z.string().max(500), email: z.string().max(500), status: z.string().optional() });
export async function readRegistrations(input: CheckinDiscoveryConfig = checkinServerConfig(), transport: typeof fetch = fetch): Promise<RegistrationRoster> {
  const config = checkinDiscoveryConfiguration(input);
  if (!config) throw new Error("Registration source unavailable");
  const allowed = new Set(registrationProgrammes.map(p => p.id));
  const read = createCheckinUpstreamReader(config, transport);
  let previousId = 0;
  // Upstream defaults to a non-unique sort, which can duplicate/omit rows at
  // page boundaries. Its QueryParamsDTO and AttendeeRepository support id ASC.
  const rows = await paginated({ acceptedPages: 0, read: path => read(`${path}&sort_by=id&sort_direction=asc`) }, `${config.base}/events/5/attendees`, "events/5/attendees", value => {
    const keys = identity.parse(value);
    if (!Number.isSafeInteger(Number(keys.id)) || Number(keys.id) <= previousId) throw new Error("Invalid registration ordering");
    previousId = Number(keys.id);
    if (keys.event_id !== "5") throw new Error("Invalid registration event");
    if (!allowed.has(keys.product_id)) return { id: keys.id, registration: null };
    const row = attendee.parse(value);
    return { id: row.id, registration: { id: row.id, programmeId: row.product_id, name: `${row.first_name} ${row.last_name}`.trim(), email: row.email,
      ticketStatus: row.status === "ACTIVE" || row.status === "CANCELLED" ? row.status : null } };
  });
  // Check-in entries are list-specific, so never infer programme arrival from
  // an event-wide check_ins array. Unknown status remains explicitly unknown.
  return registrationRosterSchema.parse({ refreshedAt: new Date().toISOString(), registrations: rows.flatMap(row => row.registration ? [row.registration] : []) });
}
