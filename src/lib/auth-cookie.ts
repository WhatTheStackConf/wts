/**
 * Helper to set/remove the pb_auth cookie for server-side access.
 * This is needed because standard PocketBase SDK defaults to localStorage,
 * which isn't sent to Server Actions.
 */

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

    // Create a cookie string that PocketBase's loadFromCookie can parse
    // format usually expected: pb_auth={token:...; model:...} (serialized)
    // But simply setting the token might be enough if we manually re-construct?
    // Actually, pb.authStore.exportToCookie() is the best way if available.

    // However, we are likely using the SDK instance. 
    // Let's rely on the SDK's built-in export if possible, or construct it manually.

    // Standard PB cookie format:
    // pb_auth=TOKEN
    // OR JSON encoded: {"token":"...","model":{...}}

    // For simplicity and compatibility with loadFromCookie:
    // The SDK expects the value to be the JSON string of { token, model }

    const val = JSON.stringify({ token, model });
    const secure = location.protocol === 'https:' ? '; Secure' : '';

    document.cookie = `pb_auth=${encodeURIComponent(val)}; Path=/; SameSite=Strict${secure}; Max-Age=34560000`; // 400 days
}

export function clearAuthCookie() {
    if (typeof document === 'undefined') return;
    document.cookie = 'pb_auth=; Path=/; Expires=Thu, 01 Jan 1970 00:00:01 GMT; SameSite=Strict';
}
