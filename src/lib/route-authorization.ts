export type AppRole = "user" | "reviewer" | "admin";

export interface AuthorizationState {
  loading: boolean;
  authenticated: boolean;
  role?: AppRole;
}

export function adminAuthorized(state: AuthorizationState): boolean {
  return !state.loading && state.authenticated && state.role === "admin";
}

export function reviewerAuthorized(state: AuthorizationState): boolean {
  return !state.loading
    && state.authenticated
    && (state.role === "reviewer" || state.role === "admin");
}

export function authenticated(state: AuthorizationState): boolean {
  return !state.loading && state.authenticated;
}

export function authorizedResourceSource(isAuthorized: boolean): true | undefined {
  return isAuthorized ? true : undefined;
}
