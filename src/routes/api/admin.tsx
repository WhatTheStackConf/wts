// src/routes/api/admin.tsx - Admin API endpoint
import { json } from "@solidjs/router";
import { getAdminPB } from "~/lib/pocketbase-admin-service";

export async function POST({ request }: { request: Request }) {
  try {
    const adminService = getAdminPB();
    const body = await request.json();
    const { action, collection, data, id } = body;

    let result;
    switch (action) {
      case "create":
        result = await adminService.createRecord(collection, data);
        break;
      case "update":
        if (!id) {
          return json(
            { error: "ID is required for update operation" },
            { status: 400 },
          );
        }
        result = await adminService.updateRecord(collection, id, data);
        break;
      case "delete":
        if (!id) {
          return json(
            { error: "ID is required for delete operation" },
            { status: 400 },
          );
        }
        result = await adminService.deleteRecord(collection, id);
        break;
      case "fetchAll":
        result = await adminService.fetchAllRecords(collection);
        break;
      case "fetchById":
        if (!id) {
          return json(
            { error: "ID is required for fetch by ID operation" },
            { status: 400 },
          );
        }
        result = await adminService.fetchRecordById(collection, id);
        break;
      default:
        return json({ error: "Invalid action specified" }, { status: 400 });
    }

    return json({ success: true, data: result });
  } catch (error) {
    console.error("Admin API error:", error);
    return json(
      { success: false, error: (error as Error).message },
      { status: 500 },
    );
  }
}

// Default export to satisfy SolidStart's file-based routing
export default function AdminAPI() {
  return null; // This component won't be rendered since this is an API route
}
