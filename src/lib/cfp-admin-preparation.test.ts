import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { fetchCfpAdminConfiguration, saveClosedCfpConfiguration } from "~/lib/cfp-admin-preparation";

const service = {
  fetchAllRecords: vi.fn(),
  createRecord: vi.fn(),
  updateRecord: vi.fn(),
};

const closedRecord = {
  id: "conference-config",
  cfp_open: false,
  cfp_deadline: null,
  availability: { cfp: false, review: false },
};

describe("closed CFP preparation core", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("updates only closed configuration and forces participant capabilities off", async () => {
    service.fetchAllRecords.mockResolvedValue([{ id: closedRecord.id }]);
    service.updateRecord.mockResolvedValue(closedRecord);

    await expect(saveClosedCfpConfiguration(service, {
      cfp_open: false,
      cfp_deadline: "2027-06-30",
    })).resolves.toEqual(closedRecord);
    expect(service.updateRecord).toHaveBeenCalledWith("conference_config", closedRecord.id, {
      cfp_open: false,
      cfp_deadline: "2027-06-30",
      availability: { cfp: false, review: false },
    });
  });

  it("rejects activation before reading or writing configuration", async () => {
    await expect(saveClosedCfpConfiguration(service, {
      cfp_open: true,
      cfp_deadline: "2027-06-30",
    })).rejects.toThrow("Only valid closed CFP configuration can be prepared.");
    expect(service.fetchAllRecords).not.toHaveBeenCalled();
    expect(service.createRecord).not.toHaveBeenCalled();
    expect(service.updateRecord).not.toHaveBeenCalled();
  });

  it("creates a missing singleton only in the closed and unavailable state", async () => {
    service.fetchAllRecords.mockResolvedValue([]);
    service.createRecord.mockResolvedValue(closedRecord);

    await expect(saveClosedCfpConfiguration(service, {
      cfp_open: false,
      cfp_deadline: null,
    })).resolves.toEqual(closedRecord);
    expect(service.createRecord).toHaveBeenCalledWith("conference_config", {
      cfp_open: false,
      cfp_deadline: null,
      availability: { cfp: false, review: false },
    });
    expect(service.updateRecord).not.toHaveBeenCalled();
  });

  it("returns only well-formed singleton state and rejects incomplete capability config", async () => {
    service.fetchAllRecords.mockResolvedValue([closedRecord]);
    await expect(fetchCfpAdminConfiguration(service)).resolves.toEqual({
      cfp_open: false,
      cfp_available: false,
      cfp_deadline: null,
    });
    service.fetchAllRecords.mockResolvedValue([{
      ...closedRecord,
      cfp_open: true,
      availability: { cfp: true, review: false },
    }]);
    await expect(fetchCfpAdminConfiguration(service)).resolves.toEqual({
      cfp_open: true,
      cfp_available: true,
      cfp_deadline: null,
    });
    service.fetchAllRecords.mockResolvedValue([{ id: closedRecord.id, cfp_open: false, cfp_deadline: null }]);
    await expect(fetchCfpAdminConfiguration(service)).rejects.toThrow("Capability availability configuration is incomplete.");
  });
});
