import { onSettled } from "solid-js";
import { useNavigate } from "@solidjs/router";

// Settings moved into the speaker profile. Keep the old address working for bookmarks and login returns.
export default function Settings() {
  const navigate = useNavigate();
  onSettled(() => navigate("/profile", { replace: true }));
  return <p class="cfp-loading" role="status">Settings moved to <a href="/profile">your profile</a>.</p>;
}
