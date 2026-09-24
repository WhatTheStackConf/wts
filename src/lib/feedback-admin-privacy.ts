export function isFeedbackAdminPath(pathname: string): boolean {
  try { return /^\/(?:api\/)?admin\/feedback\/*$/i.test(decodeURIComponent(pathname)); } catch { return false; }
}
