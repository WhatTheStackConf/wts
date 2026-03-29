// src/routes/api/nr-metadata-sse.ts
export async function GET() {
  const response = await fetch("https://nightride.fm/api/v2/messenger/lp", {
    headers: {
      Accept: "text/event-stream",
      "User-Agent": "WTS-Organizer/1.0",
    },
  });

  console.log(response);

  return new Response(response.body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // Important for Nginx/Vercel proxies
    },
  });
}
