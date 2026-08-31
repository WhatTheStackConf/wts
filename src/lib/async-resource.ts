import { createEffect, createSignal, onCleanup } from "solid-js";

type DisabledSource = false | null | undefined;
type ResourceValue<T> = T | undefined;
type ResourceUpdater<T> = T | undefined | ((previous: ResourceValue<T>) => ResourceValue<T>);

export interface AsyncResource<T> {
  (): ResourceValue<T>;
  readonly loading: boolean;
  readonly error: unknown;
}

export interface AsyncResourceActions<T> {
  refetch(): Promise<ResourceValue<T>>;
  mutate(updater: ResourceUpdater<T>): ResourceValue<T>;
}

export function createAsyncResource<T>(
  fetcher: () => T | Promise<T>,
): [AsyncResource<T>, AsyncResourceActions<T>];
export function createAsyncResource<S, T>(
  source: () => S | DisabledSource,
  fetcher: (source: S) => T | Promise<T>,
): [AsyncResource<T>, AsyncResourceActions<T>];
export function createAsyncResource<S, T>(
  sourceOrFetcher: (() => S | DisabledSource) | (() => T | Promise<T>),
  maybeFetcher?: (source: S) => T | Promise<T>,
): [AsyncResource<T>, AsyncResourceActions<T>] {
  const source = maybeFetcher ? (sourceOrFetcher as () => S | DisabledSource) : undefined;
  const fetcher = (maybeFetcher ?? sourceOrFetcher) as (source?: S) => T | Promise<T>;

  const [value, setValue] = createSignal<ResourceValue<T>>();
  const [loading, setLoading] = createSignal(!source);
  const [error, setError] = createSignal<unknown>();
  const [revision, setRevision] = createSignal(0);
  let override: { active: false } | { active: true; value: ResourceValue<T> } = {
    active: false,
  };
  let requestId = 0;
  let disposed = false;

  const run = (sourceValue: S | undefined, rethrow: boolean) => {
    const currentRequest = ++requestId;
    setLoading(true);
    setError(undefined);

    return Promise.resolve()
      .then(() => {
        if (!source) return fetcher();
        if (sourceValue === false || sourceValue === null || sourceValue === undefined) {
          return undefined;
        }
        return fetcher(sourceValue);
      })
      .then((nextValue) => {
        if (!disposed && currentRequest === requestId) {
          setValue(() => nextValue);
          setLoading(false);
        }
        return nextValue;
      })
      .catch((nextError) => {
        if (!disposed && currentRequest === requestId) {
          setError(nextError);
          setLoading(false);
        }
        if (rethrow) throw nextError;
        return undefined;
      });
  };

  createEffect(
    () => source ? source() : true,
    (sourceValue) => {
      if (source && (sourceValue === false || sourceValue === null || sourceValue === undefined)) {
        requestId += 1;
        setValue(undefined);
        setLoading(false);
        setError(undefined);
        return;
      }
      void run(sourceValue as S | undefined, false);
    },
  );

  onCleanup(() => {
    disposed = true;
    requestId += 1;
  });

  const resource = (() => {
    revision();
    return override.active ? override.value : value();
  }) as AsyncResource<T>;

  Object.defineProperty(resource, "loading", {
    enumerable: true,
    get: () => loading(),
  });
  Object.defineProperty(resource, "error", {
    enumerable: true,
    get: () => error(),
  });

  const mutate = (updater: ResourceUpdater<T>) => {
    const previous = override.active ? override.value : value();
    const nextValue = typeof updater === "function"
      ? (updater as (previous: ResourceValue<T>) => ResourceValue<T>)(previous)
      : updater;
    override = { active: true, value: nextValue };
    setRevision((current) => current + 1);
    return nextValue;
  };

  const refetch = async () => {
    override = { active: false };
    setRevision((current) => current + 1);
    const sourceValue = source?.();
    if (source && (sourceValue === false || sourceValue === null || sourceValue === undefined)) {
      setValue(undefined);
      setLoading(false);
      setError(undefined);
      return undefined;
    }
    return run(sourceValue as S | undefined, true);
  };

  return [resource, { mutate, refetch }];
}
