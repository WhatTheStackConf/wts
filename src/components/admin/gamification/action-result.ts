export interface AdminActionResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export function requireActionData<T>(result: AdminActionResult<T>, failure: string): T {
  if (!result.success || !result.data) throw new Error(result.error || failure);
  return result.data;
}
