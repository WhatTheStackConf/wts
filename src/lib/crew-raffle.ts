import { createHash, timingSafeEqual } from "node:crypto";
import { crewRaffleHtml, crewRaffleCsp } from "~/lib/crew-raffle-page";

export interface CrewRaffleRow {
  accountId: string;
  name: string;
  email: string;
  username: string;
  publicHandle: string;
  role: string;
  xp: number;
  achievements: number;
}

export interface CrewRaffleConfig {
  tokenSha256?: string;
  expiresAt?: string;
}

const headers = {
  "Cache-Control": "private, no-store, max-age=0",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow, noarchive, nosnippet",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Vary": "Authorization",
  "Content-Security-Policy": crewRaffleCsp,
};

export function isCrewRafflePath(path: string): boolean {
  return path === "/crew-raffle" || path === "/api/crew-raffle";
}

/** Link possession is the read-only capability; never accept a URL query token. */
export async function crewRaffleResponse(
  request: Request,
  load: () => Promise<CrewRaffleRow[]>,
  config: CrewRaffleConfig,
  now: () => number = Date.now,
): Promise<Response> {
  const deny = () => new Response("Link unavailable or expired.", { status: 404, headers });
  const expiry = Date.parse(config.expiresAt || "");
  if (!/^[a-f0-9]{64}$/.test(config.tokenSha256 || "") || !Number.isFinite(expiry) || now() >= expiry) return deny();
  const path = new URL(request.url).pathname;
  if (!isCrewRafflePath(path)) return deny();
  if (path === "/api/crew-raffle") {
    const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(request.headers.get("authorization") || "");
    if (!match) return deny();
    const supplied = createHash("sha256").update(match[1]).digest();
    if (!timingSafeEqual(supplied, Buffer.from(config.tokenSha256!, "hex"))) return deny();
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405, headers: { ...headers, Allow: "GET, HEAD" } });
  }
  if (path === "/crew-raffle") {
    return new Response(request.method === "HEAD" ? null : crewRaffleHtml, {
      headers: { ...headers, "Content-Type": "text/html; charset=utf-8" },
    });
  }
  if (request.method === "HEAD") return new Response(null, { headers: { ...headers, "Content-Type": "application/json" } });
  try {
    const source = await load();
    // Expiry may pass while the database request is in flight.
    if (now() >= expiry) return deny();
    const rows = source.filter(row => row.xp > 0).sort((a, b) => b.xp - a.xp || a.accountId.localeCompare(b.accountId));
    const seen = new Set<string>();
    const safeRows = rows.map(row => {
      if (seen.has(row.accountId)) throw new Error("Duplicate account");
      seen.add(row.accountId);
      return {
        accountId: row.accountId, name: row.name, email: row.email, username: row.username,
        publicHandle: row.publicHandle, role: row.role, xp: row.xp, achievements: row.achievements,
      };
    });
    return Response.json({ rows: safeRows, total: safeRows.length, updatedAt: new Date(now()).toISOString(), expiresAt: new Date(expiry).toISOString() }, { headers });
  } catch {
    // Do not echo upstream errors, identities, credentials or request headers.
    return Response.json({ error: "Leaderboard unavailable. Please retry." }, { status: 503, headers });
  }
}
