import { z } from "zod";
import { publicSlugPattern } from "./public-slug.ts";

export const editionIdSchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/);
const id = z.string().min(1).max(160).regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/);
const slug = z.string().min(1).max(200).regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/);
const publicSlug = z.string().min(1).max(80).regex(publicSlugPattern);
export const assetIdSchema = z.string().regex(/^[a-f0-9]{64}$/);
const text = z.string().max(100_000);
const order = z.number().int().safe();
const timestamp = z.string().regex(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/).refine((value) => Number.isFinite(Date.parse(value)), "Use a valid timestamp.");
const refs = z.array(id).max(10_000).refine((values) => new Set(values).size === values.length, "Remove duplicate references.");
const speaker = z.strictObject({ id, slug: publicSlug, displayName: text, affiliation: text, bio: text, isMc: z.boolean(), socialHandles: z.array(z.string().min(1).max(2000)).max(32), photoAssetId: assetIdSchema.nullable(), });
const session = z.strictObject({ id, slug: publicSlug, title: text, abstract: text, format: text.optional(), speakerIds: refs, hostIds: refs });
const event = z.strictObject({ id, name: text, compactLabel: text, destinationUrl: z.url().optional(), displayOrder: order });
const day = z.strictObject({ id, key: slug, localDate: z.iso.date(), title: text, displayOrder: order });
const programme = z.strictObject({ id, dayId: id, eventId: id, displayOrder: order });
const track = z.strictObject({ id, programmeId: id, key: slug, name: text, locationLabel: text.optional(), displayOrder: order });
const slotBase = { id, programmeId: id, trackId: id.optional(), startAt: timestamp, endAt: timestamp, displayOrder: order, locationLabel: text.optional() };
const slot = z.discriminatedUnion("kind", [
  z.strictObject({ ...slotBase, kind: z.literal("session"), sessionId: id }),
  z.strictObject({ ...slotBase, kind: z.enum(["break", "meal", "networking", "opening", "closing", "other"]), title: text.optional(), summary: text.optional(), hostIds: refs }),
]);
const partner = z.strictObject({ id, name: text, logoAssetId: assetIdSchema, logoSurface: z.enum(["dark", "light", "mixed"]), url: z.url().optional(), type: z.enum(["organizer", "sponsor", "supporter", "community_partner", "media", "catering", "other"]), tier: z.enum(["platinum", "gold", "silver", "bronze", "bank"]).optional() });
export const publicationGraphSchema = z.strictObject({
  speakers: z.array(speaker).max(10_000), sessions: z.array(session).max(10_000), appearanceEvents: z.array(event).max(10_000),
  appearances: z.array(z.strictObject({ speakerId: id, eventId: id })).max(100_000),
  days: z.array(day).max(10_000), programmes: z.array(programme).max(10_000), tracks: z.array(track).max(10_000), slots: z.array(slot).max(100_000), partners: z.array(partner).max(10_000),
}).superRefine((graph, context) => {
  const fail = (message: string) => context.addIssue({ code: "custom", message });
  const index = <T extends { id: string }>(rows: T[], label: string) => {
    const map = new Map(rows.map((row) => [row.id, row]));
    if (map.size !== rows.length) fail(`Remove duplicate ${label} IDs.`);
    return map;
  };
  const unique = (values: string[], label: string) => { if (new Set(values).size !== values.length) fail(`Remove duplicate ${label}.`); };
  const speakers = index(graph.speakers, "speaker");
  const sessions = index(graph.sessions, "session");
  const events = index(graph.appearanceEvents, "event");
  const days = index(graph.days, "day");
  const programmes = index(graph.programmes, "programme");
  const tracks = index(graph.tracks, "track");
  index(graph.slots, "slot"); index(graph.partners, "partner");
  unique(graph.speakers.map((row) => row.slug), "speaker slugs");
  unique(graph.sessions.map((row) => row.slug), "session slugs");
  unique(graph.days.map((row) => row.key), "day keys");
  unique(graph.tracks.map((row) => `${row.programmeId}/${row.key}`), "track keys");
  unique(graph.appearances.map((row) => `${row.speakerId}/${row.eventId}`), "appearances");
  for (const row of graph.sessions) {
    if (row.speakerIds.some((ref) => !speakers.has(ref))) fail("Reference an approved session speaker.");
    const participants = new Set(row.speakerIds);
    if (row.hostIds.some((ref) => !participants.has(ref))) fail("Session hosts must be participants.");
  }
  for (const row of graph.appearances) if (!speakers.has(row.speakerId) || !events.has(row.eventId)) fail("Reference an approved appearance.");
  for (const row of graph.programmes) if (!days.has(row.dayId) || !events.has(row.eventId)) fail("Reference an approved programme day and event.");
  for (const row of graph.tracks) if (!programmes.has(row.programmeId)) fail("Reference an approved track programme.");
  for (const row of graph.slots) {
    if (!programmes.has(row.programmeId)) fail("Reference an approved slot programme.");
    if (row.trackId && tracks.get(row.trackId)?.programmeId !== row.programmeId) fail("Use a track from the slot programme.");
    if (Date.parse(row.endAt) <= Date.parse(row.startAt)) fail("End the slot after its start.");
    if (row.kind === "session") { if (!sessions.has(row.sessionId)) fail("Reference an approved slot session."); }
    else if (row.hostIds.some((ref) => !speakers.has(ref))) fail("Reference an approved shared-slot host.");
  }
});
export const publicAssetInputSchema = z.strictObject({ id: assetIdSchema, sha256: assetIdSchema, mediaType: z.enum(["image/png", "image/jpeg", "image/webp", "image/avif", "image/gif", "image/svg+xml"]), byteLength: z.number().int().positive().safe().max(50_000_000), file: z.string().min(1).max(1000) }).refine((asset) => asset.id === asset.sha256, "Use the asset checksum as its ID.");
export const publicContentBatchSchema = z.strictObject({
  schemaVersion: z.literal(1), editionId: editionIdSchema, sourceNamespace: id,
  revision: z.number().int().positive().safe(), expectedRevision: z.number().int().nonnegative().safe(),
  graph: publicationGraphSchema, assets: z.array(publicAssetInputSchema).max(512),
}).superRefine((batch, context) => {
  const ids = new Set(batch.assets.map((asset) => asset.id));
  if (ids.size !== batch.assets.length) context.addIssue({ code: "custom", message: "Remove duplicate assets." });
  if (batch.assets.reduce((total, asset) => total + asset.byteLength, 0) > 256 * 1024 * 1024) {
    context.addIssue({ code: "custom", message: "Keep total asset bytes within 256 MiB." });
  }
  const referenced = referencedAssetIds(batch.graph);
  for (const ref of referenced) if (!ids.has(ref)) context.addIssue({ code: "custom", message: "Supply every referenced asset." });
  if (batch.assets.some((asset) => !referenced.has(asset.id))) context.addIssue({ code: "custom", message: "Remove assets that the graph does not reference." });
});
export type PublicationGraph = z.infer<typeof publicationGraphSchema>;
export type PublicContentBatchV1 = z.infer<typeof publicContentBatchSchema>;
export type PublicAssetInput = z.infer<typeof publicAssetInputSchema>;
export function referencedAssetIds(graph: PublicationGraph): Set<string> {
  return new Set([...graph.speakers.flatMap((row) => row.photoAssetId ? [row.photoAssetId] : []), ...graph.partners.map((row) => row.logoAssetId)]);
}
export function emptyPublicationGraph(): PublicationGraph {
  return { speakers: [], sessions: [], appearanceEvents: [], appearances: [], days: [], programmes: [], tracks: [], slots: [], partners: [] };
}
