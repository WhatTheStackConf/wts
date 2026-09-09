export function isCheckinPath(pathname: string): boolean {
  return pathname === "/api/checkin-events" || /^\/(?:admin\/|api\/)?checkin(?:\/|$)/.test(pathname);
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
