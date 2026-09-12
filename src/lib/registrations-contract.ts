import { z } from "zod";
import { conferenceWeekTracks } from "./conference-week";
export const registrationProgrammes = conferenceWeekTracks.filter(track => track.freeTicketProductId !== undefined).map(track => ({ id: String(track.freeTicketProductId), name: track.name }));
export const registrationSchema = z.strictObject({
  id: z.string().regex(/^[1-9][0-9]*$/), programmeId: z.string(),
  name: z.string().max(1001), email: z.string().max(500),
  ticketStatus: z.enum(["ACTIVE", "CANCELLED"]).nullable(),
});
export const registrationRosterSchema = z.strictObject({ refreshedAt: z.iso.datetime(), registrations: z.array(registrationSchema).max(1000) });
export type RegistrationRoster = z.infer<typeof registrationRosterSchema>;
