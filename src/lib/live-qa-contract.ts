/** Private live Q&A. Pages contain at most 50 questions/items, oldest questions first. */
export type LiveQaMode = 'auto' | 'open' | 'closed';
/** Public, read-only GET /api/wts/live-qa/programme; no authentication or private Q&A data.
 * Only published session slots on event wts2026appevent / main-day are eligible.
 * Stages retain their canonical keys, names and display order, including empty stages.
 * serverNow and accepting are authoritative; MC overrides cannot expand eligibility.
 */
export interface LiveQaProgrammeSession {
  slug: string;
  title: string;
  startAt: string;
  endAt: string;
  accepting: boolean;
  mode: LiveQaMode;
}
export interface LiveQaStage {
  key: string;
  name: string;
  locationLabel: string;
  sessions: LiveQaProgrammeSession[];
}
export interface LiveQaProgramme {
  day: { key: string; localDate: string; title: string } | null;
  serverNow: string;
  stages: LiveQaStage[];
}
export interface LiveQaQuestion {
  id: string;
  body: string;
  answered: boolean;
  created: string;
  own: boolean;
}
export interface LiveQaSession {
  sessionId: string;
  slug: string;
  title: string;
  mode: LiveQaMode;
  accepting: boolean;
  startAt: string | null;
  endAt: string | null;
  serverNow: string;
  canModerate: boolean;
  questions: LiveQaQuestion[];
  page: number;
  totalPages: number;
}
export interface LiveQaCatalogue {
  items: { slug: string; title: string }[];
  page: number;
  totalPages: number;
}
/** New asks are limited to one per author per 10 seconds; exact UUID replay is exempt. */
export type LiveQaRequest =
  | { operation: 'session'; slug: string; page: number }
  | { operation: 'catalogue'; page: number; search: string }
  | { operation: 'ask'; slug: string; body: string; requestId: string }
  | { operation: 'mode'; slug: string; mode: LiveQaMode }
  | { operation: 'answer'; slug: string; questionId: string; answered: boolean };
export type LiveQaReply = LiveQaSession | LiveQaCatalogue | { question: LiveQaQuestion } | { ok: true };
