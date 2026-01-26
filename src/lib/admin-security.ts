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

  if (!pb.authStore.isValid || pb.authStore.record?.role !== "admin") {
    console.error(
      "[Admin Security] Authorization failed. Token:",
      pb.authStore.token.substring(0, 10) + "...",
    );
    throw new Error("Unauthorized: Admin access required");
  }

  return pb.authStore.record;
};

/**
 * Validates that the current request is from an authenticated user.
 * Throws an error if not authenticated.
 *
 * @returns The authenticated user model
 */
export const requireAuth = async () => {
  const event = getRequestEvent();
  if (!event) {
    throw new Error("No request event available (server-side only)");
  }

  const cookie = event.request.headers.get("cookie") || "";
  const pocketBaseURL = process.env.POCKETBASE_URL || "http://localhost:8090";

  // Create a new lightweight instance to avoid shared state
  const pb = new PocketBase(pocketBaseURL);
  pb.authStore.loadFromCookie(cookie);

  if (!pb.authStore.isValid || !pb.authStore.record) {
    throw new Error("Unauthorized: Login required");
  }

  return pb.authStore.record;
};

/**
 * Validates that the current request is from an authenticated reviewer OR admin.
 * Throws an error if not authorized.
 *
 * @returns The authenticated user model
 */
export const requireReviewer = async () => {
  const user = await requireAuth();
  if (user.role !== "reviewer" && user.role !== "admin") {
    throw new Error("Unauthorized: Reviewer access required");
  }
  return user;
};
