export type AgendaSlotKind = "session" | "break" | "meal" | "networking" | "opening" | "closing" | "other";
export interface PublicAppearanceEvent { name: string; compactLabel: string }
export interface PublicSpeakerSummary {
  slug: string; displayName: string; photoUrl: string | null; affiliation: string;
  isMc: boolean; sessionCount: number; appearanceEvents: PublicAppearanceEvent[];
}
export interface PublicSessionCard { slug: string; title: string; format?: string }
export interface PublicSpeakerDetail extends PublicSpeakerSummary {
  bio: string; socialHandles: string[]; sessions: PublicSessionCard[];
}
export interface PromoStackTag { name: string; color: string }
export interface PromoFooterLink { label: string; href: string; color: string }
export interface PublicSpeakerPromo {
  slug: string; displayName: string; photoUrl: string | null; roleLine: string;
  statusMessage: string; stack: PromoStackTag[]; cta?: { href: string; label: string };
  footerText: string; footerLinks: PromoFooterLink[]; footerSuffix: string;
}
export interface PublicSessionAnnouncement {
  dayDate: string; event: PublicAgendaEvent; eventStartTime?: string; locationLabel?: string;
}
export interface PublicSessionSchedule {
  dayDate: string; dayTitle: string; event: PublicAgendaEvent; startAt: string;
  endAt?: string; trackName?: string; locationLabel?: string;
}
export interface PublicAgendaSession {
  slug: string; title: string; format?: string; schedule?: PublicSessionSchedule;
  speakers: { slug: string; name: string; photoUrl?: string | null }[];
  hosts?: PublicAgendaSession["speakers"];
}
export interface PublicAgendaTrack { key: string; name: string; locationLabel?: string }
export interface PublicAgendaEvent { name: string; compactLabel: string; destinationUrl?: string }
export interface PublicAgendaSlot {
  kind: AgendaSlotKind; startAt: string; endAt: string; locationLabel?: string;
  track?: PublicAgendaTrack; session?: PublicAgendaSession;
  speakers?: PublicAgendaSession["speakers"]; title?: string; summary?: string;
}
export interface PublicAgendaDay { key: string; localDate: string; title: string; programmes: PublicEventProgramme[] }
export interface PublicEventProgramme {
  event: PublicAgendaEvent; tracks: PublicAgendaTrack[]; slots: PublicAgendaSlot[];
  details?: { summary: string; access?: string; cta?: { label: string; href: string }; unassignedSpeakers?: PublicAgendaSession["speakers"] };
  untimed?: {
    startTime?: string; endTime?: string; title?: string; locationLabel?: string;
    speakers?: PublicAgendaSession["speakers"]; unassignedSpeakers?: PublicAgendaSession["speakers"];
    summary: string; sessions: PublicAgendaSession[]; highlights?: string[]; access?: string; cta?: { label: string; href: string };
  };
}
export interface PublicAgenda { days: PublicAgendaDay[] }
export interface PublicSessionDetail {
  slug: string; title: string; abstract: string; format?: string;
  schedule?: PublicSessionSchedule; announcement?: PublicSessionAnnouncement;
  speakers: PublicSpeakerSummary[]; hosts?: PublicSpeakerSummary[]; relatedSessions: PublicSessionCard[];
}
export interface PublicConferenceGuideProgramme { agenda: PublicAgenda; sessions: PublicSessionDetail[]; speakers: PublicSpeakerDetail[] }
export type PublicPartnerType = "organizer" | "sponsor" | "supporter" | "community_partner" | "media" | "catering" | "other";
export type PublicPartnerTier = "platinum" | "gold" | "silver" | "bronze" | "bank";
export type PublicPartnerLogoSurface = "dark" | "light" | "mixed";
export type PublicPartnerGroupKind = "organizer" | "sponsor" | "partner";
export interface PublicPartner {
  name: string; logoUrl: string; logoSurface: PublicPartnerLogoSurface;
  url?: string; type: PublicPartnerType; tier?: PublicPartnerTier;
}
export interface PublicPartnerGroup {
  id: string; title: string; kind: PublicPartnerGroupKind;
  type: PublicPartnerType; tier?: PublicPartnerTier; partners: PublicPartner[];
}
export interface PublicConferenceSnapshot extends PublicConferenceGuideProgramme { partnerGroups: PublicPartnerGroup[] }
export interface PublicAsset { id: string; sha256: string; mediaType: string; byteLength: number; url: string }
