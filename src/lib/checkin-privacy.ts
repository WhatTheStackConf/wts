export function isCheckinPath(pathname: string): boolean {
  // The router is case-insensitive and accepts a trailing slash. Apply the
  // privacy boundary to those same routes, not just their canonical spelling.
  let path = pathname;
  try { path = decodeURIComponent(path); } catch { /* Invalid route remains unmatched. */ }
  path = path.toLowerCase().replace(/\/+$/, "");
  return ["/registrations", "/api/registrations", "/checkin-tools", "/api/checkin-arrival-resume", "/api/checkin-lookup", "/api/checkin-monitoring", "/api/checkin-lifecycle", "/api/checkin-events", "/api/checkin-labels", "/api/checkin-arrivals"].includes(path) || /^\/(?:admin\/|api\/)?checkin(?:\/|$)/.test(path);
}

/** A fresh document at the operational boundary has no third-party execution or
 * connections. Entry links use native navigation so marketing scripts from the
 * preceding document cannot observe station operations. */
export function protectCheckinResponse(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "private, no-store");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("X-Robots-Tag", "noindex, nofollow");
  headers.set("Content-Security-Policy", "script-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
