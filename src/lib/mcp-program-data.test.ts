import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchAllRecords = vi.fn();
const fetchRecordById = vi.fn();

vi.mock("~/lib/pocketbase-admin-service", () => ({
  getAdminPB: () => ({
    fetchAllRecords,
    fetchRecordById,
  }),
}));

import {
  fetchMcpProposalContext,
  fetchMcpProposals,
  fetchMcpSessions,
  fetchMcpSpeakers,
} from "~/lib/mcp-program-data";

const timestamp = "2026-01-01 00:00:00.000Z";

function submission(id: string, status: "pending" | "accepted" | "rejected") {
  return {
    id,
    status,
    session_title: `${status} talk`,
    abstract: `${status} abstract`,
    key_takeaways: `${status} takeaways`,
    technical_requirements: "",
    notes: "",
    applicant: "applicant-1",
    created: timestamp,
    updated: timestamp,
    expand: {
      applicant: {
        id: "applicant-1",
        affiliation: "Example Co",
        bio: "Speaker bio",
        social_handles: null,
        preferred_contact_method: "email",
        user: "user-1",
        created: timestamp,
        updated: timestamp,
        expand: {
          user: {
            id: "user-1",
            name: "Ada Lovelace",
          },
        },
      },
    },
  };
}

function session(id: string, cfpSubmission?: string) {
  return {
    id,
    slug: id,
    published: id === "published-session",
    title: `${id} title`,
    abstract: `${id} abstract`,
    format: "Talk",
    starts_at: "2026-09-19 10:00:00.000Z",
    track: "Main",
    room: "Hall A",
    speakers: ["speaker-1"],
    cfp_submission: cfpSubmission,
    created: timestamp,
    updated: timestamp,
    expand: { speakers: [] },
  };
}

describe("MCP programme data", () => {
  beforeEach(() => {
    fetchAllRecords.mockReset();
    fetchRecordById.mockReset();
  });

  it("maps MCP speakers from Speaker-owned fields without CFP Applicant or User fallbacks", async () => {
    fetchAllRecords.mockResolvedValue([
      {
        id: "speaker-1",
        slug: "speaker-slug",
        published: true,
        origin: "cfp",
        display_name: "",
        affiliation: "",
        bio: "",
        social_handles: null,
        cfp_applicant: "applicant-1",
        user: "user-1",
        created: timestamp,
        updated: timestamp,
        expand: {
          cfp_applicant: {
            id: "applicant-1",
            affiliation: "Applicant Co",
            bio: "Applicant bio",
            social_handles: ["@applicant"],
            expand: { user: { id: "user-1", name: "User Name" } },
          },
          user: { id: "user-1", name: "Direct User Name" },
        },
      },
    ]);

    const speakers = await fetchMcpSpeakers();

    expect(fetchAllRecords).toHaveBeenCalledWith("speakers", {
      sort: "display_name,slug",
    });
    expect(speakers[0]).toMatchObject({
      id: "speaker-1",
      display_name: "speaker-slug",
      affiliation: null,
      bio: null,
      social_handles: null,
    });
    expect(JSON.stringify(speakers[0])).not.toContain("Applicant");
    expect(JSON.stringify(speakers[0])).not.toContain("User Name");
  });

  it("includes MCP session CFP provenance as cfp_submission_id", async () => {
    fetchAllRecords.mockImplementation((collection: string) => {
      if (collection === "sessions") {
        return Promise.resolve([
          session("published-session", "submission-1"),
          session("manual-session"),
        ]);
      }
      return Promise.resolve([]);
    });

    const sessions = await fetchMcpSessions();

    expect(fetchAllRecords).toHaveBeenCalledWith("sessions", {
      expand: "speakers",
      sort: "title",
    });
    expect(sessions[0]).toMatchObject({
      id: "published-session",
      cfp_submission_id: "submission-1",
    });
    expect(sessions[1]).toMatchObject({
      id: "manual-session",
      cfp_submission_id: null,
    });
    expect(sessions[0]).not.toHaveProperty("cfp_submission");
    expect(sessions[0]).not.toHaveProperty("starts_at");
    expect(sessions[0]).not.toHaveProperty("track");
    expect(sessions[0]).not.toHaveProperty("room");
    expect(sessions[0].schedule).toBeNull();
  });

  it("lists every CFP proposal by default instead of filtering to accepted", async () => {
    fetchAllRecords.mockImplementation((collection: string) => {
      if (collection === "cfp_submissions") {
        return Promise.resolve([
          submission("pending-1", "pending"),
          submission("accepted-1", "accepted"),
          submission("rejected-1", "rejected"),
        ]);
      }
      if (collection === "cfp_reviews") return Promise.resolve([]);
      return Promise.resolve([]);
    });

    const proposals = await fetchMcpProposals();

    expect(fetchAllRecords).toHaveBeenCalledWith("cfp_submissions", {
      expand: "applicant.user",
      sort: "-created",
    });
    expect(proposals.map((proposal) => proposal.status)).toEqual([
      "pending",
      "accepted",
      "rejected",
    ]);
  });

  it("returns context for rejected proposals so admins can inspect decisions", async () => {
    fetchRecordById.mockResolvedValue(submission("rejected-1", "rejected"));
    fetchAllRecords.mockResolvedValue([]);

    const context = await fetchMcpProposalContext("rejected-1");

    expect(context.status).toBe("rejected");
    expect(context.session_title).toBe("rejected talk");
  });
});
