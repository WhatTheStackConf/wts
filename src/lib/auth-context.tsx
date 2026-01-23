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
    const currentRecord = pb.authStore.record as unknown as UserRecord | null;

    // Enforce verification
    if (currentRecord && !currentRecord.verified) {
      pb.authStore.clear();
      setRecord(null);
    } else {
      setRecord(currentRecord);
    }

    setLoading(false);
  });

  // Listen for auth changes
  const unlisten = pb.authStore.onChange(() => {
    const currentRecord = pb.authStore.record as unknown as UserRecord | null;

    // Enforce verification
    if (currentRecord && !currentRecord.verified) {
      // We don't call clear() here to avoid infinite loops if the change was triggered by clear()
      // But we set the local state to null effectively treating them as logged out
      setRecord(null);
    } else {
      setRecord(currentRecord);
    }
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
      const userRecord = userData.record as unknown as UserRecord;

      // Enforce verification
      if (!userRecord.verified) {
        logoutUtil();
        setRecord(null);
        throw new Error("Please verify your email address before logging in.");
      }

      setRecord(userRecord);
      return userData;
    } finally {
      setLoading(false);
    }
  };

  const githubLogin = async () => {
    setLoading(true);
    try {
      const userData = await loginWithGithub();
      const userRecord = userData.record as unknown as UserRecord;

      // Enforce verification for GitHub users too (though usually auto-verified)
      if (!userRecord.verified) {
        logoutUtil();
        setRecord(null);
        throw new Error("Please verify your email address before logging in.");
      }

      setRecord(userRecord);
      return userData;
    } finally {
      setLoading(false);
    }
  };

  const googleLogin = async () => {
    setLoading(true);
    try {
      const userData = await loginWithGoogle();
      const userRecord = userData.record as unknown as UserRecord;

      // Enforce verification for Google users
      if (!userRecord.verified) {
        logoutUtil();
        setRecord(null);
        throw new Error("Please verify your email address before logging in.");
      }

      setRecord(userRecord);
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
    // isAuthenticated checks validity AND verification status
    isAuthenticated: () => {
      const valid = pb.authStore.isValid;
      const r = record();
      return valid && !!r && !!r.verified;
    },
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
