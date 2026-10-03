import { logout } from "../../server/site-sessions.ts";

export function POST({ request }: { request: Request }) {
  return logout(request);
}

export function GET({ request }: { request: Request }) {
  return logout(request);
}
