import { z } from "zod";

export const conferenceGuideSchema = z.strictObject({
  schemaVersion: z.literal("1"),
  contentVersion: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  event: z.strictObject({
    name: z.string().min(1),
    date: z.strictObject({
      status: z.union([z.literal("announced"), z.literal("not_announced")]),
      localDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    }),
    location: z.strictObject({
      status: z.union([z.literal("announced"), z.literal("not_announced")]),
      city: z.string().min(1).optional(),
      country: z.string().min(1).optional(),
    }),
    timeZone: z.strictObject({
      status: z.union([z.literal("announced"), z.literal("not_announced")]),
      iana: z.string().min(1).optional(),
    }),
  }),
  mainVenue: z.strictObject({
    status: z.union([z.literal("announced"), z.literal("not_announced")]),
    name: z.string().min(1).optional(),
    campuses: z.array(z.string().min(1)).optional(),
    spaces: z.strictObject({
      outdoorStages: z.number().int().positive().optional(),
      indoorStages: z.number().int().positive().optional(),
      amenities: z.array(z.string().min(1)).optional(),
    }).optional(),
  }),
  preConferenceVenue: z.strictObject({
    status: z.union([z.literal("announced"), z.literal("not_announced")]),
    name: z.string().min(1).optional(),
    address: z.string().min(1).optional(),
  }),
  tickets: z.strictObject({
    status: z.union([z.literal("announced"), z.literal("not_announced")]),
    canonicalPath: z.string().regex(/^\/[a-z0-9/-]*$/).optional(),
    regular: z.strictObject({
      amount: z.number().int().positive(),
      currency: z.string().length(3),
    }).optional(),
    student: z.strictObject({
      amount: z.number().int().positive(),
      currency: z.string().length(3),
      verificationEmail: z.string().email(),
    }).optional(),
    includes: z.array(z.string().min(1)).optional(),
    workshops: z.string().optional(),
  }),
  codeOfConduct: z.strictObject({
    status: z.literal("announced"),
    canonicalPath: z.string().regex(/^\/[a-z0-9/-]*$/),
    reportingEmail: z.string().email(),
  }),
  accessibility: z.strictObject({
    status: z.union([z.literal("announced"), z.literal("not_announced")]),
    contactEmail: z.string().email(),
  }),
  accommodation: z.strictObject({
    status: z.union([z.literal("announced"), z.literal("not_announced")]),
  }),
  contact: z.strictObject({
    generalEmail: z.string().email(),
  }),
});

export type ConferenceGuide = z.infer<typeof conferenceGuideSchema>;
