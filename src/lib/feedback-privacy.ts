/** Match the page router's case/trailing-slash aliases at the privacy boundary. */
export function isFeedbackPath(pathname: string): boolean {
  let path = pathname;
  try { path = decodeURIComponent(path); } catch { return false; }
  path = path.toLowerCase().replace(/\/+$/, "");
  return path === "/feedback" || path === "/api/feedback";
}

export function protectFeedbackResponse(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "private, no-store");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  headers.set("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; font-src 'self'; object-src 'none'; frame-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  headers.delete("Set-Cookie");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
