import { createSignal, createEffect, onCleanup } from "solid-js";
import pb from "./pocketbase";

// Define types for user authentication
interface User {
  id: string;
  email: string;
  name: string;
  [key: string]: any; // Allow additional fields
}

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
}

// Initialize PocketBase client

// Create authentication store
const [authState, setAuthState] = createSignal<AuthState>({
  user: null,
  isAuthenticated: pb.authStore.isValid,
  isLoading: true,
});

// Sync auth state with PocketBase auth store
const unsubscribe = pb.authStore.onChange(() => {
  setAuthState({
    user: pb.authStore.record as User | null,
    isAuthenticated: pb.authStore.isValid,
    isLoading: false,
  });
}, true);

// Cleanup subscription on module unload
onCleanup(() => {
  if (typeof unsubscribe === "function") {
    unsubscribe();
  }
});

// Authentication functions
const login = async (email: string, password: string) => {
  setAuthState((prev) => ({ ...prev, isLoading: true }));
  try {
    const authData = await pb
      .collection("userrs")
      .authWithPassword(email, password);
    setAuthState({
      user: authData.record as unknown as User,
      isAuthenticated: authData.record !== null,
      isLoading: false,
    });
    return authData;
  } catch (error) {
    setAuthState((prev) => ({ ...prev, isLoading: false }));
    console.error("Login error:", error);
    throw error;
  }
};

const register = async (
  email: string,
  password: string,
  passwordConfirm: string,
  name: string,
) => {
  setAuthState((prev) => ({ ...prev, isLoading: true }));
  try {
    const userData = await pb.collection("userrs").create({
      email,
      password,
      passwordConfirm,
      name,
    });
    setAuthState((prev) => ({ ...prev, isLoading: false }));
    return userData;
  } catch (error) {
    setAuthState((prev) => ({ ...prev, isLoading: false }));
    console.error("Registration error:", error);
    throw error;
  }
};

const logout = () => {
  pb.authStore.clear();
  setAuthState({
    user: null,
    isAuthenticated: false,
    isLoading: false,
  });
};

// Check if user is authenticated
const isAuthenticated = () => authState().isAuthenticated;

// Get current user
const getCurrentUser = () => authState().user;

// Loading state
const isLoading = () => authState().isLoading;

// Refresh user data
const refreshUser = async () => {
  if (!isAuthenticated()) return null;

  try {
    const currentUser = getCurrentUser();
    if (!currentUser) return null;

    const updatedUser = await pb.collection("users").getOne(currentUser.id);
    setAuthState((prev) => ({
      ...prev,
      user: updatedUser as unknown as User,
    }));
    return updatedUser;
  } catch (error) {
    console.error("Error refreshing user:", error);
    logout(); // If we can't refresh the user, log them out
    throw error;
  }
};

// Export the authentication service
export const useAuth = () => ({
  user: authState().user,
  isAuthenticated: authState().isAuthenticated,
  isLoading: authState().isLoading,
  login,
  register,
  logout,
  getCurrentUser,
  refreshUser,
});
