import { finishLogin } from "../../server/cfp-sessions.ts";

export async function GET({ request }: { request: Request }) {
  try {
    return await finishLogin(request);
  } catch (error) {
    if (error instanceof Response) return error;
    return new Response("The application could not complete sign-in. Start a new sign-in attempt.", {
      status: 503, headers: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" },
    });
  }
}
