import { requireReviewer } from "~/lib/admin-security";
import { getAdminPB } from "~/lib/pocketbase-admin-service";
import { CfpReviewRecord, CfpSubmissionRecord } from "~/lib/pocketbase-types";

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
        const adminService = getAdminPB();
        const isAdmin = user.role === "admin";

        // 1. Fetch Submission
        const submission = await adminService.fetchRecordById("cfp_submissions", id, {
            expand: isAdmin ? "applicant.user" : undefined
        });

        // 2. Fetch Reviews
        // Admin sees ALL reviews for this submission
        // Reviewer sees ONLY their own review
        let reviews = [];
        if (isAdmin) {
            reviews = await adminService.fetchAllRecords("cfp_reviews", {
                filter: `submission = "${id}"`,
                expand: "reviewer"
            });
        } else {
            reviews = await adminService.fetchAllRecords("cfp_reviews", {
                filter: `submission = "${id}" && reviewer = "${user.id}"`
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

// Create or Update a Review
export const submitReview = async (data: any) => {
    "use server";
    try {
        const user = await requireReviewer();
        const adminService = getAdminPB();

        // Force reviewer ID to be the authenticated user (prevent spoofing)
        // Unless admin... actually even admins should probably review as themselves?
        // Let's enforce the reviewer field matches the auth user.
        data.reviewer = user.id;

        if (data.id) {
            // Update existing
            // Verify ownership first if not admin
            if (user.role !== "admin") {
                const existing = await adminService.fetchRecordById("cfp_reviews", data.id);
                if (existing.reviewer !== user.id) {
                    throw new Error("Unauthorized: Cannot edit another user's review");
                }
            }
            const result = await adminService.updateRecord("cfp_reviews", data.id, data);
            return { success: true, data: result };
        } else {
            // Create new
            const result = await adminService.createRecord("cfp_reviews", data);
            return { success: true, data: result };
        }
    } catch (error) {
        console.error("Submit review error:", error);
        return { success: false, error: (error as Error).message };
    }
};
