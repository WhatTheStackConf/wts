import PocketBase from 'pocketbase';

// Client-side PocketBase service for regular users
class PocketBaseClientService {
  private pb: PocketBase;
  private baseURL: string;

  constructor(url?: string) {
    this.baseURL = url || 
      (typeof process !== 'undefined' && process.env?.POCKETBASE_URL)
        ? (process.env?.POCKETBASE_URL as string)
        : typeof window !== 'undefined' && window.location
          ? `${window.location.protocol}//${window.location.hostname}:8090`
          : 'http://localhost:8090';

    this.pb = new PocketBase(this.baseURL);
    
    // Load the auth store data from the local storage on the client
    this.pb.authStore.loadFromCookie();
    
    // Handle auth state changes
    this.pb.authStore.onChange(() => {
      // Update auth state in your app context if needed
    }, true);
  }

  // Get the PocketBase instance
  getInstance(): PocketBase {
    return this.pb;
  }

  // Authentication functions for regular users
  async login(email: string, password: string) {
    try {
      const authData = await this.pb.collection('users').authWithPassword(email, password);
      // Save auth data to cookie
      this.pb.authStore.saveToCookie();
      return authData;
    } catch (error) {
      console.error('Login error:', error);
      throw error;
    }
  }

  async register(email: string, password: string, passwordConfirm: string, name: string) {
    try {
      const userData = await this.pb.collection('users').create({
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
  }

  logout() {
    this.pb.authStore.clear();
    // Optionally navigate to home or login page
  }

  // Check if user is authenticated
  isAuthenticated() {
    return this.pb.authStore.isValid;
  }

  // Get current user
  getCurrentUser() {
    return this.pb.authStore.model;
  }

  // Fetch data that respects collection rules and authentication
  async fetchCollection(collectionName: string, options?: any) {
    try {
      const records = await this.pb.collection(collectionName).getFullList(options);
      return records;
    } catch (error) {
      console.error(`Error fetching ${collectionName}:`, error);
      throw error;
    }
  }
}

// Create a singleton instance for client-side usage
let clientService: PocketBaseClientService;

export const initPocketBaseClient = (url?: string): PocketBaseClientService => {
  if (!clientService) {
    clientService = new PocketBaseClientService(url);
  }
  return clientService;
};

// Export the client instance
export const getClientPB = () => {
  if (!clientService) {
    clientService = new PocketBaseClientService();
  }
  return clientService.getInstance();
};