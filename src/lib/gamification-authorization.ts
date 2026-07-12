/** Keeps authentication ahead of every gamification operation that reaches admin PocketBase access. */
export async function runAuthenticatedGamificationOperation<TUser, TResult>(
  authenticate: () => Promise<TUser>,
  operation: (user: TUser) => Promise<TResult>,
): Promise<TResult> {
  const user = await authenticate();
  return operation(user);
}
