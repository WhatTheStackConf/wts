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

export const requestEmailVerification = async (email: string): Promise<boolean> => {
  try {
    await pb.collection("users").requestVerification(email);
    return true;
  } catch (error) {
    console.error("Request verification error:", error);
    return false; // Don't throw to avoid breaking the registration flow if email fails
  }
};

export const confirmVerification = async (token: string): Promise<boolean> => {
  try {
    await pb.collection("users").confirmVerification(token);
    return true;
  } catch (error) {
    console.error("Confirm verification error:", error);
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
  } catch (error: any) {
    console.error("Registration error:", error);
    console.error("Error response:", JSON.stringify(error.response, null, 2));
    console.error("Error data:", JSON.stringify(error.response?.data, null, 2));
    throw error;
  }
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


export const requestPasswordReset = async (email: string): Promise<boolean> => {
  try {
    await pb.collection("users").requestPasswordReset(email);
    return true;
  } catch (error) {
    console.error("Request password reset error:", error);
    // throw error; // Optionally re-throw if you want to show specific errors
    return false;
  }
};

export const confirmPasswordReset = async (
  token: string,
  password: string,
  passwordConfirm: string
): Promise<boolean> => {
  try {
    await pb.collection("users").confirmPasswordReset(
      token,
      password,
      passwordConfirm
    );
    return true;
  } catch (error) {
    console.error("Confirm password reset error:", error);
    throw error;
  }
};
