import { createSignal, Show, onMount } from "solid-js";
import pb from "../lib/pocketbase";
import SparkMD5 from "spark-md5";

const LoginMenu = () => {
  const [isLoggedIn, setIsLoggedIn] = createSignal(pb.authStore.isValid);
  const [imgError, setImgError] = createSignal(false);

  onMount(() => {
    return pb.authStore.onChange(() => {
      setIsLoggedIn(pb.authStore.isValid);
    });
  });

  const getGravatarUrl = (email: string) => {
    const trimmedEmail = email.trim().toLowerCase();
    const hash = SparkMD5.hash(trimmedEmail);
    return `https://www.gravatar.com/avatar/${hash}?d=404`;
  };

  const getDisplayName = () => {
    const name = pb.authStore.record?.name;
    if (name) {
      return name.split(" ")[0]; // First name only
    }
    return pb.authStore.record?.email?.split("@")[0] || "Agent";
  };

  const getInitials = () => {
    const name = pb.authStore.record?.name;
    const email = pb.authStore.record?.email;
    if (name) {
      return name.charAt(0).toUpperCase();
    }
    if (email) {
      return email.charAt(0).toUpperCase();
    }
    return "A"; // Agent
  };

  return (
    <div class="fade-in">
      <Show when={!isLoggedIn()}>
        <a class="btn btn-ghost btn-lg" href="/login">
          Log in
        </a>
      </Show>
      <Show when={isLoggedIn()}>
        <a
          href="/user/profile"
          class="btn btn-ghost btn-lg gap-3 font-mono text-primary-300 hover:text-primary-100 hover:bg-primary-900/20"
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
                  src={getGravatarUrl(pb.authStore.model?.email || "")}
                  alt="Avatar"
                  onError={() => setImgError(true)}
                />
              </div>
            </Show>
          </div>
          <span class="max-w-[150px] truncate hidden md:inline-block">
            {getDisplayName()}
          </span>
        </a>
      </Show>
    </div>
  );
};

export default LoginMenu;
