// API endpoint for admin operations
import { getAdminPB } from "~/lib/pocketbase-admin-service";
import { requireAdmin } from "~/lib/admin-security";

// Define a server function for admin operations
export const adminCreateEvent = async (eventData: any) => {
  "use server";

  try {
    await requireAdmin();
    const adminService = getAdminPB();
    const result = await adminService.createRecord("events", eventData);
    return { success: true, data: result };
  } catch (error) {
    console.error("Admin create event error:", error);
    return { success: false, error: (error as Error).message };
  }
};

export const adminUpdateEvent = async (id: string, eventData: any) => {
  "use server";

  try {
    await requireAdmin();
    const adminService = getAdminPB();
    const result = await adminService.updateRecord("events", id, eventData);
    return { success: true, data: result };
  } catch (error) {
    console.error("Admin update event error:", error);
    return { success: false, error: (error as Error).message };
  }
};

export const adminDeleteEvent = async (id: string) => {
  "use server";

  try {
    await requireAdmin();
    const adminService = getAdminPB();
    const result = await adminService.deleteRecord("events", id);
    return { success: true, data: result };
  } catch (error) {
    console.error("Admin delete event error:", error);
    return { success: false, error: (error as Error).message };
  }
};

export const adminFetchAllEvents = async () => {
  "use server";

  try {
    await requireAdmin();
    const adminService = getAdminPB();
    const result = await adminService.fetchAllRecords("events");
    return { success: true, data: result };
  } catch (error) {
    console.error("Admin fetch all events error:", error);
    return { success: false, error: (error as Error).message };
  }
};

// User Management Actions
export const adminFetchAllUsers = async () => {
  "use server";

  try {
    await requireAdmin();
    const adminService = getAdminPB();
    const result = await adminService.fetchAllRecords("users", { sort: "-created" });
    return { success: true, data: result };
  } catch (error) {
    console.error("Admin fetch all users error:", error);
    return { success: false, error: (error as Error).message };
  }
};

export const adminUpdateUser = async (id: string, userData: any) => {
  "use server";

  try {
    await requireAdmin();
    const adminService = getAdminPB();
    const result = await adminService.updateRecord("users", id, userData);
    return { success: true, data: result };
  } catch (error) {
    console.error("Admin update user error:", error);
    return { success: false, error: (error as Error).message };
  }
};

export const adminDeleteUser = async (id: string) => {
  "use server";

  try {
    await requireAdmin();
    const adminService = getAdminPB();
    const result = await adminService.deleteRecord("users", id);
    return { success: true, data: result };
  } catch (error) {
    console.error("Admin delete user error:", error);
    return { success: false, error: (error as Error).message };
  }
};

// Leaderboard Action
export const adminFetchLeaderboardData = async () => {
  "use server";

  try {
    await requireAdmin();
    const adminService = getAdminPB();

    // 1. Fetch EVERYTHING (using admin service)
    const [subs, reviews, votes] = await Promise.all([
      adminService.fetchAllRecords("cfp_submissions", { expand: "applicant.user", sort: "-created" }),
      adminService.fetchAllRecords("cfp_reviews"),
      adminService.fetchAllRecords("cfp_weight_votes")
    ]);

    // 2. Calculate Global Weights
    const CRITERIA = [
      { id: "relevance", label: "Relevance" },
      { id: "originality", label: "Originality" },
      { id: "depth", label: "Depth" },
      { id: "clarity", label: "Clarity" },
      { id: "takeaways", label: "Takeaways" },
      { id: "engagement", label: "Engagement" },
    ];

    const weights: Record<string, number> = {};
    if (votes.length > 0) {
      CRITERIA.forEach(c => {
        const sum = votes.reduce((acc, v) => acc + (v[c.id] || 0), 0);
        weights[c.id] = sum / votes.length;
      });
    } else {
      // Default weights if no votes yet (all 1)
      CRITERIA.forEach(c => weights[c.id] = 1);
    }

    // 3. Process Submissions
    const scoredSubmissions = subs.map(sub => {
      const subReviews = reviews.filter((r: any) => r.submission === sub.id);

      if (subReviews.length === 0) {
        return { ...sub, totalScore: 0, reviewCount: 0 };
      }

      // Calculate score for each review based on weights
      const reviewScores = subReviews.map((r: any) => {
        let rScore = 0;
        CRITERIA.forEach(c => {
          const criteriaScore = r[`score_${c.id}`] || 0;
          rScore += criteriaScore * (weights[c.id] || 1);
        });
        return rScore;
      });

      // Average of all reviews
      const totalScore = reviewScores.reduce((a, b) => a + b, 0) / subReviews.length;

      return {
        ...sub,
        totalScore: totalScore,
        reviewCount: subReviews.length
      };
    });

    // 4. Sort by Score Descending
    scoredSubmissions.sort((a, b) => b.totalScore - a.totalScore);

    return { success: true, data: scoredSubmissions };

  } catch (error) {
    console.error("Admin fetch leaderboard error:", error);
    return { success: false, error: (error as Error).message };
  }
};

export const deleteSubmission = async (id: string) => {
  "use server";
  try {
    await requireAdmin();
    const adminPB = getAdminPB();
    await adminPB.deleteRecord("cfp_submissions", id);
    return { success: true };
  } catch (error: any) {
    console.error("Delete submission error:", error);
    return { success: false, error: error.message };
  }
};
