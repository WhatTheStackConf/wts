import { Redirect } from "~/components/Redirect";
import { Show } from "solid-js";
import { useAuth } from "~/lib/auth-context";

const UserIndex = () => {
  const auth = useAuth();
  
  return (
    <Show when={!auth.isLoading()}>
      <Redirect href={auth.isAuthenticated() ? "/user/profile" : "/login"} />
    </Show>
  );
};

export default UserIndex;
