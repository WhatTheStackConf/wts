import { startLogin } from "../../server/cfp-sessions.ts";

export async function GET({ request }: { request: Request }) {
  try {
    return await startLogin(request);
  } catch (error) {
    if (error instanceof Response) return error;
    return new Response("The application could not start sign-in. Try again later.", {
      status: 503, headers: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" },
    });
  }
}
