// API endpoint for admin operations
import { getAdminPB } from '~/lib/pocketbase-admin-service';
import { serverfn } from 'vinxi/serverfn';

// Define a server function for admin operations
export const adminCreateEvent = serverfn(async (eventData: any) => {
  try {
    const adminService = getAdminPB();
    const result = await adminService.createRecord('events', eventData);
    return { success: true, data: result };
  } catch (error) {
    console.error('Admin create event error:', error);
    return { success: false, error: (error as Error).message };
  }
});

export const adminUpdateEvent = serverfn(async (id: string, eventData: any) => {
  try {
    const adminService = getAdminPB();
    const result = await adminService.updateRecord('events', id, eventData);
    return { success: true, data: result };
  } catch (error) {
    console.error('Admin update event error:', error);
    return { success: false, error: (error as Error).message };
  }
});

export const adminDeleteEvent = serverfn(async (id: string) => {
  try {
    const adminService = getAdminPB();
    const result = await adminService.deleteRecord('events', id);
    return { success: true, data: result };
  } catch (error) {
    console.error('Admin delete event error:', error);
    return { success: false, error: (error as Error).message };
  }
});

export const adminFetchAllEvents = serverfn(async () => {
  try {
    const adminService = getAdminPB();
    const result = await adminService.fetchAllRecords('events');
    return { success: true, data: result };
  } catch (error) {
    console.error('Admin fetch all events error:', error);
    return { success: false, error: (error as Error).message };
  }
});