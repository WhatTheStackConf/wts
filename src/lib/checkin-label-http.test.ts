import { describe, expect, it, vi } from "vite-plus/test";
import { handleCheckinLabelRequest } from "~/lib/checkin-label-http";
import { isCheckinPath } from "~/lib/checkin-privacy";
import { SYNTHETIC_LABEL_CONFIG, LabelRenderError } from "~/lib/checkin-label-render-contract";
import { mutateLabelProfile, type LabelProfileMutation } from "~/lib/checkin-label-client";

function request(body: object, origin = "https://wts.example.test") {
  return new Request("https://wts.example.test/api/checkin-labels", { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) });
}
function dependencies(role = "admin") {
  const target = { list: vi.fn().mockResolvedValue({ profiles: [], stations: [], operationsEnabled: false }), get: vi.fn(), configure: vi.fn(), approve: vi.fn() };
  return { target, authenticate: vi.fn().mockResolvedValue({ id: "human", role }), service: vi.fn().mockResolvedValue(target), render: vi.fn() };
}

describe("Name Label authenticated HTTP boundary", () => {
  it("fails closed on malformed/private text fields, origins, bodies and unsupported effects", async () => {
    const deps = dependencies();
    for (const input of [
      request({ operation: "list" }, "https://foreign.example.test"),
      request({ operation: "list" }, ""),
      request({ operation: "print" }),
      request({ operation: "preview_synthetic", text: { name: "Test", affiliation: "", email: "private@example.test" } }),
      request({ operation: "preview_synthetic", text: { name: "Test", affiliation: "" }, mode: "production" }),
      request({ operation: "preview", profileId: "wrong", expectedVersion: 1, text: { name: "Test", affiliation: "" } }),
      request({ operation: "approve", command: { physicalConfirmation: false } }),
    ]) expect((await handleCheckinLabelRequest(input, deps)).status).toBeGreaterThanOrEqual(400);
    expect((await handleCheckinLabelRequest(request({ padding: "x".repeat(17000) }), deps)).status).toBe(413);
    const nonJson = request({ operation: "list" }); nonJson.headers.set("content-type", "text/plain");
    expect((await handleCheckinLabelRequest(nonJson, deps)).status).toBe(415);
    expect(deps.service).not.toHaveBeenCalled();
    expect(deps.render).not.toHaveBeenCalled();
  });
  it("returns actionable font/profile errors but never raw backend diagnostics", async () => {
    const deps = dependencies();
    for (const [code, status] of [["font_unavailable", 503], ["profile_mismatch", 400]] as const) {
      deps.render.mockRejectedValueOnce(new LabelRenderError(code, "Restore the pinned font or select the exact profile version."));
      const result = await handleCheckinLabelRequest(request({ operation: "preview_synthetic", text: { name: "Test", affiliation: "" } }), deps);
      expect(result.status).toBe(status);
      expect(await result.json()).toMatchObject({ code, error: "Restore the pinned font or select the exact profile version." });
    }
    deps.target.list.mockRejectedValueOnce(new Error("Bearer secret person@example.test"));
    const failed = await handleCheckinLabelRequest(request({ operation: "list" }), deps);
    expect(failed.status).toBe(503);
    expect(await failed.text()).not.toMatch(/Bearer|secret|person@/);
    deps.authenticate.mockRejectedValueOnce(new Error("Missing session"));
    expect((await handleCheckinLabelRequest(request({ operation: "list" }), deps)).status).toBe(403);
  });
  it("routes explicit admin profile changes and physical approval, never a print command", async () => {
    const deps = dependencies();
    const common = { operationId: crypto.randomUUID(), expectedVersion: 1, expectedStationVersion: 1, reason: "configuration", note: "Synthetic software test" };
    const configure = { ...common, stationId: "wts2026station1", config: SYNTHETIC_LABEL_CONFIG };
    deps.target.configure.mockResolvedValue({ replayed: false });
    expect((await handleCheckinLabelRequest(request({ operation: "configure", command: configure }), deps)).status).toBe(200);
    expect(deps.target.configure).toHaveBeenCalledWith(configure);
    const approve = { ...common, profileId: "p".repeat(15), physicalConfirmation: true };
    deps.target.approve.mockResolvedValue({ replayed: false });
    expect((await handleCheckinLabelRequest(request({ operation: "approve", command: approve }), deps)).status).toBe(200);
    expect(deps.target.approve).toHaveBeenCalledWith(approve);
    expect(deps.render).not.toHaveBeenCalled();
  });
  it("marks synthetic output explicitly and rechecks authority before returning it", async () => {
    const deps = dependencies();
    deps.render.mockResolvedValue({ pngBase64: "synthetic-render-double" });
    const response = await handleCheckinLabelRequest(request({ operation: "preview_synthetic", text: { name: "Test", affiliation: "" } }), deps);
    expect(response.status).toBe(200);
    expect(deps.render).toHaveBeenCalledWith(expect.objectContaining({ mode: "preview", profile: expect.objectContaining({ approval: "unapproved", config: expect.objectContaining({ synthetic: true }) }) }));
    expect(deps.target.list).toHaveBeenCalledTimes(2);
    expect(deps.target.configure).not.toHaveBeenCalled();
  });
  it("previews an exact stored version through the production renderer without a mutation", async () => {
    const deps = dependencies();
    const profile = { id: "p".repeat(15), stationId: "wts2026station1", version: 2, approval: "unapproved", config: SYNTHETIC_LABEL_CONFIG };
    deps.target.get.mockResolvedValue(profile);
    deps.render.mockResolvedValue({ pngBase64: "synthetic-render-double", payloadHash: "test-only" });
    const text = { name: "Ѓорѓи Željko", affiliation: "" };
    const response = await handleCheckinLabelRequest(request({ operation: "preview", profileId: profile.id, expectedVersion: 2, text }), deps);
    expect(response.status).toBe(200);
    expect(deps.render).toHaveBeenCalledWith({ text, profile, mode: "preview", expected: { profileId: profile.id, profileVersion: 2, printerRef: profile.config.printerRef, stockRef: profile.config.stockRef, rendererVersion: profile.config.rendererVersion, fontVersion: profile.config.fontVersion } });
    expect(deps.target.configure).not.toHaveBeenCalled();
    expect(deps.target.approve).not.toHaveBeenCalled();
    expect(deps.target.get).toHaveBeenCalledTimes(2); // Live role is rechecked after rendering.
  });
  it("lists profiles without printing and protects response privacy", async () => {
    const deps = dependencies();
    const response = await handleCheckinLabelRequest(request({ operation: "list" }), deps);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ profiles: [], stations: [], operationsEnabled: false, syntheticConfig: { synthetic: true } });
    expect(deps.authenticate).toHaveBeenCalledOnce();
    expect(deps.target.list).toHaveBeenCalledOnce();
    expect(deps.render).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(isCheckinPath("/api/checkin-labels")).toBe(true);
  });
  it("denies every operator operation before accessing profiles or rasterization", async () => {
    const deps = dependencies("checkin_operator");
    for (const operation of ["list", "preview", "preview_synthetic", "configure", "approve", "print"]) {
      expect((await handleCheckinLabelRequest(request({ operation }), deps)).status).toBe(403);
    }
    expect(deps.service).not.toHaveBeenCalled();
    expect(deps.render).not.toHaveBeenCalled();
  });
});

