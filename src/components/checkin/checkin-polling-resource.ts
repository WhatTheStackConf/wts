import { createMemo, createSignal } from "solid-js";
import { createAsyncResource, type AsyncResource } from "~/lib/async-resource";

type Source = string | number | boolean | null | undefined;
type Outcome<S, T> = { source: S; ok: true; value: T } | { source: S; ok: false; error: unknown };

/** Check-in JSON read projections only, never commands.
 * Automatic observation retains the last successful same-fence presentation.
 * Explicit refresh and source changes still verify; failures stay unavailable
 * throughout retries (the shared resource clears its error at request start).
 * Reuse equal JSON subtrees so unchanged list rows retain DOM/focus even when
 * a sibling timestamp or another row changes. No field is excluded from equality.
 */
function shareJSON<T>(previous: T, next: T): T {
  if (Object.is(previous, next)) return previous;
  if (!previous || !next || typeof previous !== "object" || typeof next !== "object" || Array.isArray(previous) !== Array.isArray(next)) return next;
  const old = previous as Record<string, unknown>, value = next as Record<string, unknown>;
  const keys = Object.keys(value);
  let equal = keys.length === Object.keys(old).length;
  const shared = (Array.isArray(next) ? [] : {}) as Record<string, unknown>;
  for (const key of keys) {
    shared[key] = shareJSON(old[key], value[key]);
    if (!Object.hasOwn(old, key) || shared[key] !== old[key]) equal = false;
  }
  return equal ? previous : shared as T;
}

export interface CheckinPollingResource<T> extends AsyncResource<T> {
  /** Every in-flight read, including a quiet observation. Use for deduplication. */
  readonly refreshing: boolean;
}
export function createCheckinPollingResource<T>(fetcher: () => Promise<T>): [CheckinPollingResource<T>, { refetch(): Promise<T | undefined>; poll(): Promise<T | undefined> }];
export function createCheckinPollingResource<S extends Source, T>(source: () => S, fetcher: (source: NonNullable<S>) => Promise<T>): [CheckinPollingResource<T>, { refetch(): Promise<T | undefined>; poll(): Promise<T | undefined> }];
export function createCheckinPollingResource<S extends Source, T>(sourceOrFetcher: (() => S) | (() => Promise<T>), maybeFetcher?: (source: NonNullable<S>) => Promise<T>): [CheckinPollingResource<T>, { refetch(): Promise<T | undefined>; poll(): Promise<T | undefined> }] {
  const source = createMemo(() => maybeFetcher ? (sourceOrFetcher as () => S)() : true as S);
  const fetcher = maybeFetcher ?? sourceOrFetcher as (source: NonNullable<S>) => Promise<T>;
  const [quiet, setQuiet] = createSignal(false);
  const [result, actions] = createAsyncResource(source, async (key): Promise<Outcome<S, T>> => {
    try {
      const next = await fetcher(key as NonNullable<S>);
      const old = result();
      return { source: key, ok: true, value: old?.ok && old.source === key ? shareJSON(old.value, next) : next };
    } catch (error) { return { source: key, ok: false, error }; }
  });
  const current = () => { const value = result(); return value?.source === source() ? value : undefined; };
  const value = createMemo(() => { const outcome = current(); return outcome?.ok ? outcome.value : undefined; });
  const resource = (() => value()) as CheckinPollingResource<T>;
  const loading = createMemo(() => result.loading && (!quiet() || !current()?.ok));
  const error = createMemo(() => { const value = current(); return value && !value.ok ? value.error : result.error; });
  Object.defineProperties(resource, {
    loading: { get: loading },
    refreshing: { get: () => result.loading },
    error: { get: error },
  });
  let flight: Promise<T | undefined> | undefined;
  const refresh = (background: boolean) => {
    if (background && flight) return flight;
    // Polls deduplicate, but explicit verification (including after a mutation)
    // must supersede an older observation that may contain pre-command data.
    if (background && result.loading) return Promise.resolve(undefined);
    setQuiet(background);
    const request = actions.refetch().then(outcome => {
      if (outcome && !outcome.ok) throw outcome.error;
      return outcome?.value;
    }).finally(() => {
      if (flight === request) { flight = undefined; setQuiet(false); }
    });
    flight = request;
    return request;
  };
  return [resource, { refetch: () => refresh(false), poll: () => refresh(true) }];
}
