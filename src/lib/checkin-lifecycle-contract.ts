export interface LifecycleStatus {
  edition: "WTS2026";
  closedAt: string | null;
  purgeDeadline: string | null;
  centralDeletedAt: string | null;
  centralCompactedAt: string | null;
  totals: { workflows: number; prints: number } | null;
  restoreRequired: boolean;
  restoreGeneration: number;
  reconciledAt: string | null;
  approvedAt: string | null;
  devices: { id: string; stationId: string; journalIdentity: string; completedAt: string | null; method: string | null; unreachable: boolean }[];
}
export interface LifecycleCloseCommand { operationId: string; confirmEdition: "WTS2026" }
export interface LifecycleApprovalCommand { generation: number; confirmEdition: "WTS2026" }
export interface LifecycleService {
  status(): Promise<LifecycleStatus>;
  close(command: LifecycleCloseCommand): Promise<LifecycleStatus>;
  approveRestore(command: LifecycleApprovalCommand): Promise<LifecycleStatus>;
}
