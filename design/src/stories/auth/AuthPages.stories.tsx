import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { renderPage, type PageState } from "../../../../auth/src/pages";
import { DocumentBody } from "../../surfaces";

// auth sits at ALT 0 with no band, because forms need calm. Each story renders the real page HTML.
const shell = { registrationOpen: true, enabledProviders: ["google", "github"] as const, oauthQuery: null, notice: null };
const page = (state: PageState) => () => <DocumentBody html={renderPage(state)} />;

const meta = { title: "Auth/Pages", parameters: { app: "auth" } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const SignIn: Story = { name: "Sign in", render: page({ ...shell, kind: "sign-in" }) };
export const SignInError: Story = { name: "Sign in, error notice", render: page({ ...shell, kind: "sign-in", notice: { kind: "error", message: "The email or password is not correct." } }) };
export const SignUp: Story = { name: "Create account", render: page({ ...shell, kind: "sign-up" }) };
export const Recovery: Story = { render: page({ ...shell, kind: "recovery" }) };
export const ResetPassword: Story = { name: "Reset password", render: page({ ...shell, kind: "reset-password", token: "sample-token" }) };
export const ResetExpired: Story = { name: "Reset link not valid", render: page({ ...shell, kind: "reset-password", token: null }) };
export const VerifyEmail: Story = { name: "Verify email", render: page({ ...shell, kind: "verify-email", email: "ana@example.com", verified: false }) };
export const Consent: Story = { render: page({ ...shell, kind: "consent", client: { name: "WTS Call for Papers", redirectUri: "https://cfp.wts.sh/auth/callback" }, scopes: ["openid", "profile", "email"] }) };
export const AccountPage: Story = {
  name: "Account",
  render: page({ ...shell, kind: "account", email: "ana@example.com", profile: { wtsUserId: "sample", name: "Ana Petrova", avatarUrl: null, preferredLanguage: "en", username: "ana", emailVisibility: false, revision: 1 } }),
};
export const ErrorPage: Story = { name: "Error", render: page({ ...shell, kind: "error", title: "Something went wrong", message: "Try again in a few minutes." }) };
