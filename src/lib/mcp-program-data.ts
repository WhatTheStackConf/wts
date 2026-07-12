import { getAdminPB } from "~/lib/pocketbase-admin-service";
import type {
  AgendaSlotRecord,
  AgendaTrackRecord,
  CfpApplicantRecord,
  ConferenceDayRecord,
  CfpReviewRecord,
  CfpSubmissionRecord,
  SessionRecord,
  SpeakerRecord,
} from "~/lib/pocketbase-types";

const REVIEW_CRITERIA = [
  "relevance",
  "originality",
  "depth",
  "clarity",
  "takeaways",
  "engagement",
] as const;

type ExpandedUser = {
  id?: string;
  name?: string;
  email?: string;
};

type ExpandedApplicant = CfpApplicantRecord & {
  expand?: { user?: ExpandedUser };
};

type ExpandedSubmission = CfpSubmissionRecord & {
  expand?: { applicant?: ExpandedApplicant };
};

type ExpandedSpeaker = SpeakerRecord;

type ExpandedSession = SessionRecord & {
  expand?: { speakers?: ExpandedSpeaker[] };
};

type McpSessionSchedule = {
  start_at: string;
  end_at: string;
  kind: AgendaSlotRecord["kind"];
  published: boolean;
  location_label: string | null;
  day: { key: string; local_date: string; title: string } | null;
  track: { key: string; name: string; location_label: string | null } | null;
};

export type ProposalReviewSummary = {
  review_count: number;
  average_scores: Record<string, number | null>;
  llm_suspected_count: number;
};

export type ProposalStatus = NonNullable<CfpSubmissionRecord["status"]>;

