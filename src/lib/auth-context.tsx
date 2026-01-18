import {
  createContext,
  useContext,
  createSignal,
  onMount,
  onCleanup,
} from "solid-js";
import {
  pb,
  isAuthenticated as isAuthenticatedUtil,
  getCurrentUser,
  login as loginUtil,
  logout as logoutUtil,
  loginWithGithub,
  loginWithGoogle,
} from "~/lib/pocketbase-utils";

import { UserRecord } from "~/lib/pocketbase-types";

interface AuthContextType {
  isAuthenticated: () => boolean;
  login: (email: string, password: string) => Promise<any>;
  logout: () => void;
  record: UserRecord | null;
  user: UserRecord | null; // Alias for record
  isLoading: () => boolean;
  githubLogin: () => Promise<any>;
  googleLogin: () => Promise<any>;
}

const AuthContext = createContext<AuthContextType>();

export const AuthProvider = (props: { children: any }) => {
  const [record, setRecord] = createSignal<UserRecord | null>(pb.authStore.record as unknown as UserRecord | null);
  const [loading, setLoading] = createSignal(true);

  // Check auth status on mount
  onMount(() => {
    setLoading(true);
    setRecord(pb.authStore.record as unknown as UserRecord | null);
    setLoading(false);
  });

  // Listen for auth changes
  const unlisten = pb.authStore.onChange(() => {
    setRecord(pb.authStore.record as unknown as UserRecord | null);
  });

  // Clean up listener
  onCleanup(() => {
    if (unlisten) unlisten();
  });

  const login = async (email: string, password: string) => {
    setLoading(true);
    try {
      const userData = await loginUtil(email, password);
      // Ensure record matches UserRecord
      setRecord(userData.record as unknown as UserRecord);
      return userData;
    } finally {
      setLoading(false);
    }
  };

  const githubLogin = async () => {
    setLoading(true);
    try {
      const userData = await loginWithGithub();
      setRecord(userData.record as unknown as UserRecord);
      return userData;
    } finally {
      setLoading(false);
    }
  };

  const googleLogin = async () => {
    setLoading(true);
    try {
      const userData = await loginWithGoogle();
      setRecord(userData.record as unknown as UserRecord);
      return userData;
    } finally {
      setLoading(false);
    }
  };

  const logout = () => {
    logoutUtil();
    setRecord(null);
  };

  const value: AuthContextType = {
    isAuthenticated: () => pb.authStore.isValid,
    login,
    logout,
    githubLogin,
    googleLogin,
    record: record(),
    user: record(), // Expose user alias
    isLoading: loading,
  };

  return (
    <AuthContext.Provider value={value}>{props.children}</AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};
