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

export interface HiEventsAttendee {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  locale: string;
  checked_in_at: string | null;
  ticket: {
    id: number;
    title: string;
    price: number;
    currency: string;
  };
  public_url: string; // e.g. https://.../locale/check-in/ticket/{uuid}
  admin_url: string;
}

export async function fetchHiEventsAttendees(filterEmail?: string): Promise<HiEventsAttendee[]> {
  "use server";
  const rawApiUrl = process.env.HIEVENTS_API_URL;
  const eventId = process.env.HIEVENTS_EVENT_ID;

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

    // 1. Fetch products (releases) to get ticket details (title, price)
    // We reuse the existing logic or function if possible, but for safety in this scope we'll fetch them here or call the exported function.
    // To avoid circular refs or server-only issues, let's just call fetchHiEventsReleases if it's safe, or re-fetch.
    // Since fetchHiEventsReleases is exported and "use server", we can call it.
    const releases = await fetchHiEventsReleases();
    const productsMap = new Map<number, HiEventsRelease>();
    releases.forEach(r => productsMap.set(r.id, r));

    // 2. Fetch Attendees
    const endpoint = `${apiUrl}/events/${eventId}/attendees`;

    // Attempt to filter by email via API to reduce load if supported (hi.events might support ?query= or ?email=)
    // The user snippet used ?sort_by=email. We will fetch all (default page size might be 25, need to handle pagination if list grows, 
    // but for now let's assume one page or we just fetch the default).
    // NOTE: In production with many attendees, we should paginate. 
    // For this implementation, we will fetch the first page.

    const response = await fetch(endpoint, { headers });

    if (!response.ok) {
      console.error(
        `Failed to fetch attendees from hi.events: ${response.status} ${response.statusText}`,
      );
      return [];
    }

    const json = await response.json();
    const data = json.data || [];

    let attendees: HiEventsAttendee[] = [];

    if (Array.isArray(data)) {
      attendees = data.map((item: any) => {
        const product = productsMap.get(item.product_id);
        // Use public_id or short_id if available for display, otherwise cast id to string
        const displayId = item.public_id || item.short_id || String(item.id);

        return {
          id: displayId,
          first_name: item.first_name,
          last_name: item.last_name,
          email: item.email,
          locale: item.locale,
          checked_in_at: (item.check_ins && item.check_ins.length > 0) ? item.check_ins[0].created_at : null,
          ticket: {
            id: item.product_id,
            title: product ? product.title : "Unknown Ticket",
            price: product ? (product.price || 0) : 0,
            currency: product ? product.currency : "EUR"
          },
          public_url: item.public_id ? `${rawApiUrl}/check-in/ticket/${item.public_id}` : "",
          admin_url: ""
        };
      });
    }

    if (filterEmail) {
      return attendees.filter(a => a.email.toLowerCase() === filterEmail.toLowerCase());
    }

    return attendees;

  } catch (error) {
    console.error("Error fetching attendees from hi.events:", error);
    return [];
  }
}
