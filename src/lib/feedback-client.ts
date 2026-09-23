import { FEEDBACK_TOKEN_PATTERN, type FeedbackAnswers, type FeedbackCommand, type FeedbackResult, type FeedbackSurvey } from "./feedback-contract";

type SubmitCommand = Extract<FeedbackCommand, { action: "submit" }>;

/** One in-memory invitation owns one frozen command until its outcome is known. */
export function createFeedbackSubmission(token: string, version: string, request = feedbackRequest) {
  let command: SubmitCommand | undefined;
  let pending: Promise<FeedbackResult> | undefined;
  let terminal: FeedbackResult | undefined;
  let uncertain = false;
  return {
    locked: () => !!command,
    submit(answers?: FeedbackAnswers): Promise<FeedbackResult> {
      if (pending) return pending;
      if (terminal) return Promise.resolve(terminal);
      if (!command) {
        if (!answers) return Promise.resolve({ state: "invalid_answers" });
        command = { action: "submit", token, version, answers: structuredClone(answers) };
      }
      pending = request(command).catch((): FeedbackResult => ({ state: "unavailable" })).then(result => {
        if (result.state === "ready" || (result.state === "invalid_answers" && uncertain)) result = { state: "unavailable" };
        if (result.state === "unavailable") uncertain = true;
        else if (result.state === "invalid_answers") command = undefined;
        else { terminal = result; command = undefined; token = ""; }
        return result;
      }).finally(() => { pending = undefined; });
      return pending;
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function validSurvey(value: unknown): value is FeedbackSurvey {
  if (!isRecord(value) || typeof value.title !== "string" || !value.title.trim()
    || typeof value.version !== "string" || !value.version.trim()
    || typeof value.closesAt !== "string" || !Number.isFinite(Date.parse(value.closesAt))
    || !Array.isArray(value.sessions)) return false;
  const ids = new Set<string>();
  return value.sessions.every(session => {
    if (!isRecord(session) || typeof session.id !== "string" || !session.id.trim()
      || typeof session.title !== "string" || !session.title.trim() || ids.has(session.id)) return false;
    ids.add(session.id);
    return true;
  });
}

export async function feedbackRequest(command: FeedbackCommand, fetcher: typeof fetch = fetch): Promise<FeedbackResult> {
  try {
    const response = await fetcher("/api/feedback", {
      method: "POST", credentials: "omit", referrerPolicy: "no-referrer", referrer: "",
      cache: "no-store", redirect: "error", signal: AbortSignal.timeout(20_000),
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify(command),
    });
    // A size rejection is not an invalid invitation, even from an HTML proxy error.
    if (response.status === 413 && command.action === "submit") return { state: "invalid_answers" };
    const body: unknown = await response.json();
    if (!isRecord(body)) return { state: "unavailable" };
    if (body.state === "ready" && response.ok && validSurvey(body.survey)) return { state: "ready", survey: body.survey };
    if (body.state === "submitted" && response.ok) return { state: "submitted" };
    if (body.state === "invalid" || body.state === "used" || body.state === "expired"
      || body.state === "closed" || body.state === "unavailable" || body.state === "invalid_answers") return { state: body.state };
  } catch {
    // An interrupted POST may have committed. The caller keeps its exact command for retry.
  }
  return { state: "unavailable" };
}

/** Read once into the caller's memory, then scrub even malformed invitation URLs. */
export function consumeFeedbackToken(
  location: Pick<Location, "hash" | "pathname" | "search">,
  history: Pick<History, "replaceState">,
): string | undefined {
  const fragment = location.hash;
  try {
    history.replaceState(null, "", location.pathname);
  } catch {
    return undefined;
  }
  const token = fragment.startsWith("#token=") ? fragment.slice(7) : "";
  return FEEDBACK_TOKEN_PATTERN.test(token) ? token : undefined;
}
