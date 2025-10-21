// src/routes/api/user-data.tsx - User data API endpoint
import { json } from "@solidjs/router";
import { getAdminPB } from "~/lib/pocketbase-admin-service";

export async function GET({ request }: { request: Request }) {
  try {
    // This would typically check authentication first
    // For demonstration, we're just showing how to access data server-side
    const adminService = getAdminPB();
    const url = new URL(request.url);
    const collection = url.searchParams.get("collection");
    const id = url.searchParams.get("id");

    if (!collection) {
      return json(
        { error: "Collection parameter is required" },
        { status: 400 },
      );
    }

    let result;
    if (id) {
      result = await adminService.fetchRecordById(collection, id);
    } else {
      result = await adminService.fetchAllRecords(collection);
    }

    return json({ success: true, data: result });
  } catch (error) {
    console.error("User data API error:", error);
    return json(
      { success: false, error: (error as Error).message },
      { status: 500 },
    );
  }
}

// Default export to satisfy SolidStart's file-based routing
export default function UserDataAPI() {
  return null; // This component won't be rendered since this is an API route
}
