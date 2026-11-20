export type App = "site" | "cfp" | "auth" | "blog";

/** The body class each app needs before its CSS applies. */
export const APP_ROOT_CLASS: Record<App, string> = {
  site: "",
  cfp: "",
  auth: "",
  blog: "",
};
