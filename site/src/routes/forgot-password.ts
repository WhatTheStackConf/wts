import { centralAccountRedirect } from "../server/site-sessions.ts";

export function GET({ request }: { request: Request }) {
  return centralAccountRedirect(request, "/recovery");
}