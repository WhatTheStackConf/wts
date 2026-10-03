import { finishLogin } from "../../server/site-sessions.ts";

export function GET({ request }: { request: Request }) {
  return finishLogin(request);
}
