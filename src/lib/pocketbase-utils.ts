import { initPocketBaseClient, getClientPB } from './pocketbase-client-service';

// Initialize PocketBase client instance
let pb = getClientPB();

// Create a function to initialize PocketBase with the correct URL
// This is kept for backward compatibility but now uses the client service
export function initPocketBase(url?: string) {
  const clientService = initPocketBaseClient(url);
  pb = clientService.getInstance();
  return pb;
}

// Export initialized PocketBase instance
export { pb };

// Authentication functions
export const login = async (email: string, password: string) => {
  try {
    const authData = await pb.collection('users').authWithPassword(email, password);
    // Save auth data to cookie
    pb.authStore.saveToCookie();
    return authData;
  } catch (error) {
    console.error('Login error:', error);
    throw error;
  }
};

export const register = async (email: string, password: string, passwordConfirm: string, name: string) => {
  try {
    const userData = await pb.collection('users').create({
      email,
      password,
      passwordConfirm,
      name,
    });
    return userData;
  } catch (error) {
    console.error('Registration error:', error);
    throw error;
  }
};

export const logout = () => {
  pb.authStore.clear();
  // Optionally navigate to home or login page
};

// Check if user is authenticated
export const isAuthenticated = () => {
  return pb.authStore.isValid;
};

// Get current user
export const getCurrentUser = () => {
  return pb.authStore.model;
};