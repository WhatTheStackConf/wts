import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchAllRecords = vi.fn();
const fetchRecordById = vi.fn();

vi.mock("~/lib/pocketbase-admin-service", () => ({
  getAdminPB: () => ({
    fetchAllRecords,
    fetchRecordById,
  }),
}));

import { fetchMcpProposalContext, fetchMcpProposals } from "~/lib/mcp-program-data";

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
    created: "2026-01-01 00:00:00.000Z",
    updated: "2026-01-01 00:00:00.000Z",
    expand: {
      applicant: {
        id: "applicant-1",
        affiliation: "Example Co",
        bio: "Speaker bio",
        social_handles: null,
        preferred_contact_method: "email",
        user: "user-1",
        created: "2026-01-01 00:00:00.000Z",
        updated: "2026-01-01 00:00:00.000Z",
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

describe("MCP programme data", () => {
  beforeEach(() => {
    fetchAllRecords.mockReset();
    fetchRecordById.mockReset();
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
