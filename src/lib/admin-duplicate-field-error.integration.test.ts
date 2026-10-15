import { AsyncLocalStorage } from "node:async_hooks";
import type PocketBase from "pocketbase";
import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { startLiveQaPocketBase } from "~/lib/live-qa-pocketbase-test-helper";

const holder = vi.hoisted(() => ({ service: null as unknown }));

vi.mock("~/lib/capability-availability", () => ({
  capabilityAvailable: vi.fn().mockResolvedValue(false),
  capabilityUnavailableMetadata: () => ({}),
  requireCapability: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("~/lib/admin-security", () => ({ requireAdmin: vi.fn().mockResolvedValue(undefined) }));
vi.mock("~/lib/pocketbase-admin-service", () => ({ getAdminPB: () => holder.service }));

import { adminUpdateSpeakerProfile } from "~/lib/admin-actions";
import { promoteSubmissionToDraftSession } from "~/lib/admin-session-promotion";
import {
  createOrReuseCfpSpeakerFromApplicant,
  isDuplicateFieldError,
  type AdminSpeakerService,
} from "~/lib/admin-speaker-profile";

const requestContext = new AsyncLocalStorage<object>();
(globalThis as Record<symbol, unknown>)[Symbol.for("solid.RequestContext")] = requestContext;

let fixture: Awaited<ReturnType<typeof startLiveQaPocketBase>>;
beforeAll(async () => { fixture = await startLiveQaPocketBase(); }, 60_000);
afterAll(async () => { await fixture?.cleanup(); });

/** Admin service over the disposable PB that hides the first matching lookup, as a concurrent writer would. */
function racedService(pb: PocketBase, collection: string, filterPrefix: string): AdminSpeakerService {
  let raced = false;
  return {
    async fetchAllRecords(name, options) {
      const filter = (options as { filter?: string } | undefined)?.filter || "";
      if (!raced && name === collection && filter.startsWith(filterPrefix)) {
        raced = true;
        return [];
      }
      return pb.collection(name).getFullList(options as never);
    },
    fetchRecordById: (name, id, options) => pb.collection(name).getOne(id, options as never),
    createRecord: (name, data) => pb.collection(name).create(data as never),
    updateRecord: (name, id, data) => pb.collection(name).update(id, data as never),
    getInstance: async () => pb,
  };
}

async function promotedSubmission() {
  const pb = fixture.pb;
  const { record: user } = await fixture.user("user", "Ada Lovelace");
  const applicant = await pb.collection("cfp_applicants").create({ user: user.id, affiliation: "Org", bio: "Bio" });
  const speaker = await pb.collection("speakers").create({
    slug: `speaker-${crypto.randomUUID()}`, display_name: "Ada", origin: "cfp", published: false, cfp_applicant: applicant.id,
  });
  const submission = await pb.collection("cfp_submissions").create({
    session_title: "Engines", abstract: "A", key_takeaways: "K", applicant: applicant.id, status: "accepted",
  });
  return { applicant, speaker, submission };
}

function createPromotedSession(submissionId: string) {
  return fixture.pb.collection("sessions").create({
    slug: `session-${crypto.randomUUID()}`, title: "Engines", abstract: "A", published: false, cfp_submission: submissionId,
  });
}

describe("PocketBase unique violations", () => {
  it("are field-keyed ClientResponseErrors that isDuplicateFieldError detects", async () => {
    const { submission } = await promotedSubmission();
    await createPromotedSession(submission.id);
    const error = await createPromotedSession(submission.id).then(
      () => { throw new Error("expected a unique violation"); },
      (failure: { status: number; message: string; response: unknown }) => failure,
    );

    expect({ status: error.status, message: error.message, response: error.response }).toEqual({
      status: 400,
      message: "Failed to create record.",
      response: {
        status: 400,
        message: "Failed to create record.",
        data: { cfp_submission: { code: "validation_not_unique", message: "Value must be unique." } },
      },
    });
    expect([isDuplicateFieldError(error, "cfp_submission"), isDuplicateFieldError(error, "slug")]).toEqual([true, false]);
  });

  it("let a raced CFP speaker creation reuse the speaker that won", async () => {
    const { applicant, speaker } = await promotedSubmission();
    const service = racedService(fixture.pb, "speakers", "cfp_applicant = ");

    const result = await createOrReuseCfpSpeakerFromApplicant(service, applicant.id);

    expect({ created: result.created, id: result.speaker.id }).toEqual({ created: false, id: speaker.id });
  });

  it("turn a raced promotion into the duplicate-promotion message", async () => {
    const { submission } = await promotedSubmission();
    await createPromotedSession(submission.id);
    const service = racedService(fixture.pb, "sessions", "cfp_submission = ");

    await expect(promoteSubmissionToDraftSession(service, submission.id))
      .rejects.toThrow("This proposal already has a draft Session.");
  });

  it("turn a raced slug update into the friendly duplicate-slug message", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const pb = fixture.pb;
    const speakers = await pb.collections.getOne("speakers");
    await pb.collections.update("speakers", {
      indexes: [...speakers.indexes, "CREATE UNIQUE INDEX `idx_fixture_speakers_slug` ON `speakers` (`slug`)"],
    });
    const taken = `taken-${crypto.randomUUID()}`;
    await pb.collection("speakers").create({ slug: taken, display_name: "Ada", origin: "invite", published: false });
    const other = await pb.collection("speakers").create({ slug: `other-${crypto.randomUUID()}`, display_name: "Grace", origin: "invite", published: false });
    holder.service = racedService(pb, "speakers", "slug = ");

    const result = await requestContext.run({}, () => adminUpdateSpeakerProfile(other.id, { display_name: "Grace", slug: taken }));

    expect(result).toEqual({ success: false, error: "Slug is already used by another speaker. Choose a different slug." });
  });
});
