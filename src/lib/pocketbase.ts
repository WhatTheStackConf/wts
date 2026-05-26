import PocketBase from "pocketbase";
import { getPocketBasePublicBaseUrl } from "~/lib/pocketbase-public-url";

// Browser-facing PocketBase client — always uses the public base URL.
const pocketBaseInstance = new PocketBase(getPocketBasePublicBaseUrl());

export default pocketBaseInstance;