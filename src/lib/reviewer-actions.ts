import { requireReviewer } from "~/lib/admin-security";
import { getAdminPB } from "~/lib/pocketbase-admin-service";
import { CfpReviewRecord, CfpSubmissionRecord } from "~/lib/pocketbase-types";

// PocketBase record IDs are 15-char alphanumeric strings
const VALID_ID = /^[a-zA-Z0-9]{15}$/;

function validateRecordId(id: string): string {
    if (!VALID_ID.test(id)) {
        throw new Error("Invalid record ID");
    }
    return id;
}

// Fetch all submissions for the reviewer queue
export const fetchReviewerSubmissions = async () => {
    "use server";
    try {
        const user = await requireReviewer();
        const adminService = getAdminPB();

        // Admin sees applicant info, reviewers do not (for anonymization)
        const isAdmin = user.role === "admin";

        const submissions = await adminService.fetchAllRecords("cfp_submissions", {
            sort: '-created',
            expand: isAdmin ? "applicant" : undefined,
        });

        return { success: true, data: submissions as CfpSubmissionRecord[] };
    } catch (error) {
        console.error("Fetch reviewer submissions error:", error);
        return { success: false, error: (error as Error).message };
    }
};

// Fetch a single submission and its reviews
export const fetchReviewerSubmissionDetail = async (id: string) => {
    "use server";
    try {
        const user = await requireReviewer();
        const safeId = validateRecordId(id);
        const adminService = getAdminPB();
        const isAdmin = user.role === "admin";

        // 1. Fetch Submission
        const submission = await adminService.fetchRecordById("cfp_submissions", safeId, {
            expand: isAdmin ? "applicant.user" : undefined
        });

        // 2. Fetch Reviews
        // Admin sees ALL reviews for this submission
        // Reviewer sees ONLY their own review
        let reviews = [];
        if (isAdmin) {
            reviews = await adminService.fetchAllRecords("cfp_reviews", {
                filter: `submission = "${safeId}"`,
                expand: "reviewer"
            });
        } else {
            reviews = await adminService.fetchAllRecords("cfp_reviews", {
                filter: `submission = "${safeId}" && reviewer = "${user.id}"`
            });
        }

        return {
            success: true,
            data: {
                submission: submission as CfpSubmissionRecord,
                reviews: reviews as CfpReviewRecord[],
                userRole: user.role,
                userId: user.id
            }
        };
    } catch (error) {
        console.error("Fetch reviewer submission detail error:", error);
        return { success: false, error: (error as Error).message };
    }
};

// Fetch weight votes and the current user's vote
export const fetchWeightVotes = async () => {
    "use server";
    try {
        const user = await requireReviewer();
        const adminService = getAdminPB();
        const records = await adminService.fetchAllRecords("cfp_weight_votes");
        return { success: true, data: records, userId: user.id, userRole: user.role };
    } catch (error) {
        console.error("Fetch weight votes error:", error);
        return { success: false, error: (error as Error).message };
    }
};

// Save or update a weight vote (reviewer only)
export const saveWeightVote = async (voteId: string | null, votes: Record<string, number>) => {
    "use server";
    try {
        const user = await requireReviewer();
        if (user.role !== "reviewer") {
            throw new Error("Only reviewers can submit weight votes");
        }
        const adminService = getAdminPB();
        const data = { user: user.id, ...votes };

        if (voteId) {
            validateRecordId(voteId);
            // Verify ownership
            const existing = await adminService.fetchRecordById("cfp_weight_votes", voteId);
            if (existing.user !== user.id) {
                throw new Error("Unauthorized: Cannot edit another user's vote");
            }
            const result = await adminService.updateRecord("cfp_weight_votes", voteId, data);
            return { success: true, data: result };
        } else {
            // Check for duplicate vote
            const existing = await adminService.fetchAllRecords("cfp_weight_votes", {
                filter: `user = "${user.id}"`
            });
            if (existing.length > 0) {
                throw new Error("You have already submitted weight votes");
            }
            const result = await adminService.createRecord("cfp_weight_votes", data);
            return { success: true, data: result };
        }
    } catch (error) {
        console.error("Save weight vote error:", error);
        return { success: false, error: (error as Error).message };
    }
};

// Create or Update a Review
export const submitReview = async (data: any) => {
    "use server";
    try {
        const user = await requireReviewer();
        if (user.role !== "reviewer") {
            throw new Error("Only reviewers can submit reviews");
        }
        const adminService = getAdminPB();

        // Force reviewer ID to be the authenticated user (prevent spoofing)
        data.reviewer = user.id;

        if (data.id) {
            // Update existing — verify ownership
            validateRecordId(data.id);
            const existing = await adminService.fetchRecordById("cfp_reviews", data.id);
            if (existing.reviewer !== user.id) {
                throw new Error("Unauthorized: Cannot edit another user's review");
            }
            const result = await adminService.updateRecord("cfp_reviews", data.id, data);
            return { success: true, data: result };
        } else {
            // Create new — check for duplicate review first
            validateRecordId(data.submission);
            const existing = await adminService.fetchAllRecords("cfp_reviews", {
                filter: `submission = "${data.submission}" && reviewer = "${user.id}"`
            });
            if (existing.length > 0) {
                throw new Error("You have already reviewed this submission");
            }
            const result = await adminService.createRecord("cfp_reviews", data);
            return { success: true, data: result };
        }
    } catch (error) {
        console.error("Submit review error:", error);
        return { success: false, error: (error as Error).message };
    }
};
