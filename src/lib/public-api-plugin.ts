import { definePlugin } from "nitro";
import { publicApiPathGuard } from "~/lib/public-api";

// H3 decodes the pathname while constructing its event, before app middleware.
// Guard only our public API namespace at the outer fetch seam instead.
export default definePlugin((app) => {
  const fetch = app.fetch;
  app.fetch = (request) => publicApiPathGuard(request, async () => fetch(request));
});
