import { z } from "zod";
import type { LiveQaProgramme } from "~/lib/live-qa-contract";

const instant = z.string().refine(value => Number.isFinite(Date.parse(value)), "Invalid schedule time");
const session = z.object({
  slug: z.string().min(1), title: z.string().min(1), startAt: instant, endAt: instant,
  accepting: z.boolean(), mode: z.enum(["auto", "open", "closed"]),
}).refine(value => Date.parse(value.endAt) > Date.parse(value.startAt), "Invalid slot range");
const programme = z.object({
  day: z.object({ key: z.literal("main-day"), localDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), title: z.string() }).nullable(),
  serverNow: instant,
  stages: z.array(z.object({
    key: z.string().min(1), name: z.string().min(1), locationLabel: z.string(), sessions: z.array(session).max(1000),
  })).max(1000),
}).refine(value => value.day !== null || value.stages.length === 0, "Stages require the main day")
  .refine(value => new Set(value.stages.map(stage => stage.key)).size === value.stages.length, "Duplicate stage keys")
  .refine(value => {
    const slugs = value.stages.flatMap(stage => stage.sessions.map(session => session.slug));
    return new Set(slugs).size === slugs.length;
  }, "Duplicate sessions");

/** Both HTTP and browser boundaries allowlist public metadata; never project questions. */
export function parseLiveQaProgramme(value: unknown): LiveQaProgramme {
  return programme.parse(value);
}
