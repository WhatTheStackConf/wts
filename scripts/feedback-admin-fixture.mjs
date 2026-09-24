import { randomBytes } from "node:crypto";
import PocketBase from "pocketbase";

/** Synthetic, disposable-only fixture. Never accepts a production client. */
export async function seedFeedbackAdmin(fixture) {
  if (new URL(fixture.baseUrl).hostname !== "127.0.0.1" || !fixture.root.includes("wts-feedback-test-")) throw new Error("Disposable database required");
  const pb = fixture.pb;
  await pb.collections.create({ name: "conference_config", type: "base", listRule: "", viewRule: "", fields: [{ type: "bool", name: "cfp_open" }] });
  const users = await pb.collections.getOne("users");
  await pb.collections.update(users.id, { fields: [...users.fields, { type: "select", name: "role", maxSelect: 1, values: ["admin", "reviewer", "user", "speaker", "mc", "checkin_operator"] }] });
  const accounts = {};
  for (const role of ["admin", "reviewer", "user", "speaker", "mc", "checkin_operator"]) {
    const email = `${role}@example.test`, password = randomBytes(24).toString("hex");
    await pb.collection("users").create({ email, password, passwordConfirm: password, role, verified: true, name: `Synthetic ${role}` });
    const client = new PocketBase(fixture.baseUrl);
    const auth = await client.collection("users").authWithPassword(email, password);
    accounts[role] = { email, password, token: auth.token };
  }
  const email = "results-server@example.test", password = randomBytes(24).toString("hex");
  await pb.collection("_superusers").create({ email, password, passwordConfirm: password });
  const sessions = [{ id: "session-four", title: "Designing resilient systems" }, { id: "session-five", title: "Making the web accessible" }];
  const live = await pb.collection("feedback_surveys").create({ key: "wts-2026-main-day-feedback", title: "WTS 2026 main-day feedback", opens_at: "2026-09-01T00:00:00.000Z", closes_at: "2026-10-01T00:00:00.000Z", version: "v1", sessions });
  const empty = await pb.collection("feedback_surveys").create({ key: "fixture-empty", title: "Empty synthetic survey", opens_at: "2026-09-01T00:00:00.000Z", closes_at: "2026-10-01T00:00:00.000Z", version: "v1", sessions });
  const test = await pb.collection("feedback_surveys").create({ key: "wts-2026-organizer-test", title: "Organizer test excluded", opens_at: "2026-09-01T00:00:00.000Z", closes_at: "2026-10-01T00:00:00.000Z", version: "v1", sessions });
  const answer = { overall: 4, parts: {}, keep: "", change: "", more: [], moreOther: "", sessions: [] };
  for (let i = 0; i < 6; i++) await pb.collection("feedback_responses").create({ survey: live.id, version: "v1", answers: {
    ...answer, overall: i < 3 ? 5 : 3,
    parts: i < 4 ? { content: 4, organisation: 5, venue: "na" } : {},
    keep: i === 0 ? '<img src=x onerror="window.feedbackXss=true">' : i === 1 ? "Keep the friendly atmosphere and practical talks." : "",
    change: i < 2 ? "A little more time between sessions would help." : "",
    more: i < 3 ? ["technical", "workshops"] : ["other"], moreOther: i >= 3 ? "More time for informal conversations." : "",
    sessions: [
      { sessionId: sessions[0].id, ...(i < 4 ? { usefulness: 1 } : {}), comment: i === 0 ? "More examples, please." : "Useful session discussion." },
      { sessionId: sessions[1].id, ...(i < 5 ? { usefulness: 5 } : {}), comment: i === 0 ? "Practical and clear." : "Thoughtful presentation." },
    ],
  } });
  await pb.collection("feedback_responses").create({ survey: test.id, version: "v1", answers: { ...answer, overall: 1, keep: "EXCLUDED ORGANIZER TEST COMMENT" } });
  return { accounts, server: { email, password }, surveys: { live: live.id, empty: empty.id, test: test.id } };
}
