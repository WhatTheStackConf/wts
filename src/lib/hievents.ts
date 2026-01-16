export interface HiEventsRelease {
  id: number;
  title: string;
  description: string | null;
  price: number | null; // null for free
  currency: string;
  is_available: boolean;
  sales_start_date: string | null;
  sales_end_date: string | null;
  quantity_sold: number;
  quantity_available: number | null; // null for unlimited
  purchase_link: string; // url to buy
}

export interface HiEventsEvent {
  id: number;
  title: string;
  tickets: HiEventsRelease[];
}

// Basic in-memory cache for the token
let cachedToken: string | null = null;
let tokenExpiry: number | null = null;

// Helper to ensure API URL ends with /api if not present
// This fixes the issue where requests hit the frontend (returning HTML) instead of the backend
function getApiBaseUrl(baseUrl: string): string {
  if (baseUrl.endsWith("/api") || baseUrl.endsWith("/api/")) {
    return baseUrl.replace(/\/$/, "");
  }
  return `${baseUrl.replace(/\/$/, "")}/api`;
}

async function getAuthToken(baseUrl: string): Promise<string | null> {
  // 1. Prefer API Key if available
  if (process.env.HIEVENTS_API_KEY) {
    return process.env.HIEVENTS_API_KEY;
  }

  // 2. Fallback to Email/Password login
  const email = process.env.HIEVENTS_EMAIL;
  const password = process.env.HIEVENTS_PASSWORD;
  const account_id = process.env.HIEVENTS_ACCOUNT_ID;

  if (!email || !password || !account_id) {
    console.warn(
      "HIEVENTS_API_KEY or (HIEVENTS_EMAIL + HIEVENTS_PASSWORD + HIEVENTS_ACCOUNT_ID) not set",
    );
    return null;
  }

  // 3. Check cache
  if (cachedToken && tokenExpiry && Date.now() < tokenExpiry) {
    return cachedToken;
  }

  const apiUrl = getApiBaseUrl(baseUrl);

  try {
    console.log(`Authenticating with hi.events at ${apiUrl}/auth/login...`);
    const response = await fetch(`${apiUrl}/auth/login`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      // Include account_id as required by the API
      body: JSON.stringify({ email, password, account_id }),
    });

    if (!response.ok) {
      console.error(
        `hi.events login failed: ${response.status} ${response.statusText}`,
      );
      // Try to read error body if json
      try {
        const errData = await response.text();
        console.error("Error response:", errData);
      } catch (e) { }
      return null;
    }

    const data = await response.json();
    cachedToken = data.token;

    // expires_in is usually in seconds. Default to 1 hour if missing.
    const expiresInSeconds = data.expires_in || 3600;
    // Set expiry to slightly before actual expiry (e.g., 5 mins buffer)
    tokenExpiry = Date.now() + expiresInSeconds * 1000 - 300000;

    return cachedToken;
  } catch (error) {
    console.error("Error during hi.events authentication:", error);
    return null;
  }
}

export async function fetchHiEventsReleases(): Promise<HiEventsRelease[]> {
  "use server";
  const rawApiUrl = process.env.HIEVENTS_API_URL; // e.g., https://hievents.foundry.mk
  const eventId = process.env.HIEVENTS_EVENT_ID; // e.g., 1 or 'whatthestack-2026'

  if (!rawApiUrl || !eventId) {
    console.warn("HIEVENTS_API_URL or HIEVENTS_EVENT_ID not set");
    return [];
  }

  const apiUrl = getApiBaseUrl(rawApiUrl);

  try {
    const token = await getAuthToken(rawApiUrl);

    const headers: HeadersInit = {
      Accept: "application/json",
      "Content-Type": "application/json",
    };

    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    // Attempt to fetch event products
    // Endpoint: GET /api/events/{event_id}/products
    const endpoint = `${apiUrl}/events/${eventId}/`;

    const response = await fetch(endpoint, { headers });

    if (!response.ok) {
      console.error(
        `Failed to fetch products from hi.events: ${response.status} ${response.statusText}`,
      );
      return [];
    }

    const json = await response.json();
    const products = json.data.product_categories[0].products || [];

    if (!Array.isArray(products)) {
      console.warn("No products found in hi.events response", json);
      return [];
    }

    // Base URL for checkout link (should NOT include /api)
    const storeBaseUrl = rawApiUrl.replace(/\/$/, "");

    // Extract slug from event data
    const eventSlug = json.data.slug || "";

    // Construct event link: https://hievents.foundry.mk/event/{id}/{slug}
    // If slug is missing, we try with just ID, though it might 404 depending on hi.events config
    const eventUrl = eventSlug
      ? `${storeBaseUrl}/event/${eventId}/${eventSlug}`
      : `${storeBaseUrl}/event/${eventId}`;

    return products.map((ticket: any) => ({
      id: ticket.id,
      title: ticket.title,
      description: ticket.description,
      price: ticket.price ? Number(ticket.price) : null,
      currency: ticket.currency || "EUR",
      is_available: true,
      sales_start_date: null,
      sales_end_date: null,
      quantity_sold: ticket.quantity_sold || 0,
      quantity_available: null,
      // usage of the checkout link is not possible directly as it requires a session
      // we'll link to the event page instead
      purchase_link: eventUrl,
    }));
  } catch (error) {
    console.error("Error fetching releases from hi.events:", error);
    return [];
  }
}