describe("Name Label browser mutation response boundary", () => {
  it("retains ambiguity for malformed JSON success envelopes and mismatched command results", async () => {
    const mutation: LabelProfileMutation = { operation: "configure", command: { operationId: crypto.randomUUID(), stationId: "wts2026station1", expectedVersion: 0, expectedStationVersion: 1, reason: "configuration", note: "Synthetic response test", config: SYNTHETIC_LABEL_CONFIG } };
    const valid = { actionId: "a".repeat(15), replayed: false, profile: { id: "p".repeat(15), stationId: mutation.command.stationId, version: 1, approval: "unapproved", config: SYNTHETIC_LABEL_CONFIG } };
    try {
      for (const body of [{}, null, { error: "not an applied result" }, { ...valid, replayed: "false" }, { ...valid, profile: { ...valid.profile, version: 2 } }, { ...valid, profile: { ...valid.profile, config: { ...valid.profile.config, density: 2 } } }]) {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 200 })));
        await expect(mutateLabelProfile(mutation)).rejects.toMatchObject({ name: "CheckinLabelRequestError", ambiguous: true });
      }
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(valid), { status: 200 })));
      await expect(mutateLabelProfile(mutation)).resolves.toEqual(valid);
    } finally { vi.unstubAllGlobals(); }
  });
});
