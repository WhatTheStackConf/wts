// src/routes/api/nr-metadata.ts
export async function GET({ request }: { request: Request }) {
  try {
    const url = new URL(request.url);
    const stationId = url.searchParams.get("stationId") || "nightride";

    const res = await fetch("https://stream.nightride.fm/status-json.xsl", {
      headers: { "User-Agent": "WTS-Organizer/1.0" },
    });

    if (!res.ok) throw new Error("Icecast Down");
    const data = await res.json();

    console.log(data);

    // Icecast structure can be an array or an object if only one source exists
    const sources = data.icestats.source;
    console.log(sources);
    const sourceList = Array.isArray(sources) ? sources : [sources];

    // Match the station based on the mount point/URL
    const source = sourceList.find((s: any) => s.listenurl.includes(stationId));

    return new Response(
      JSON.stringify({
        artist: source?.artist || "NIGHTRIDE",
        title: source?.title || "RADIO",
        listeners: source?.listeners || 0,
      }),
      {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ artist: "NIGHTRIDE", title: "OFFLINE" }),
      { status: 500 },
    );
  }
}
