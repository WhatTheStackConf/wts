export type AuthRequestQueue = <T>(request: () => Promise<T>) => Promise<T>;

interface OAuthLoginOptions<TAuth, TSession> {
  authenticate: () => Promise<TAuth>;
  enqueueSession: AuthRequestQueue;
  establishSession: (auth: TAuth) => Promise<TSession>;
  setLoading: (loading: boolean) => void;
  cleanup: () => void;
}

/**
 * Starts the browser OAuth flow before entering the asynchronous session queue.
 * Safari only permits the provider popup while the original click still has
 * user activation; the resulting token exchange remains serialized.
 */
export function startOAuthLogin<TAuth, TSession>(
  options: OAuthLoginOptions<TAuth, TSession>,
): Promise<TSession> {
  options.setLoading(true);

  let authentication: Promise<TAuth>;
  try {
    // Keep this synchronous with the caller so the SDK can open its popup.
    authentication = options.authenticate();
    // The session queue can be held by another tab; mark an early OAuth
    // rejection as handled until the queued exchange observes it.
    void authentication.catch(() => undefined);
  } catch (error) {
    options.cleanup();
    options.setLoading(false);
    return Promise.reject(error);
  }

  let session: Promise<TSession>;
  try {
    session = options.enqueueSession(async () =>
      options.establishSession(await authentication),
    );
  } catch (error) {
    options.cleanup();
    options.setLoading(false);
    return Promise.reject(error);
  }

  return session.finally(() => {
    options.cleanup();
    options.setLoading(false);
  });
}
