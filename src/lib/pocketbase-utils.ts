import {
  AuthData,
  UserRecord,
  CfpApplicantRecord,
  CfpSubmissionRecord,
  CollectionRecord,
} from "./pocketbase-types";
import pb from "./pocketbase";

// Initialize PocketBase client instance

// Create a function to initialize PocketBase with the correct URL
// This is kept for backward compatibility but now uses the client service
export function initPocketBase(url?: string) {
  return pb;
}

// Export initialized PocketBase instance
export { pb };

// Authentication functions
export const login = async (
  email: string,
  password: string,
): Promise<AuthData> => {
  try {
    const authData: AuthData = await pb
      .collection("users")
      .authWithPassword(email, password);
    return authData;
  } catch (error) {
    console.error("Login error:", error);
    throw error;
  }
};

export const loginWithGithub = async (): Promise<AuthData> => {
  try {
    const authData: AuthData = await pb.collection("users").authWithOAuth2({
      provider: "github",
    });
    return authData;
  } catch (error) {
    console.error("Login with GitHub error:", error);
    throw error;
  }
};

export const loginWithGoogle = async (): Promise<AuthData> => {
  try {
    const authData: AuthData = await pb.collection("users").authWithOAuth2({
      provider: "google",
    });
    return authData;
  } catch (error) {
    console.error("Login with Google error:", error);
    throw error;
  }
};

export const register = async (
  email: string,
  password: string,
  passwordConfirm: string,
  name: string,
): Promise<UserRecord> => {
  try {
    const userData: UserRecord = await pb.collection("users").create({
      email,
      password,
      passwordConfirm,
      name,
    });
    return userData;
  } catch (error) {
    console.error("Registration error:", error);
    throw error;
  }
};

export const logout = () => {
  pb.authStore.clear();
  // Optionally navigate to home or login page
};

// Check if user is authenticated
export const isAuthenticated = (): boolean => {
  return pb.authStore.isValid;
};

// Get current user
export const getCurrentUser = (): UserRecord | null => {
  return pb.authStore.record as UserRecord | null;
};

// CFP Applicant functions
export const createCfpApplicant = async (
  affiliation: string,
  bio: string,
  userId: string,
  socialHandles?: any,
): Promise<CfpApplicantRecord> => {
  try {
    const applicantData: CfpApplicantRecord = await pb
      .collection("cfp_applicants")
      .create({
        affiliation,
        bio,
        social_handles: socialHandles,
        user: userId,
      });
    return applicantData;
  } catch (error) {
    console.error("CFP Applicant creation error:", error);
    throw error;
  }
};

export const updateCfpApplicant = async (
  id: string,
  data: Partial<CfpApplicantRecord>,
): Promise<CfpApplicantRecord> => {
  try {
    const updatedApplicant: CfpApplicantRecord = await pb
      .collection("cfp_applicants")
      .update(id, data);
    return updatedApplicant;
  } catch (error) {
    console.error("CFP Applicant update error:", error);
    throw error;
  }
};

export const getCfpApplicant = async (
  id: string,
): Promise<CfpApplicantRecord> => {
  try {
    const applicant: CfpApplicantRecord = await pb
      .collection("cfp_applicants")
      .getOne(id);
    return applicant;
  } catch (error) {
    console.error("CFP Applicant retrieval error:", error);
    throw error;
  }
};

export const getCfpApplicantByUser = async (
  userId: string,
): Promise<CfpApplicantRecord> => {
  try {
    const applicants: CfpApplicantRecord[] = await pb
      .collection("cfp_applicants")
      .getFullList({
        filter: `user = "${userId}"`,
      });
    if (applicants.length === 0) {
      throw new Error("No CFP applicant found for this user");
    }
    return applicants[0];
  } catch (error) {
    console.error("CFP Applicant retrieval by user error:", error);
    throw error;
  }
};

// CFP Submission functions
export const createCfpSubmission = async (
  sessionTitle: string,
  abstract: string,
  keyTakeaways: string,
  applicantId: string,
  technicalRequirements?: string,
  notes?: string,
): Promise<CfpSubmissionRecord> => {
  try {
    const submissionData: CfpSubmissionRecord = await pb
      .collection("cfp_submissions")
      .create({
        session_title: sessionTitle,
        abstract,
        key_takeaways: keyTakeaways,
        applicant: applicantId,
        technical_requirements: technicalRequirements,
        notes,
      });
    return submissionData;
  } catch (error) {
    console.error("CFP Submission creation error:", error);
    throw error;
  }
};

export const updateCfpSubmission = async (
  id: string,
  data: Partial<CfpSubmissionRecord>,
): Promise<CfpSubmissionRecord> => {
  try {
    const updatedSubmission: CfpSubmissionRecord = await pb
      .collection("cfp_submissions")
      .update(id, data);
    return updatedSubmission;
  } catch (error) {
    console.error("CFP Submission update error:", error);
    throw error;
  }
};

export const getCfpSubmission = async (
  id: string,
): Promise<CfpSubmissionRecord> => {
  try {
    const submission: CfpSubmissionRecord = await pb
      .collection("cfp_submissions")
      .getOne(id);
    return submission;
  } catch (error) {
    console.error("CFP Submission retrieval error:", error);
    throw error;
  }
};

export const getAllCfpSubmissions = async (): Promise<
  CfpSubmissionRecord[]
> => {
  try {
    const submissions: CfpSubmissionRecord[] = await pb
      .collection("cfp_submissions")
      .getFullList();
    return submissions;
  } catch (error) {
    console.error("CFP Submissions retrieval error:", error);
    throw error;
  }
};

export const getCfpSubmissionsByApplicant = async (
  applicantId: string,
): Promise<CfpSubmissionRecord[]> => {
  try {
    const submissions: CfpSubmissionRecord[] = await pb
      .collection("cfp_submissions")
      .getFullList({
        filter: `applicant = "${applicantId}"`,
      });
    return submissions;
  } catch (error) {
    console.error("CFP Submissions retrieval by applicant error:", error);
    throw error;
  }
};
