import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { GET } from "~/routes/api/nr-metadata";

const request = (query = "") => ({ request: new Request(`https://wts.sh/api/nr-metadata${query}`) });
const status = (source: unknown) => ({ ok: true, json: async () => ({ icestats: { source } }) });
let log: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  log = vi.spyOn(console, "log").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  log.mockRestore();
});

describe("Nightride metadata route", () => {
  it("returns the matching station's track and logs the Icecast payload", async () => {
    const sources = [
      { listenurl: "https://stream.nightride.fm/nightride.m4a", artist: "Night", title: "Drive", listeners: 7 },
      { listenurl: "https://stream.nightride.fm/chillsynth.m4a", artist: "Chill", title: "Wave", listeners: 3 },
    ];
    const fetch = vi.fn(async () => status(sources));
    vi.stubGlobal("fetch", fetch);
    const response = await GET(request("?stationId=chillsynth"));
    expect(fetch).toHaveBeenCalledWith("https://stream.nightride.fm/status-json.xsl", { headers: { "User-Agent": "WTS-Organizer/1.0" } });
    expect(response.status).toBe(200);
    expect(Object.fromEntries(response.headers)).toEqual({ "cache-control": "no-store", "content-type": "application/json" });
    expect(await response.text()).toBe('{"artist":"Chill","title":"Wave","listeners":3}');
    expect(log.mock.calls).toEqual([[{ icestats: { source: sources } }], [sources]]);
  });

  it("defaults to the nightride station and a single source object", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => status({ listenurl: "https://stream.nightride.fm/nightride.m4a", artist: "", title: "Solo", listeners: 0 })));
    expect(await (await GET(request())).text()).toBe('{"artist":"NIGHTRIDE","title":"Solo","listeners":0}');
  });

  it("falls back to station defaults when no source matches", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => status([{ listenurl: "https://radio.example/other.m4a", artist: "Other" }])));
    expect(await (await GET(request("?stationId=nightride"))).text()).toBe('{"artist":"NIGHTRIDE","title":"RADIO","listeners":0}');
  });

  it.each([
    ["an Icecast error status", async () => ({ ok: false, json: async () => ({}) })],
    ["a network failure", async () => { throw new Error("offline"); }],
    ["a malformed payload", async () => ({ ok: true, json: async () => ({}) })],
  ])("reports offline after %s", async (_name, reply) => {
    vi.stubGlobal("fetch", vi.fn(reply));
    const response = await GET(request());
    expect(response.status).toBe(500);
    expect(await response.text()).toBe('{"artist":"NIGHTRIDE","title":"OFFLINE"}');
  });
});
