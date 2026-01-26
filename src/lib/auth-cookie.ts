import pb from "./pocketbase";

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

    // Use the SDK's built-in export to ensure compatibility with loadFromCookie
    // We must ensure the store has the token/model we want to save
    // (It should, as this is called after login)

    // Note: We use Lax instead of Strict to allow cookies on top-level navigation from external sites
    const cookieStr = pb.authStore.exportToCookie({
        httpOnly: false,
        secure: location.protocol === 'https:',
        sameSite: 'Lax',
        // Set a long max age (default is session)
        expires: new Date(Date.now() + 34560000 * 1000)
    });

    document.cookie = cookieStr;
}

export function clearAuthCookie() {
    if (typeof document === 'undefined') return;
    document.cookie = 'pb_auth=; Path=/; Expires=Thu, 01 Jan 1970 00:00:01 GMT; SameSite=Strict';
}
