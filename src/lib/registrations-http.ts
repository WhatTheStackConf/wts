import { isSameOriginMutation } from "./session-policy";
import { protectCheckinResponse } from "./checkin-privacy";
import { registrationRosterSchema, type RegistrationRoster } from "./registrations-contract";
interface Actor { id: string; role: string }
export interface RegistrationDependencies { authenticate(): Promise<Actor>; read(): Promise<RegistrationRoster> }
const allowed = (actor: Actor) => !!actor.id && ["admin", "checkin_operator"].includes(actor.role);
function response(body: unknown, status = 200) { return protectCheckinResponse(Response.json(body, { status })); }
/** POST is the existing cookie/session read transport, not an upstream mutation. */
export async function handleRegistrations(request: Request, deps: RegistrationDependencies): Promise<Response> {
  if (!isSameOriginMutation(request)) return response({ error: "Registration access denied." }, 403);
  let actor: Actor;
  try { actor = await deps.authenticate(); if (!allowed(actor)) throw new Error(); }
  catch { return response({ error: "Registration access denied." }, 403); }
  let roster: RegistrationRoster;
  try { roster = registrationRosterSchema.parse(await deps.read()); }
  catch { return response({ error: "Registrations unavailable. Refresh to try again." }, 503); }
  try { const current = await deps.authenticate(); if (!allowed(current) || current.id !== actor.id || current.role !== actor.role) throw new Error(); }
  catch { return response({ error: "Registration access denied." }, 403); }
  return response(roster);
}
