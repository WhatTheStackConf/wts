import { getRequestEvent } from "solid-js/web";
import PocketBase from "pocketbase";

/**
 * Validates that the current request is from an authenticated admin user.
 * Throws an error if not authorized.
 * 
 * @returns The authenticated user model
 */
export const requireAdmin = async () => {
    const event = getRequestEvent();
    if (!event) {
        throw new Error("No request event available (server-side only)");
    }

    const cookie = event.request.headers.get("cookie") || "";
    const pocketBaseURL = process.env.POCKETBASE_URL || "http://localhost:8090";

    // Create a new lightweight instance to avoid shared state
    const pb = new PocketBase(pocketBaseURL);
    pb.authStore.loadFromCookie(cookie);

    if (!pb.authStore.isValid || pb.authStore.model?.role !== "admin") {
        throw new Error("Unauthorized: Admin access required");
    }

    return pb.authStore.model;
};
