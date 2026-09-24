import { randomInt } from "node:crypto";
import type PocketBase from "pocketbase";
import { z } from "zod";
import { aggregateFeedback, MAIN_FEEDBACK_KEY, resultsSurveySchema, type FeedbackResults } from "./feedback-results";

const record = z.object({ id: z.string().min(1), survey: z.string().min(1), version: z.string(), answers: z.unknown() });
const pageSchema = z.object({ page: z.number().int(), perPage: z.number().int().positive(), totalItems: z.number().int().nonnegative(), totalPages: z.number().int().nonnegative(), items: z.array(record) });
function shuffle(values: string[]): void {
  for (let i = values.length - 1; i > 0; i--) { const j = randomInt(i + 1); [values[i], values[j]] = [values[j], values[i]]; }
}
/** Server-only. Caller must authorize before obtaining the privileged client. */
export async function loadFeedbackResults(pb: PocketBase): Promise<FeedbackResults> {
  const signal = AbortSignal.timeout(20_000);
  const found = await pb.collection("feedback_surveys").getList(1, 2, {
    filter: pb.filter("key = {:key}", { key: MAIN_FEEDBACK_KEY }), fields: "id,key,title,version,sessions", signal,
  });
  if (found.totalItems !== 1 || found.items.length !== 1) throw new Error("Survey unavailable");
  const survey = z.object({ id: z.string().min(1), key: z.literal(MAIN_FEEDBACK_KEY) }).parse(found.items[0]);
  const catalogue = resultsSurveySchema.parse(found.items[0]);
  const options = { filter: pb.filter("survey = {:survey}", { survey: survey.id }), fields: "id,survey,version,answers", sort: "id", signal };
  const answers: unknown[] = [];
  const seen = new Set<string>();
  let total: number | undefined;
  for (let page = 1; ; page++) {
    const result = pageSchema.parse(await pb.collection("feedback_responses").getList(page, 200, options));
    total ??= result.totalItems;
    if (result.page !== page || result.perPage !== 200 || result.totalItems !== total || result.totalPages !== Math.ceil(total / 200) || result.items.length !== Math.min(200, total - answers.length)) throw new Error("Incomplete results");
    for (const item of result.items) {
      if (seen.has(item.id) || item.survey !== survey.id || item.version !== catalogue.version || item.answers === undefined) throw new Error("Invalid results");
      seen.add(item.id); answers.push(item.answers);
    }
    if (answers.length === total) break;
  }
  // Fail closed if additions/removals changed pagination during this read.
  const check = await pb.collection("feedback_responses").getList(1, 1, { ...options, fields: "id" });
  if (check.totalItems !== total) throw new Error("Results changed; retry");
  const result = aggregateFeedback(catalogue, answers);
  for (const group of [...result.comments, ...result.sessions]) shuffle(group.comments);
  return result;
}
