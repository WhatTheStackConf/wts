import { describe, expect, it, vi } from "vitest";
import { setSessionPublished } from "~/lib/admin-session-promotion";
import type { AdminSpeakerService } from "~/lib/admin-speaker-profile";

describe("admin Session publication", () => {
  it("publishes a promoted CFP Session before it is scheduled", async () => {
    const updateRecord = vi.fn().mockResolvedValue({
      id: "session-1",
      cfp_submission: "submission-1",
      published: true,
    });
    const adminService = { updateRecord } as unknown as AdminSpeakerService;

    const result = await setSessionPublished(adminService, "session-1", true);

    expect(updateRecord).toHaveBeenCalledWith("sessions", "session-1", {
      published: true,
    });
    expect(result).toMatchObject({ published: true });
  });
});
