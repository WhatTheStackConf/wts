// API endpoint for admin operations
import { getAdminPB } from "~/lib/pocketbase-admin-service";

// Define a server function for admin operations
export const adminCreateEvent = async (eventData: any) => {
  "use server";

  try {
    const adminService = getAdminPB();
    const result = await adminService.createRecord("events", eventData);
    return { success: true, data: result };
  } catch (error) {
    console.error("Admin create event error:", error);
    return { success: false, error: (error as Error).message };
  }
};

export const adminUpdateEvent = async (id: string, eventData: any) => {
  "use server";

  try {
    const adminService = getAdminPB();
    const result = await adminService.updateRecord("events", id, eventData);
    return { success: true, data: result };
  } catch (error) {
    console.error("Admin update event error:", error);
    return { success: false, error: (error as Error).message };
  }
};

export const adminDeleteEvent = async (id: string) => {
  "use server";

  try {
    const adminService = getAdminPB();
    const result = await adminService.deleteRecord("events", id);
    return { success: true, data: result };
  } catch (error) {
    console.error("Admin delete event error:", error);
    return { success: false, error: (error as Error).message };
  }
};

export const adminFetchAllEvents = async () => {
  "use server";

  try {
    const adminService = getAdminPB();
    const result = await adminService.fetchAllRecords("events");
    return { success: true, data: result };
  } catch (error) {
    console.error("Admin fetch all events error:", error);
    return { success: false, error: (error as Error).message };
  }
};

// User Management Actions
export const adminFetchAllUsers = async () => {
  "use server";

  try {
    const adminService = getAdminPB();
    const result = await adminService.fetchAllRecords("users", { sort: "-created" });
    return { success: true, data: result };
  } catch (error) {
    console.error("Admin fetch all users error:", error);
    return { success: false, error: (error as Error).message };
  }
};

export const adminUpdateUser = async (id: string, userData: any) => {
  "use server";

  try {
    const adminService = getAdminPB();
    const result = await adminService.updateRecord("users", id, userData);
    return { success: true, data: result };
  } catch (error) {
    console.error("Admin update user error:", error);
    return { success: false, error: (error as Error).message };
  }
};

export const adminDeleteUser = async (id: string) => {
  "use server";

  try {
    const adminService = getAdminPB();
    const result = await adminService.deleteRecord("users", id);
    return { success: true, data: result };
  } catch (error) {
    console.error("Admin delete user error:", error);
    return { success: false, error: (error as Error).message };
  }
};
