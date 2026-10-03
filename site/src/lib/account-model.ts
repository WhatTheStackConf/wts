export interface CentralProfileV1 {
  version: 1;
  wtsUserId: string;
  name: string;
  avatarUrl: string | null;
  preferredLanguage: string | null;
  username: string;
  emailVisibility: boolean;
  revision: number;
}

export interface AccountSession {
  wtsUserId: string;
  profile: CentralProfileV1;
  editionId: string;
  isAdmin: boolean;
  accountUrl: string;
}
