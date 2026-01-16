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

interface AuthContextType {
  isAuthenticated: () => boolean;
  login: (email: string, password: string) => Promise<any>;
  logout: () => void;
  record: any;
  isLoading: () => boolean;
  githubLogin: () => Promise<any>;
  googleLogin: () => Promise<any>;
}

const AuthContext = createContext<AuthContextType>();

export const AuthProvider = (props: { children: any }) => {
  const [record, setRecord] = createSignal<any>(pb.authStore.record);
  const [loading, setLoading] = createSignal(true);

  // Check auth status on mount
  onMount(() => {
    setLoading(true);
    setRecord(pb.authStore.record);
    setLoading(false);
  });

  // Listen for auth changes
  const unlisten = pb.authStore.onChange(() => {
    setRecord(pb.authStore.record);
  });

  // Clean up listener
  onCleanup(() => {
    if (unlisten) unlisten();
  });

  const login = async (email: string, password: string) => {
    setLoading(true);
    try {
      const userData = await loginUtil(email, password);
      setRecord(userData.record);
      return userData;
    } finally {
      setLoading(false);
    }
  };

  const githubLogin = async () => {
    setLoading(true);
    try {
      const userData = await loginWithGithub();
      setRecord(userData.record);
      return userData;
    } finally {
      setLoading(false);
    }
  };

  const googleLogin = async () => {
    setLoading(true);
    try {
      const userData = await loginWithGoogle();
      setRecord(userData.record);
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
