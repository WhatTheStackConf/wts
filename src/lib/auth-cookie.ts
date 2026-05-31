import pb from "./pocketbase";

const TOKEN_AGE_BUFFER = 60; // expire cookie 60s before the JWT

function tokenMaxAge(token: string): number {
  try {
    const payload = JSON.parse(
      atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")),
    );
    if (typeof payload.exp === "number") {
      const remaining = payload.exp - Math.floor(Date.now() / 1000);
      return Math.max(remaining - TOKEN_AGE_BUFFER, 0);
    }
  } catch {
    // malformed token — fall through to default
  }
  return 7 * 24 * 60 * 60; // 7 days fallback
}

export function loadAuthCookie() {
    if (typeof document === 'undefined') return;

    const raw = document.cookie.split(';').find(c => c.trim().startsWith('pb_auth='));
    if (raw) {
        return raw.split('=')[1];
    }
    return null;
}

export function setAuthCookie(token: string, model: any) {
    if (typeof document === 'undefined') return;

    const maxAge = tokenMaxAge(token);

    // Use the SDK's built-in export to ensure compatibility with loadFromCookie
    // We must ensure the store has the token/model we want to save
    // (It should, as this is called after login)

    // Note: We use Lax instead of Strict to allow cookies on top-level navigation from external sites
    const cookieStr = pb.authStore.exportToCookie({
        httpOnly: false, // must be false — browsers reject HttpOnly from document.cookie
        secure: location.protocol === 'https:',
        sameSite: 'Lax',
        maxAge,
    });

    document.cookie = cookieStr;
}

export function clearAuthCookie() {
    if (typeof document === 'undefined') return;
    document.cookie = 'pb_auth=; Path=/; Expires=Thu, 01 Jan 1970 00:00:01 GMT; SameSite=Strict';
}
