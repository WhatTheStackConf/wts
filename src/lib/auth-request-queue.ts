export interface AuthRequestLock {
  run<T>(request: () => Promise<T>): Promise<T>;
}

const browserAuthRequestLock: AuthRequestLock = {
  run<T>(request: () => Promise<T>): Promise<T> {
    if (typeof navigator !== "undefined" && navigator.locks) {
      return new Promise<T>((resolve, reject) => {
        void navigator.locks
          .request("wts-auth-session", () => request().then(resolve, reject))
          .catch(reject);
      });
    }
    return request();
  },
};

export function createAuthRequestQueue(lock: AuthRequestLock = browserAuthRequestLock) {
  let queue: Promise<void> = Promise.resolve();

  return function enqueue<T>(request: () => Promise<T>): Promise<T> {
    const lockedRequest = () => lock.run(request);
    const result = queue.then(lockedRequest, lockedRequest);
    queue = result.then(() => undefined, () => undefined);
    return result;
  };
}
