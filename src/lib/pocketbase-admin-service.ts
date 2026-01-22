import PocketBase from "pocketbase";

/**
 * Server-side PocketBase service for superuser/admin operations
 *
 * This service is designed to run only on the server-side and handles
 * operations that require superuser privileges. It should never be used
 * in client-side code.
 */
class PocketBaseAdminService {
  private pb: PocketBase;
  private initialized = false;

  constructor() {
    // Ensure this service is only initialized on the server
    if (typeof window !== "undefined") {
      throw new Error(
        "PocketBaseAdminService should only be used on the server-side",
      );
    }

    const pocketBaseURL = process.env.POCKETBASE_URL || "http://localhost:8090";
    this.pb = new PocketBase(pocketBaseURL);
  }

  /**
   * Initialize admin service with superuser credentials
   * This should be called before any admin operations
   */
  async initializeAdmin() {
    if (this.initialized) return;

    try {
      const email = process.env.POCKETBASE_SUPERUSER_EMAIL || "admin@wts.rs";
      const password =
        process.env.POCKETBASE_SUPERUSER_PASSWORD || "supersecret";

      // Authenticate as superuser
      await this.pb.admins.authWithPassword(email, password);
      this.initialized = true;
    } catch (error) {
      console.error("Failed to initialize PocketBase admin service:", error);
      throw error;
    }
  }

  /**
   * Get the PocketBase instance
   * @throws Error if admin service is not initialized
   */
  getInstance(): PocketBase {
    if (!this.initialized) {
      throw new Error(
        "Admin service not initialized. Call initializeAdmin() first.",
      );
    }
    return this.pb;
  }

  /**
   * Create a new record in the specified collection
   * This operation bypasses any client-side rules and uses superuser privileges
   */
  async createRecord(collectionName: string, data: any) {
    if (!this.initialized) await this.initializeAdmin();
    try {
      const record = await this.pb.collection(collectionName).create(data);
      return record;
    } catch (error) {
      console.error(`Error creating record in ${collectionName}:`, error);
      throw error;
    }
  }

  /**
   * Update an existing record in the specified collection
   * This operation bypasses any client-side rules and uses superuser privileges
   */
  async updateRecord(collectionName: string, id: string, data: any) {
    if (!this.initialized) await this.initializeAdmin();
    try {
      const record = await this.pb.collection(collectionName).update(id, data);
      return record;
    } catch (error) {
      console.error(`Error updating record in ${collectionName}:`, error);
      throw error;
    }
  }

  /**
   * Delete a record from the specified collection
   * This operation bypasses any client-side rules and uses superuser privileges
   */
  async deleteRecord(collectionName: string, id: string) {
    if (!this.initialized) await this.initializeAdmin();
    try {
      const result = await this.pb.collection(collectionName).delete(id);
      return result;
    } catch (error) {
      console.error(`Error deleting record in ${collectionName}:`, error);
      throw error;
    }
  }

  /**
   * Fetch all records from a collection with full access (bypassing collection rules)
   * This operation uses superuser privileges to access all records regardless of client-side rules
   */
  async fetchAllRecords(collectionName: string, options?: any) {
    if (!this.initialized) await this.initializeAdmin();
    try {
      const records = await this.pb
        .collection(collectionName)
        .getFullList(options);
      return records;
    } catch (error) {
      console.error(
        `Error fetching all records from ${collectionName}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Fetch a single record by ID with full access (bypassing collection rules)
   * This operation uses superuser privileges to access the record regardless of client-side rules
   */
  async fetchRecordById(collectionName: string, id: string, options?: any) {
    if (!this.initialized) await this.initializeAdmin();
    try {
      const record = await this.pb
        .collection(collectionName)
        .getOne(id, options);
      return record;
    } catch (error) {
      console.error(`Error fetching record from ${collectionName}:`, error);
      throw error;
    }
  }

  /**
   * Perform raw database queries using superuser privileges
   * This method allows for complex operations that may not be possible through the standard API
   */
  async rawDatabaseOperation<T>(
    operation: (db: any) => Promise<T>,
  ): Promise<T> {
    if (!this.initialized) await this.initializeAdmin();
    try {
      // Access the internal db instance (this may be implementation-specific to PocketBase)
      // For custom operations that bypass standard collection methods
      return await operation(this.pb);
    } catch (error) {
      console.error("Error executing raw database operation:", error);
      throw error;
    }
  }

  /**
   * Batch operations using superuser privileges
   */
  async batchCreate(collectionName: string, records: any[]) {
    if (!this.initialized) await this.initializeAdmin();
    try {
      // Process as individual operations since PocketBase doesn't have a built-in batch create
      const results = [];
      for (const record of records) {
        const createdRecord = await this.pb
          .collection(collectionName)
          .create(record);
        results.push(createdRecord);
      }
      return results;
    } catch (error) {
      console.error(
        `Error batch creating records in ${collectionName}:`,
        error,
      );
      throw error;
    }
  }
}

// Create a singleton instance for admin usage
let adminService: PocketBaseAdminService;

/**
 * Initialize the PocketBase admin service
 * This should be called on the server-side only
 */
export const initPocketBaseAdmin = (): PocketBaseAdminService => {
  if (!adminService) {
    adminService = new PocketBaseAdminService();
  }
  return adminService;
};

/**
 * Get the admin PocketBase instance
 * This should be called on the server-side only
 */
export const getAdminPB = () => {
  if (!adminService) {
    adminService = new PocketBaseAdminService();
  }
  return adminService;
};