function textOrNull(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function speakerName(speaker: ExpandedSpeaker): string | null {
  return textOrNull(speaker.display_name) || textOrNull(speaker.slug);
}

function speakerDto(speaker: ExpandedSpeaker) {
  return {
    id: speaker.id,
    slug: speaker.slug,
    published: speaker.published,
    origin: speaker.origin,
    display_name: speakerName(speaker),
    affiliation: textOrNull(speaker.affiliation),
    bio: textOrNull(speaker.bio),
    social_handles: speaker.social_handles ?? null,
    created: speaker.created,
    updated: speaker.updated,
  };
}

function sessionSchedule(
  sessionId: string,
  slots: AgendaSlotRecord[],
  daysById: Map<string, ConferenceDayRecord>,
  tracksById: Map<string, AgendaTrackRecord>,
): McpSessionSchedule | null {
  const slot = slots.find((item) => item.session === sessionId);
  if (!slot) return null;
  const day = daysById.get(slot.day);
  const track = slot.track ? tracksById.get(slot.track) : undefined;
  return {
    start_at: slot.start_at,
    end_at: slot.end_at,
    kind: slot.kind,
    published: Boolean(slot.published),
    location_label: slot.location_label || track?.location_label || null,
    day: day ? { key: day.key, local_date: day.local_date, title: day.title } : null,
    track: track
      ? { key: track.key, name: track.name, location_label: track.location_label || null }
      : null,
  };
}

function sessionDto(session: ExpandedSession, schedule: McpSessionSchedule | null) {
  return {
    id: session.id,
    slug: session.slug,
    published: session.published,
    title: session.title,
    abstract: session.abstract,
    cfp_submission_id: session.cfp_submission || null,
    format: session.format || null,
    schedule,
    speaker_ids: session.speakers || [],
    speakers: (session.expand?.speakers || []).map(speakerDto),
    created: session.created,
    updated: session.updated,
  };
}

function reviewSummary(reviews: CfpReviewRecord[]): ProposalReviewSummary {
  const averageScores: Record<string, number | null> = {};

  for (const criterion of REVIEW_CRITERIA) {
    const field = `score_${criterion}` as keyof CfpReviewRecord;
    const values = reviews
      .map((review) => Number(review[field]))
      .filter((value) => Number.isFinite(value));
    averageScores[criterion] = values.length
      ? Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100
      : null;
  }

  const summary: ProposalReviewSummary = {
    review_count: reviews.length,
    average_scores: averageScores,
    llm_suspected_count: reviews.filter((review) => review.is_llm_suspected).length,
  };

  return summary;
}

function proposalDto(
  submission: ExpandedSubmission,
  reviews: CfpReviewRecord[],
) {
  const applicant = submission.expand?.applicant;
  const user = applicant?.expand?.user;

  return {
    id: submission.id,
    status: submission.status || "pending",
    session_title: submission.session_title,
    abstract: submission.abstract,
    key_takeaways: submission.key_takeaways,
    technical_requirements: submission.technical_requirements || null,
    notes: submission.notes || null,
    applicant: applicant
      ? {
          id: applicant.id,
          name: user?.name || null,
          affiliation: applicant.affiliation || null,
          bio: applicant.bio || null,
          social_handles: applicant.social_handles || null,
        }
      : null,
    review_summary: reviewSummary(reviews),
    created: submission.created,
    updated: submission.updated,
  };
}

function reviewsBySubmission(reviews: CfpReviewRecord[]) {
  const grouped = new Map<string, CfpReviewRecord[]>();
  for (const review of reviews) {
    const current = grouped.get(review.submission) || [];
    current.push(review);
    grouped.set(review.submission, current);
  }
  return grouped;
}

export async function fetchMcpSessions() {
  const adminService = getAdminPB();
  const [sessions, slots, days, tracks] = await Promise.all([
    adminService.fetchAllRecords("sessions", { expand: "speakers", sort: "title" }) as Promise<ExpandedSession[]>,
    adminService.fetchAllRecords("agenda_slots") as Promise<AgendaSlotRecord[]>,
    adminService.fetchAllRecords("conference_days") as Promise<ConferenceDayRecord[]>,
    adminService.fetchAllRecords("agenda_tracks") as Promise<AgendaTrackRecord[]>,
  ]);
  const daysById = new Map(days.map((day) => [day.id, day]));
  const tracksById = new Map(tracks.map((track) => [track.id, track]));
  return sessions.map((session) => sessionDto(session, sessionSchedule(session.id, slots, daysById, tracksById)));
}

export async function fetchMcpSpeakers() {
  const adminService = getAdminPB();
  const speakers = (await adminService.fetchAllRecords("speakers", {
    sort: "display_name,slug",
  })) as ExpandedSpeaker[];
  return speakers.map(speakerDto);
}

export async function fetchMcpProposals(status?: ProposalStatus) {
  const adminService = getAdminPB();
  const submissionOptions = {
    ...(status ? { filter: `status = "${status}"` } : {}),
    expand: "applicant.user",
    sort: "-created",
  };
  const [submissions, reviews] = await Promise.all([
    adminService.fetchAllRecords("cfp_submissions", submissionOptions) as Promise<ExpandedSubmission[]>,
    adminService.fetchAllRecords("cfp_reviews") as Promise<CfpReviewRecord[]>,
  ]);

  const groupedReviews = reviewsBySubmission(reviews);
  return submissions.map((submission) =>
    proposalDto(submission, groupedReviews.get(submission.id) || []),
  );
}

export async function fetchMcpProposalContext(submissionId: string) {
  const adminService = getAdminPB();
  const [submission, reviews] = await Promise.all([
    adminService.fetchRecordById("cfp_submissions", submissionId, {
      expand: "applicant.user",
    }) as Promise<ExpandedSubmission>,
    adminService.fetchAllRecords("cfp_reviews", {
      filter: `submission = "${submissionId}"`,
      sort: "created",
    }) as Promise<CfpReviewRecord[]>,
  ]);

  return proposalDto(submission, reviews);
}

function proposalStatusCounts(proposals: ReturnType<typeof proposalDto>[]) {
  return proposals.reduce(
    (counts, proposal) => {
      counts[proposal.status] += 1;
      return counts;
    },
    { pending: 0, accepted: 0, rejected: 0 } as Record<ProposalStatus, number>,
  );
}

export async function fetchMcpProgramSnapshot() {
  const [sessions, speakers, proposals] = await Promise.all([
    fetchMcpSessions(),
    fetchMcpSpeakers(),
    fetchMcpProposals(),
  ]);

  return {
    generated_at: new Date().toISOString(),
    sessions,
    speakers,
    proposals,
    summary: {
      session_count: sessions.length,
      published_session_count: sessions.filter((session) => session.published).length,
      speaker_count: speakers.length,
      published_speaker_count: speakers.filter((speaker) => speaker.published).length,
      proposal_count: proposals.length,
      proposal_status_counts: proposalStatusCounts(proposals),
    },
  };
}
