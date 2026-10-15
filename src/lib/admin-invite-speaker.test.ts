import { AsyncLocalStorage } from "node:async_hooks";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => {
  const fetchAllRecords = vi.fn();
  const createRecord = vi.fn();
  return {
    fetchAllRecords,
    createRecord,
    adminService: { fetchAllRecords, createRecord },
  };
});

vi.mock("~/lib/admin-security", () => ({ requireAdmin: vi.fn().mockResolvedValue(undefined) }));
vi.mock("~/lib/pocketbase-admin-service", () => ({ getAdminPB: () => mocks.adminService }));

import { adminCreateInviteSpeaker as serverAdminCreateInviteSpeaker } from "~/lib/admin-actions";

const requestContext = new AsyncLocalStorage<object>();
(globalThis as Record<symbol, unknown>)[Symbol.for("solid.RequestContext")] = requestContext;

const adminCreateInviteSpeaker = (input: Parameters<typeof serverAdminCreateInviteSpeaker>[0]) =>
  requestContext.run({}, () => serverAdminCreateInviteSpeaker(input));

const baseInput = {
  slug: "",
  display_name: "Ada Lovelace",
  affiliation: "  Analytical Engines ",
  bio: " Notes on the engine. ",
  social_handles: [" @ada ", "", "@lovelace"],
};

describe("adminCreateInviteSpeaker", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.fetchAllRecords.mockReset();
    mocks.createRecord.mockReset();
  });

  it("rejects a non-boolean MC designation before reading the display name", async () => {
    await expect(adminCreateInviteSpeaker({ ...baseInput, display_name: 7, is_mc: "yes" } as never))
      .resolves.toEqual({ success: false, error: "MC designation must be a boolean." });
  });

  it("requires a non-blank display name", async () => {
    await expect(adminCreateInviteSpeaker({ ...baseInput, display_name: "   " }))
      .resolves.toEqual({ success: false, error: "Display name is required." });
  });

  it("rejects an unsupported photo upload", async () => {
    await expect(adminCreateInviteSpeaker({
      ...baseInput,
      photo: { name: "photo.gif", type: "image/gif", data: [1, 2, 3] },
    })).resolves.toEqual({ success: false, error: "Photo must be JPEG, PNG, or WebP." });
    expect(mocks.createRecord.mock.calls).toEqual([]);
  });

  it("creates an unpublished invite speaker with a unique slug and trimmed fields", async () => {
    mocks.fetchAllRecords.mockImplementation(async (_collection: string, options: { filter: string }) =>
      options.filter === 'slug = "ada-lovelace"' ? [{ id: "taken" }] : []);
    mocks.createRecord.mockImplementation(async (_collection: string, body: Record<string, unknown>) => ({
      id: "speaker-1",
      ...body,
    }));

    await expect(adminCreateInviteSpeaker({ ...baseInput, bio: undefined as never, photo: null })).resolves.toEqual({
      success: true,
      data: {
        id: "speaker-1",
        slug: "ada-lovelace-2",
        display_name: "Ada Lovelace",
        origin: "invite",
        published: false,
        is_mc: false,
        user: "",
        cfp_applicant: "",
        photo: "",
        affiliation: "Analytical Engines",
        bio: "",
        social_handles: ["@ada", "@lovelace"],
        appearance_events: [],
      },
    });
    expect(mocks.createRecord.mock.calls).toEqual([["speakers", {
      slug: "ada-lovelace-2",
      published: false,
      origin: "invite",
      is_mc: false,
      display_name: "Ada Lovelace",
      affiliation: "Analytical Engines",
      bio: "",
      social_handles: ["@ada", "@lovelace"],
    }]]);
  });

  it("prefers the requested slug and keeps an explicit MC designation", async () => {
    mocks.fetchAllRecords.mockResolvedValue([]);
    mocks.createRecord.mockImplementation(async (_collection: string, body: Record<string, unknown>) => ({
      id: "speaker-2",
      ...body,
    }));

    const result = await adminCreateInviteSpeaker({ ...baseInput, slug: "Host Person", is_mc: true });
    expect(result).toMatchObject({ success: true, data: { slug: "host-person", is_mc: true, bio: "Notes on the engine." } });
  });

  it("reports PocketBase field errors", async () => {
    mocks.fetchAllRecords.mockResolvedValue([]);
    mocks.createRecord.mockRejectedValue({ response: { data: { slug: { message: "Value must be unique." } } } });

    await expect(adminCreateInviteSpeaker(baseInput))
      .resolves.toEqual({ success: false, error: "slug: Value must be unique." });
  });
});
