// Define types for Tito API responses (for releases, not purchased tickets)
export interface TitoRelease {
  _type: string;
  id: number;
  event_id: number;
  created_at: string;
  updated_at: string;
  slug: string;
  title: string;
  description: string | null;
  archived: boolean;
  card_payments: boolean;
  default_quantity: number;
  donation: boolean;
  enable_super_combo_summary: boolean;
  end_at: string | null;
  has_success_message: boolean;
  has_fail_message: boolean;
  invoice: boolean;
  max_donation: number | null;
  max_tickets_per_person: number;
  metadata: any;
  min_tickets_per_person: number | null;
  min_donation: number | null;
  not_a_ticket: boolean;
  show_qr_code: boolean;
  only_issue_combos: boolean;
  pricing_type: string;
  payment_type: string;
  position: number;
  price: number | null;
  price_ex_tax: number;
  tax_exclusive: boolean;
  price_degressive: number | null;
  price_degressive_list: any[];
  quantity: number | null;
  request_company_name: boolean;
  request_job_title: boolean;
  request_vat_number: boolean;
  require_vat_number: boolean;
  require_billing_address: boolean | null;
  require_credit_card_for_sold_out_waiting_list: boolean;
  require_email: boolean;
  require_name: boolean;
  secret: boolean;
  show_price: boolean;
  suggested_donation: number | null;
  lock_changes: boolean | null;
  state_name: string; // 'on_sale', 'off_sale', etc.
  start_at: string | null;
  waiting_list_enabled_during_locked: boolean;
  waiting_list_enabled_during_sold_out: boolean;
  share_url: string;
  tickets_count: number;
  locked: boolean;
  waiting_list: boolean;
  sold_out: boolean;
  off_sale: boolean;
  expired: boolean;
  upcoming: boolean;
  allocatable: boolean;
}

export interface TitoReleasesResponse {
  releases: TitoRelease[];
}

export async function fetchTitoReleases(): Promise<TitoRelease[]> {
  "use server";
  const account = process.env.TITO_ACCOUNT;
  const event = process.env.TITO_EVENT;
  const apiKey = process.env.TITO_API_KEY;

  const apiUrl = `https://api.tito.io/v3/${account}/${event}/releases`;

  if (!apiKey) {
    throw new Error("TITO_API_KEY environment variable is not set");
  }

  if (!account || !event) {
    throw new Error(
      "Both TITO_ACCOUNT and TITO_EVENT environment variables are required",
    );
  }

  try {
    const response = await fetch(apiUrl, {
      headers: {
        Authorization: `Token token=${apiKey}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(
        `Failed to fetch releases: ${response.status} ${response.statusText}`,
      );
    }

    const data: TitoReleasesResponse = await response.json();

    // Filter to only include releases that are on sale and available
    return data.releases.filter(
      (release) =>
        release.state_name === "on_sale" &&
        !release.secret &&
        !release.sold_out &&
        !release.off_sale &&
        !release.expired &&
        !release.archived,
    );
  } catch (error) {
    console.error("Error fetching releases from Tito:", error);
    throw error;
  }
}
