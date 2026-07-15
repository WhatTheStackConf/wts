import { createContext, createSignal, onMount, useContext, type JSX } from "solid-js";
import { pb, loginWithGithub, loginWithGoogle } from "~/lib/pocketbase-utils";
import {
  getSession,
  serverLogin,
  serverLoginWithToken,
  serverLogout,
} from "~/lib/server-auth";
import {
  LEGACY_AUTH_STORAGE_KEYS,
  legacyTokenFromStorage,
  type SessionUser,
} from "~/lib/session-policy";
import { createAuthRequestQueue } from "~/lib/auth-request-queue";

interface AuthContextType {
  isAuthenticated: () => boolean;
  login: (email: string, password: string) => Promise<SessionUser>;
  logout: () => Promise<void>;
  refresh: () => Promise<SessionUser | null>;
  readonly record: SessionUser | null;
  readonly user: SessionUser | null;
  isLoading: () => boolean;
  githubLogin: () => Promise<SessionUser>;
  googleLogin: () => Promise<SessionUser>;
}

const AuthContext = createContext<AuthContextType>();

function removeLegacyBrowserAuth(): void {
  for (const key of LEGACY_AUTH_STORAGE_KEYS) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Storage cleanup is best-effort after the server session changes.
    }
    try {
      window.sessionStorage.removeItem(key);
    } catch {
      // Storage cleanup is best-effort after the server session changes.
    }
  }
}

function readLegacyBrowserToken(): string | null {
  for (const key of LEGACY_AUTH_STORAGE_KEYS) {
    try {
      const token = legacyTokenFromStorage(window.localStorage.getItem(key));
      if (token) return token;
    } catch {
      return null;
    }
  }
  return null;
}

function isUnauthorizedError(error: unknown): boolean {
  return error instanceof Error && error.message === "Unauthorized";
}

export const AuthProvider = (props: { children: JSX.Element }) => {
  const [record, setRecord] = createSignal<SessionUser | null>(null);
  const [loading, setLoading] = createSignal(true);
  const enqueueAuthRequest = createAuthRequestQueue();

  const refresh = async (): Promise<SessionUser | null> => {
    return enqueueAuthRequest(async () => {
      const user = await getSession();
      setRecord(user);
      return user;
    });
  };

  onMount(() => {
    void enqueueAuthRequest(async () => {
      setLoading(true);
      try {
        let user = await getSession();
        if (!user) {
          const legacyToken = readLegacyBrowserToken();
          if (legacyToken) {
            try {
              user = await serverLoginWithToken(legacyToken);
            } catch (error) {
              if (!isUnauthorizedError(error)) throw error;
            }
          }
        }
        setRecord(user);
        removeLegacyBrowserAuth();
      } catch (error) {
        console.error("Could not restore the authenticated session.", error);
      } finally {
        pb.authStore.clear();
        setLoading(false);
      }
    });
  });

  const login = async (email: string, password: string): Promise<SessionUser> => {
    return enqueueAuthRequest(async () => {
      setLoading(true);
      try {
        const user = await serverLogin(email, password);
        setRecord(user);
        removeLegacyBrowserAuth();
        return user;
      } finally {
        setLoading(false);
      }
    });
  };

  const oauthLogin = async (
    authenticate: () => Promise<{ token: string }>,
  ): Promise<SessionUser> => {
    return enqueueAuthRequest(async () => {
      setLoading(true);
      try {
        const authData = await authenticate();
        pb.authStore.clear();
        const user = await serverLoginWithToken(authData.token);
        setRecord(user);
        removeLegacyBrowserAuth();
        return user;
      } finally {
        pb.authStore.clear();
        setLoading(false);
      }
    });
  };

  const logout = async (): Promise<void> => {
    return enqueueAuthRequest(async () => {
      setLoading(true);
      try {
        await serverLogout();
        pb.authStore.clear();
        removeLegacyBrowserAuth();
        setRecord(null);
      } finally {
        setLoading(false);
      }
    });
  };

  const value: AuthContextType = {
    isAuthenticated: () => !!record()?.verified,
    login,
    logout,
    refresh,
    githubLogin: () => oauthLogin(loginWithGithub),
    googleLogin: () => oauthLogin(loginWithGoogle),
    get record() {
      return record();
    },
    get user() {
      return record();
    },
    isLoading: loading,
  };

  return <AuthContext.Provider value={value}>{props.children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within an AuthProvider");
  return context;
};
