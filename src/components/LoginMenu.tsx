import { createSignal, Show } from "solid-js";
import SparkMD5 from "spark-md5";
import { Icon } from "@iconify-icon/solid";
import { useAuth } from "~/lib/auth-context";

const LoginMenu = () => {
  const [imgError, setImgError] = createSignal(false);
  const auth = useAuth();

  const getGravatarUrl = (email: string) => {
    const trimmedEmail = email.trim().toLowerCase();
    const hash = SparkMD5.hash(trimmedEmail);
    return `https://www.gravatar.com/avatar/${hash}?d=404`;
  };

  const getDisplayName = () => {
    const name = auth.record?.name;
    if (name) {
      return name.split(" ")[0]; // First name only
    }
    return auth.record?.email?.split("@")[0] || "Agent";
  };

  const getInitials = () => {
    const name = auth.record?.name;
    const email = auth.record?.email;
    if (name) {
      return name.charAt(0).toUpperCase();
    }
    if (email) {
      return email.charAt(0).toUpperCase();
    }
    return "A"; // Agent
  };

  const handleLogout = async () => {
    try {
      await auth.logout();
      window.location.href = "/";
    } catch (error) {
      console.error("Logout failed.", error);
      window.alert("Logout failed. Please try again.");
    }
  };

  return (
    <div class="fade-in relative">
      <Show when={!auth.isLoading() && !auth.isAuthenticated()}>
        <a class="btn btn-ghost btn-lg" href="/login">
          Log in
        </a>
      </Show>
      <Show when={auth.isAuthenticated()}>
        <button
          class="btn btn-ghost btn-lg gap-3 font-mono text-primary-300 hover:text-primary-100 hover:bg-primary-900/20"
          popovertarget="user-menu"
          style="anchor-name:--user-anchor"
        >
          <div class="avatar placeholder">
            <Show
              when={!imgError()}
              fallback={
                <div class="bg-primary-900 text-primary-100 rounded-full w-8 border border-primary-500/50 flex items-center justify-center">
                  <span class="text-xs font-bold font-star">
                    {getInitials()}
                  </span>
                </div>
              }
            >
              <div class="w-8 h-8 rounded-full overflow-hidden border border-primary-500/50 shadow-[0_0_10px_rgba(var(--color-primary-500),0.3)]">
                <img
                  src={getGravatarUrl(auth.record?.email || "")}
                  alt="Avatar"
                  onError={() => setImgError(true)}
                />
              </div>
            </Show>
          </div>
          <span class="max-w-[150px] truncate hidden md:inline-block">
            {getDisplayName()}
          </span>
          <Icon icon="ph:caret-down-bold" class="text-xs opacity-50" />
        </button>

        <ul
          id="user-menu"
          popover
          class="dropdown menu p-2 bg-base-200 border border-white/10 shadow-2xl rounded-xl w-52 text-primary-200 font-mono text-sm z-[9999]"
          style="position-anchor:--user-anchor; top: anchor(bottom); right: anchor(right);"
        >
          <li>
            <a href="/user/profile" class="hover:bg-primary-500/20 hover:text-white mb-1">
              <Icon icon="ph:user-bold" class="text-lg" />
              Profile
            </a>
          </li>
          <div class="divider my-0 border-white/10"></div>
          <li>
            <button onClick={() => void handleLogout()} class="text-error hover:bg-error/10 hover:text-error">
              <Icon icon="ph:sign-out-bold" class="text-lg" />
              Logout
            </button>
          </li>
        </ul>
      </Show>
    </div>
  );
};

export default LoginMenu;
