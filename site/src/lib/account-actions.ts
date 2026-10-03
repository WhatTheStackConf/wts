import { getRequestEvent } from "@solidjs/web";
import type { AccountSession } from "~/lib/account-model";
import { readAccount } from "~/server/site-sessions";

export async function getAccount(): Promise<AccountSession | null> {
  "use server";
  const event = getRequestEvent();
  if (!event) throw new Error("The account request is unavailable.");
  event.response.headers.set("Cache-Control", "private, no-store");
  return readAccount(event.request);
}
