import PocketBase, { BaseAuthStore } from "pocketbase";
import { getPocketBasePublicBaseUrl } from "~/lib/pocketbase-public-url";

// Browser-facing PocketBase client — always uses the public base URL.
// OAuth needs a short-lived browser token, but durable sessions live only in
// the server-set HttpOnly cookie. BaseAuthStore never writes browser storage.
const pocketBaseInstance = new PocketBase(
  getPocketBasePublicBaseUrl(),
  new BaseAuthStore(),
);

export default pocketBaseInstance;
