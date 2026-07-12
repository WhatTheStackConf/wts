/** Keeps authorization ahead of privileged programme work in every server action. */
export async function runAuthorizedProgrammeOperation<T>(
  authorize: () => Promise<unknown>,
  operation: () => Promise<T>,
): Promise<T> {
  await authorize();
  return operation();
}
