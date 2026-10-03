import { logout } from "../../server/cfp-sessions.ts";

export async function POST({ request }: { request: Request }) {
  try {
    return await logout(request);
  } catch (error) {
    if (error instanceof Response) return error;
    return new Response("The application could not sign out. Try again later.", {
      status: 503, headers: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" },
    });
  }
}

export function GET({ request }: { request: Request }) {
  return logout(request);
}
